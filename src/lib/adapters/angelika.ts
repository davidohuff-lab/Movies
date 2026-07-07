import { ParsedScreeningDraft, VenueAdapter } from "@/lib/adapters/base";
import { findFilmMatch } from "@/lib/adapters/helpers";
import { Screening, Venue } from "@/lib/domain";
import { inferTagsFromText } from "@/lib/tags";
import { collapseWhitespace, hashString, slugify, stripHtml, toAbsoluteUrl } from "@/lib/utils";

const ANGELIKA_BASE_URL = "https://angelikafilmcenter.com";
const ANGELIKA_API_BASE_URL = "https://production-api.readingcinemas.com";
const ANGELIKA_COUNTRY_ID = "6";
const SETTINGS_URL = `${ANGELIKA_API_BASE_URL}/settings/${ANGELIKA_COUNTRY_ID}`;

const VENUE_CONFIG: Record<string, { cinemaId: string; alias: string }> = {
  "angelika-film-center": { cinemaId: "0000000005", alias: "nyc" },
  "village-east-by-angelika": { cinemaId: "0000000004", alias: "villageeast" },
  "cinema-123-by-angelika": { cinemaId: "21", alias: "cinemas123" }
};

interface AngelikaSettingsResponse {
  data?: {
    settings?: {
      token?: string;
    };
  };
}

interface AngelikaShowtime {
  id: string;
  date_time: string;
  type?: string;
  statusCode?: string;
  soldout?: boolean;
  searchAttributes?: string;
}

interface AngelikaShowType {
  type?: string;
  amenities?: string[];
  showtimes?: AngelikaShowtime[];
}

interface AngelikaShowDate {
  date?: string;
  showtypes?: AngelikaShowType[];
}

interface AngelikaFilmPayload {
  theater: string;
  movieSlug: string;
  name: string;
  synopsis?: string;
  director?: string;
  language?: string;
  genre?: string;
  status?: string;
  length?: string;
  release_date?: string;
  poster_image?: string;
  moviePoster?: string;
  film_image_medium_size?: string;
  film_image_large_size?: string;
  film_image_original_size?: string;
  showdates?: AngelikaShowDate[];
}

interface AngelikaFilmsResponse {
  data?: AngelikaFilmPayload[];
}

function normalizeAngelikaDateTime(value: string): string {
  const trimmed = collapseWhitespace(value);
  if (!trimmed) {
    return trimmed;
  }
  return trimmed.replace(/([+-]\d{2})$/, "$1:00");
}

function decodeMaybeEscaped(input: string): string {
  return collapseWhitespace(
    input
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
      .replace(/\\"/g, "\"")
  );
}

function normalizeTextArray(input?: string): string[] {
  return (input ?? "")
    .split(/,|\/| with /i)
    .map((part) => collapseWhitespace(stripHtml(part)))
    .filter(Boolean);
}

function resolvePosterUrl(film: AngelikaFilmPayload): string | undefined {
  const candidate =
    film.film_image_original_size ||
    film.film_image_large_size ||
    film.film_image_medium_size ||
    film.moviePoster ||
    film.poster_image;
  return candidate ? toAbsoluteUrl(candidate, ANGELIKA_BASE_URL) : undefined;
}

function buildFilmSourceUrl(venue: Venue, film: AngelikaFilmPayload): string {
  const config = VENUE_CONFIG[venue.slug];
  return toAbsoluteUrl(`/${config.alias}/movies/details/${film.movieSlug}`, ANGELIKA_BASE_URL);
}

function buildFormatTags(film: AngelikaFilmPayload, showType: AngelikaShowType, showtime: AngelikaShowtime): string[] {
  const sourceText = [
    film.name,
    film.genre ?? "",
    film.status ?? "",
    showType.type ?? "",
    ...(showType.amenities ?? []),
    showtime.type ?? "",
    showtime.searchAttributes ?? ""
  ].join(" ");

  const tags = inferTagsFromText(sourceText);
  const normalizedAmenities = (showType.amenities ?? []).map((value) => collapseWhitespace(value));
  for (const amenity of normalizedAmenities) {
    if (!tags.includes(amenity)) {
      tags.push(amenity);
    }
  }
  const normalizedType = collapseWhitespace(showType.type ?? "");
  if (normalizedType && !tags.includes(normalizedType)) {
    tags.push(normalizedType);
  }
  if (/35mm/i.test(sourceText) && !tags.includes("35MM")) {
    tags.push("35MM");
  }
  if (/70mm/i.test(sourceText) && !tags.includes("70MM")) {
    tags.push("70MM");
  }
  return Array.from(new Set(tags.filter(Boolean)));
}

async function fetchAngelikaToken(): Promise<string> {
  const response = await fetch(SETTINGS_URL, {
    headers: {
      accept: "application/json",
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    },
    next: { revalidate: 300 }
  });
  if (!response.ok) {
    throw new Error(`Angelika settings fetch failed (${response.status})`);
  }
  const payload = (await response.json()) as AngelikaSettingsResponse;
  const token = payload.data?.settings?.token;
  if (!token) {
    throw new Error("Angelika settings token missing");
  }
  return token;
}

