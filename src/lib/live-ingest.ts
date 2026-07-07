import { ParsedFilmSeed, ParsedScreeningDraft } from "@/lib/adapters/base";
import { getAdapterForVenue } from "@/lib/adapters/registry";
import { curatedVenues, filmCatalog } from "@/lib/catalog";
import { Film, PublicDataset, Screening, ScreeningTag, SourceStatus, Venue } from "@/lib/domain";
import { recoverPosterFromScreeningPages } from "@/lib/poster-recovery";
import { fetchRottenTomatoesMetadata, hasWeakSynopsis } from "@/lib/rottentomatoes";
import { ingestScreenSlateScreenings } from "@/lib/screenslate";
import { normalizeSourceStatuses } from "@/lib/source-status";
import { buildBaseTags, mergeScreeningTags } from "@/lib/tags";
import { slugify, normalizeTitle } from "@/lib/utils";

const ADAPTER_TIMEOUT_MS = 20000;
const MAX_FILM_ENRICHMENTS = Number.parseInt(process.env.MAX_FILM_ENRICHMENTS ?? "12", 10) || 12;
const MAX_MOMA_FILM_ENRICHMENTS = Number.parseInt(process.env.MAX_MOMA_FILM_ENRICHMENTS ?? "30", 10) || 30;
const MAX_SCREENING_PAGE_POSTER_CHECKS =
  Number.parseInt(process.env.MAX_SCREENING_PAGE_POSTER_CHECKS ?? "200", 10) || 200;

