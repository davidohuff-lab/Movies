import { ParsedFilmSeed, ParsedScreeningDraft } from "@/lib/adapters/base";
import { getAdapterForVenue } from "@/lib/adapters/registry";
import { curatedVenues, filmCatalog } from "@/lib/catalog";
import { Film, PublicDataset, Screening, ScreeningTag } from "@/lib/domain";
import { fetchRottenTomatoesMetadata, hasWeakSynopsis } from "@/lib/rottentomatoes";
import { buildBaseTags, mergeScreeningTags } from "@/lib/tags";
import { slugify, normalizeTitle } from "@/lib/utils";

const LIVE_SOURCE_SLUGS = new Set([
  "film-forum",
  "film-noir-cinema",
  "low-cinema",
  "ifc-center",
  "quad-cinema",
  "metrograph",
  "paris-theater",
  "spectacle-theater",
  "museum-of-the-moving-image"
]);

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

    return mergeScreeningTags(
      film,
      `${screening.descriptionRaw} ${screening.eventTitleRaw} ${screening.seriesName ?? ""}`,
      venue.name,
      screening.formatTags
    ).map((tag) => ({
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

async function enrichFilmsWithRottenTomatoes(films: Film[], screenings: Screening[]) {
  const activeFilmIds = new Set(screenings.map((screening) => screening.filmId));

  for (const film of films) {
    if (!activeFilmIds.has(film.id) || !hasWeakSynopsis(film.synopsis)) {
      continue;
    }

    const metadata = await fetchRottenTomatoesMetadata(film);
    if (!metadata?.synopsis) {
      continue;
    }

    film.synopsis = metadata.synopsis;
    film.posterUrl = film.posterUrl ?? metadata.posterUrl;
    film.metadataSourceIds = { ...(film.metadataSourceIds ?? {}), rottentomatoes: "matched-search" };
  }
}

export async function ingestTierOneLive(): Promise<PublicDataset> {
  const films = filmCatalog.map(cloneFilm);
  const screeningsById = new Map<string, Screening>();
  const warnings: string[] = [];

  for (const venue of curatedVenues.filter((candidate) => LIVE_SOURCE_SLUGS.has(candidate.slug))) {
    const adapter = getAdapterForVenue(venue);
    if (!adapter) {
      continue;
    }

    try {
      const drafts = await adapter.parseScreenings({ venue, films });
      for (const draft of drafts) {
        ensureFilmRecord(films, draft);
        const normalized = adapter.normalize(draft, { venue, films });
        if (!normalized) {
          continue;
        }

        const existing = screeningsById.get(normalized.id);
        screeningsById.set(normalized.id, existing ? mergeScreening(existing, normalized) : normalized);
      }
    } catch (error) {
      warnings.push(`${venue.name}: ${error instanceof Error ? error.message : "Unknown ingestion error"}`);
    }
  }

  const screenings = Array.from(screeningsById.values()).sort(
    (left, right) => new Date(left.startAt).getTime() - new Date(right.startAt).getTime()
  );

  await enrichFilmsWithRottenTomatoes(films, screenings);

  return {
    generatedAt: new Date().toISOString(),
    dataMode: "live",
    dataStatusMessage:
      warnings.length > 0
        ? `Live venue fetch completed with issues. ${warnings.join(" | ")}`
        : "Live venue data loaded from official source pages.",
    venues: curatedVenues,
    films,
    screenings,
    tags: buildBaseTags(curatedVenues),
    screeningTags: buildScreeningTags(films, screenings),
    curatedVenueCount: curatedVenues.length
  };
}