async function fetchAngelikaNowShowing(venue: Venue): Promise<AngelikaFilmPayload[]> {
  const config = VENUE_CONFIG[venue.slug];
  if (!config) {
    return [];
  }
  const token = await fetchAngelikaToken();
  const url = new URL("/films", ANGELIKA_API_BASE_URL);
  url.searchParams.set("countryId", ANGELIKA_COUNTRY_ID);
  url.searchParams.set("cinemaId", config.cinemaId);
  url.searchParams.set("status", "nowShowing");

  const response = await fetch(url.toString(), {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    },
    next: { revalidate: 300 }
  });

  if (!response.ok) {
    throw new Error(`Angelika films fetch failed (${response.status})`);
  }

  const payload = (await response.json()) as AngelikaFilmsResponse;
  return Array.isArray(payload.data) ? payload.data : [];
}

export function parseAngelikaNowShowingResponse(venue: Venue, films: AngelikaFilmPayload[]): ParsedScreeningDraft[] {
  return films.flatMap((film) => {
    const title = decodeMaybeEscaped(collapseWhitespace(film.name));
    const synopsis = collapseWhitespace(stripHtml(film.synopsis ?? "")) || `${title} at ${venue.name}.`;
    const runtimeMinutes = Number.parseInt(film.length ?? "", 10);
    const releaseYear = Number.parseInt((film.release_date ?? "").slice(0, 4), 10);
    const sourceUrl = buildFilmSourceUrl(venue, film);
    const posterUrl = resolvePosterUrl(film);

    return (film.showdates ?? []).flatMap((showDate) =>
      (showDate.showtypes ?? []).flatMap((showType) =>
        (showType.showtimes ?? []).map((showtime) => {
          const formatTags = buildFormatTags(film, showType, showtime);
          return {
            title,
            startAt: new Date(normalizeAngelikaDateTime(showtime.date_time)).toISOString(),
            description: synopsis,
            sourceUrl,
            rawPayload: JSON.stringify({ film, showDate, showType, showtime }),
            formatTags,
            soldOut: Boolean(showtime.soldout) || showtime.statusCode === "1",
            film: {
              canonicalTitle: title,
              releaseYear: Number.isNaN(releaseYear) ? undefined : releaseYear,
              runtimeMinutes: Number.isNaN(runtimeMinutes) ? undefined : runtimeMinutes,
              directors: normalizeTextArray(film.director),
              languages: normalizeTextArray(film.language),
              synopsis,
              posterUrl,
              metadataSourceIds: { angelika: sourceUrl }
            }
          } satisfies ParsedScreeningDraft;
        })
      )
    );
  });
}

function normalizeAngelikaDraftToScreening(venue: Venue, draft: ParsedScreeningDraft, filmId: string): Screening {
  const key = `${venue.slug}-${filmId}-${draft.startAt}`;
  return {
    id: `screening-${slugify(key)}`,
    venueId: venue.id,
    filmId,
    startAt: new Date(draft.startAt).toISOString(),
    seriesName: draft.seriesName,
    eventTitleRaw: draft.title,
    descriptionRaw: draft.description,
    formatTags: draft.formatTags ?? [],
    userTags: [],
    sourceType: "api",
    sourceUrl: draft.sourceUrl,
    sourceHash: hashString(`${key}-${draft.rawPayload}`),
    rawPayload: draft.rawPayload,
    lastSeenAt: new Date().toISOString(),
    isManualOverride: false,
    isCancelled: false,
    soldOut: draft.soldOut
  };
}

export const angelikaAdapter: VenueAdapter = {
  key: "angelika-family",
  lane: "event_page",
  canHandle: (venue) => Object.prototype.hasOwnProperty.call(VENUE_CONFIG, venue.slug),
  async fetchIndexPages() {
    return [];
  },
  async fetchEventPages() {
    return [];
  },
  async parseScreenings(context) {
    const films = await fetchAngelikaNowShowing(context.venue);
    return parseAngelikaNowShowingResponse(context.venue, films);
  },
  normalize(draft, context) {
    const film = findFilmMatch(draft.title, context.films);
    if (!film) {
      return null;
    }
    return normalizeAngelikaDraftToScreening(context.venue, draft, film.id);
  },
  async healthCheck(context) {
    try {
      const screenings = await this.parseScreenings(context);
      return {
        ok: screenings.length > 0,
        count: screenings.length,
        detail:
          screenings.length > 0
            ? "Angelika now-playing API parsed successfully"
            : "Angelika now-playing API returned no screenings"
      };
    } catch (error) {
      return {
        ok: false,
        count: 0,
        detail: error instanceof Error ? error.message : "Angelika fetch failed"
      };
    }
  }
};