function cloneFilm(film: Film): Film {
  return {
    ...film,
    directors: [...film.directors],
    countries: [...film.countries],
    languages: [...film.languages],
    metadataSourceIds: film.metadataSourceIds ? { ...film.metadataSourceIds } : undefined
  };
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function extractReleaseYear(title: string): { title: string; releaseYear?: number } {
  const match = title.match(/\((\d{4})\)\s*$/);
  if (!match) {
    return { title };
  }
  return {
    title: title.replace(/\s*\(\d{4}\)\s*$/, "").trim(),
    releaseYear: Number(match[1])
  };
}

function buildPlaceholderFilm(title: string, seed?: ParsedFilmSeed): Film {
  const extracted = extractReleaseYear(seed?.canonicalTitle ?? title);
  const canonicalTitle = extracted.title || title;
  return {
    id: `film-${slugify(canonicalTitle)}`,
    slug: slugify(canonicalTitle),
    canonicalTitle,
    originalTitle: seed?.originalTitle,
    releaseYear: seed?.releaseYear ?? extracted.releaseYear,
    runtimeMinutes: seed?.runtimeMinutes,
    directors: seed?.directors ?? [],
    countries: seed?.countries ?? [],
    languages: seed?.languages ?? [],
    metadataSourceIds: seed?.metadataSourceIds,
    synopsis: seed?.synopsis,
    posterUrl: seed?.posterUrl,
    criterionLikely: seed?.criterionLikely
  };
}

function mergeFilm(target: Film, seed?: ParsedFilmSeed): Film {
  if (!seed) {
    return target;
  }
  return {
    ...target,
    originalTitle: target.originalTitle ?? seed.originalTitle,
    releaseYear: target.releaseYear ?? seed.releaseYear,
    runtimeMinutes: target.runtimeMinutes ?? seed.runtimeMinutes,
    directors: uniqueStrings([...target.directors, ...(seed.directors ?? [])]),
    countries: uniqueStrings([...target.countries, ...(seed.countries ?? [])]),
    languages: uniqueStrings([...target.languages, ...(seed.languages ?? [])]),
    metadataSourceIds: { ...(target.metadataSourceIds ?? {}), ...(seed.metadataSourceIds ?? {}) },
    synopsis: target.synopsis ?? seed.synopsis,
    posterUrl: target.posterUrl ?? seed.posterUrl,
    criterionLikely: target.criterionLikely ?? seed.criterionLikely
  };
}

function ensureFilmRecord(films: Film[], draft: ParsedScreeningDraft): Film {
  const canonicalTitle = draft.film?.canonicalTitle ?? draft.title;
  const normalized = normalizeTitle(canonicalTitle);
  const currentIndex = films.findIndex((film) => normalizeTitle(film.canonicalTitle) === normalized);

  if (currentIndex >= 0) {
    const merged = mergeFilm(films[currentIndex], draft.film);
    films[currentIndex] = merged;
    return merged;
  }

  const created = buildPlaceholderFilm(canonicalTitle, draft.film);
  films.push(created);
  return created;
}

function buildScreeningTags(datasetFilms: Film[], screenings: Screening[]): ScreeningTag[] {
  const tags = buildBaseTags(curatedVenues);
  return screenings.flatMap((screening) => {
    const venue = curatedVenues.find((candidate) => candidate.id === screening.venueId);
    const film = datasetFilms.find((candidate) => candidate.id === screening.filmId);
    if (!venue || !film) {
      return [];
    }

    const mergedTags = mergeScreeningTags(
      film,
      `${screening.descriptionRaw} ${screening.eventTitleRaw} ${screening.seriesName ?? ""}`,
      venue.name,
      screening.formatTags
    );
    const screeningOnlyIfcTags = new Set(["Special Event/Talkback", "Premiere"]);
    const resolvedTags =
      venue.slug === "ifc-center"
        ? mergedTags.filter((tag) => !screeningOnlyIfcTags.has(tag) || screening.formatTags.includes(tag))
        : mergedTags;

    return resolvedTags.map((tag) => ({
      screeningId: screening.id,
      tagId: `tag-${slugify(tag)}`,
      confidence: screening.formatTags.includes(tag) ? 0.98 : venue.name === tag ? 1 : 0.72,
      source: screening.formatTags.includes(tag) ? "parsed" : film.countries.join(" ").includes(tag) ? "inferred" : "parsed"
    }));
  });
}

function mergeScreening(existing: Screening, incoming: Screening): Screening {
  return {
    ...existing,
    descriptionRaw: existing.descriptionRaw.length >= incoming.descriptionRaw.length ? existing.descriptionRaw : incoming.descriptionRaw,
    formatTags: uniqueStrings([...existing.formatTags, ...incoming.formatTags]),
    userTags: uniqueStrings([...existing.userTags, ...incoming.userTags]),
    rawPayload: existing.rawPayload.length >= incoming.rawPayload.length ? existing.rawPayload : incoming.rawPayload,
    lastSeenAt: incoming.lastSeenAt,
    soldOut: incoming.soldOut ?? existing.soldOut
  };
}

function isLikelyErrorTitle(title: string): boolean {
  const normalized = title.trim().toLowerCase();
  return (
    normalized.length === 0 ||
    /^fetch failed/i.test(normalized) ||
    /^blocked/i.test(normalized) ||
    /^screen slate/i.test(normalized) ||
    /\b(403|404|408|429|500|502|503|504)\b/.test(normalized) ||
    /too many requests|timed out|cloudflare|attention required/i.test(normalized)
  );
}

async function enrichFilmsWithRottenTomatoes(films: Film[], screenings: Screening[]) {
  const activeFilmIds = new Set(screenings.map((screening) => screening.filmId));
  const screeningsByFilmId = screenings.reduce((accumulator, screening) => {
    const current = accumulator.get(screening.filmId) ?? [];
    current.push(screening);
    accumulator.set(screening.filmId, current);
    return accumulator;
  }, new Map<string, Screening[]>());

  async function enrichCandidates(candidates: Film[], limit: number) {
    let remainingEnrichments = limit;
    for (const film of candidates) {
      if (remainingEnrichments <= 0) {
        break;
      }

      const needsSynopsis = hasWeakSynopsis(film.synopsis);
      const needsPoster = !film.posterUrl;
      if (!needsSynopsis && !needsPoster) {
        continue;
      }

      const metadata = await fetchRottenTomatoesMetadata(film);
      if (!metadata) {
        continue;
      }
      remainingEnrichments -= 1;

      if (needsSynopsis && metadata.synopsis) {
        film.synopsis = metadata.synopsis;
      }
      if (needsPoster && metadata.posterUrl) {
        film.posterUrl = metadata.posterUrl;
      }

      if (!film.synopsis && !film.posterUrl) {
        continue;
      }

      film.metadataSourceIds = { ...(film.metadataSourceIds ?? {}), rottentomatoes: "matched-search" };
    }
  }

  const activeFilms = films.filter((film) => activeFilmIds.has(film.id));
  const momaFilms = activeFilms.filter((film) =>
    (screeningsByFilmId.get(film.id) ?? []).some((screening) => screening.venueId === "venue-moma")
  );
  const otherFilms = activeFilms.filter((film) => !momaFilms.some((candidate) => candidate.id === film.id));

  await enrichCandidates(momaFilms, MAX_MOMA_FILM_ENRICHMENTS);
  await enrichCandidates(otherFilms, MAX_FILM_ENRICHMENTS);
}

async function enrichMissingPostersFromSourcePages(films: Film[], screenings: Screening[]) {
  const screeningsByFilmId = screenings.reduce((accumulator, screening) => {
    const current = accumulator.get(screening.filmId) ?? [];
    current.push(screening);
    accumulator.set(screening.filmId, current);
    return accumulator;
  }, new Map<string, Screening[]>());

  const fetchLimit = { remaining: MAX_SCREENING_PAGE_POSTER_CHECKS };
  const pagePosterCache = new Map<string, string | null>();

  for (const film of films) {
    if (film.posterUrl) {
      continue;
    }

    const filmScreenings = screeningsByFilmId.get(film.id) ?? [];
    if (filmScreenings.length === 0) {
      continue;
    }

    const recovered = await recoverPosterFromScreeningPages(film.canonicalTitle, filmScreenings, pagePosterCache, fetchLimit);
    if (!recovered.posterUrl) {
      continue;
    }

    film.posterUrl = recovered.posterUrl;
    film.metadataSourceIds = {
      ...(film.metadataSourceIds ?? {}),
      screeningPagePoster: recovered.sourceUrl ?? "matched-source-page"
    };
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function ingestDraftIntoDataset(
  draft: ParsedScreeningDraft,
  venue: Venue,
  films: Film[],
  screeningsById: Map<string, Screening>
) {
  if (isLikelyErrorTitle(draft.title)) {
    return;
  }
  ensureFilmRecord(films, draft);
  const adapter = getAdapterForVenue(venue);
  const normalized = adapter?.normalize(draft, { venue, films });
  if (!normalized) {
    return;
  }

  const existing = screeningsById.get(normalized.id);
  screeningsById.set(normalized.id, existing ? mergeScreening(existing, normalized) : normalized);
}

export async function ingestTierOneLive(): Promise<PublicDataset> {
  const films = filmCatalog.map(cloneFilm);
  const screeningsById = new Map<string, Screening>();
  const warnings: string[] = [];
  const now = new Date().toISOString();
  const sourceStatuses = new Map<string, SourceStatus>(
    curatedVenues
      .filter((venue) => venue.active)
      .map((venue) => [
        venue.id,
        {
          venueId: venue.id,
          venueName: venue.name,
          status: "FAILED",
          lastAttemptAt: now
        }
      ])
  );

  try {
    const supplement = await ingestScreenSlateScreenings(curatedVenues.filter((venue) => venue.active));
    warnings.push(...supplement.warnings);

    for (const draft of supplement.drafts) {
      ingestDraftIntoDataset(draft, draft.venue, films, screeningsById);
      const current = sourceStatuses.get(draft.venue.id);
      if (current && current.status === "FAILED") {
        sourceStatuses.set(draft.venue.id, {
          ...current,
          status: "CACHED",
          lastSuccessfulUpdate: now,
          hint: "Supplemented from Screen Slate"
        });
      }
    }
  } catch (error) {
    warnings.push(`Screen Slate supplement: ${error instanceof Error ? error.message : "unknown error"}`);
  }

  const adapterResults = await Promise.allSettled(
    curatedVenues
      .filter((candidate) => candidate.active)
      .map(async (venue) => {
        const adapter = getAdapterForVenue(venue);
        if (!adapter) {
          return { venue, drafts: [] as ParsedScreeningDraft[] };
        }

        const drafts = await withTimeout(
          adapter.parseScreenings({ venue, films }),
          ADAPTER_TIMEOUT_MS,
          venue.name
        );
        return { venue, drafts };
      })
  );

  adapterResults.forEach((result) => {
    if (result.status === "rejected") {
      const message = result.reason instanceof Error ? result.reason.message : "Unknown ingestion error";
      warnings.push(message);
      return;
    }

    const existing = sourceStatuses.get(result.value.venue.id);
    const hasSupplementedData = existing?.status === "CACHED";
    sourceStatuses.set(result.value.venue.id, {
      venueId: result.value.venue.id,
      venueName: result.value.venue.name,
      status: result.value.drafts.length > 0 ? "OK" : hasSupplementedData ? "CACHED" : "FAILED",
      lastAttemptAt: now,
      lastSuccessfulUpdate: result.value.drafts.length > 0 ? now : existing?.lastSuccessfulUpdate,
      errorMessage: result.value.drafts.length > 0 || hasSupplementedData ? undefined : "No screenings parsed from source",
      hint:
        result.value.drafts.length > 0 ? undefined : hasSupplementedData ? existing?.hint ?? "Supplemented from Screen Slate" : "No listings found"
    });
    result.value.drafts.forEach((draft) => {
      ingestDraftIntoDataset(draft, result.value.venue, films, screeningsById);
    });
  });

  adapterResults.forEach((result, index) => {
    const venue = curatedVenues.filter((candidate) => candidate.active)[index];
    if (!venue) {
      return;
    }

    if (result.status === "rejected") {
      const existing = sourceStatuses.get(venue.id);
      const errorMessage = result.reason instanceof Error ? result.reason.message : "Unknown ingestion error";
      sourceStatuses.set(venue.id, {
        venueId: venue.id,
        venueName: venue.name,
        status: existing?.status === "CACHED" ? "CACHED" : "FAILED",
        lastAttemptAt: now,
        lastSuccessfulUpdate: existing?.lastSuccessfulUpdate,
        errorMessage
      });
    }
  });

  const screenings = Array.from(screeningsById.values()).sort(
    (left, right) => new Date(left.startAt).getTime() - new Date(right.startAt).getTime()
  );

  await enrichMissingPostersFromSourcePages(films, screenings);
  await enrichFilmsWithRottenTomatoes(films, screenings);

  return {
    generatedAt: new Date().toISOString(),
    dataMode: "live",
    dataStatusMessage:
      warnings.length > 0
        ? `Live venue fetch completed with issues. ${warnings.join(" | ")}`
        : "Live venue data loaded from official source pages.",
    sourceStatuses: normalizeSourceStatuses({
      generatedAt: now,
      dataMode: "live",
      venues: curatedVenues,
      films,
      screenings,
      tags: [],
      screeningTags: [],
      curatedVenueCount: curatedVenues.length,
      sourceStatuses: Array.from(sourceStatuses.values())
    }),
    venues: curatedVenues,
    films,
    screenings,
    tags: buildBaseTags(curatedVenues),
    screeningTags: buildScreeningTags(films, screenings),
    curatedVenueCount: curatedVenues.length
  };
}
