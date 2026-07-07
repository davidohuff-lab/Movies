import { ParsedScreeningDraft, VenueAdapter } from "@/lib/adapters/base";
import { findFilmMatch, normalizeDraftToScreening } from "@/lib/adapters/helpers";
import { parseGenericJsonLdEvents } from "@/lib/adapters/genericJsonLd";
import { fetchLiveText } from "@/lib/live-fetch";
import { inferTagsFromText } from "@/lib/tags";
import {
  collapseWhitespace,
  normalizeClockLabel,
  parseEasternLocalDateTime,
  stripHtml,
  toAbsoluteUrl
} from "@/lib/utils";

const AMC_SHOWTIMES_BASE_URL =
  "https://www.amctheatres.com/movie-theatres/new-york-city/amc-lincoln-square-13/showtimes";
const AMC_IMAX_SOURCE_URL = `${AMC_SHOWTIMES_BASE_URL}?premium-offering=imax`;
const IMAX_THEATER_URL = "https://www.imax.com/theatre/amc-lincoln-square-13-imax";
const FEVER_AMC_URL = "https://feverup.com/movies/en/united-states/movie-theaters/amc-lincoln-square-13";
const FEVER_MOVIE_URL_BASE = "https://feverup.com/movies/en/movie/";

function formatEasternDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function buildAmcImaxUrl(dateKey: string): string {
  return `${AMC_SHOWTIMES_BASE_URL}?date=${dateKey}&premium-offering=imax`;
}

function parseFromScriptJson(
  payload: string,
  sourceUrl: string,
  dateHint: string
): ParsedScreeningDraft[] {
  const matches = Array.from(
    payload.matchAll(/<script[^>]+(?:id=["']js-schema["']|type=["']application\/ld\+json["'])[^>]*>\s*([\s\S]*?)\s*<\/script>/gi)
  );

  const drafts: ParsedScreeningDraft[] = [];
  for (const match of matches) {
    const raw = match[1];
    if (!raw) {
      continue;
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      for (const node of nodes) {
        if (!node || typeof node !== "object") {
          continue;
        }
        const object = node as Record<string, unknown>;
        const title = collapseWhitespace(stripHtml(String(object.name ?? object.title ?? "")));
        if (!title) {
          continue;
        }

        const description = collapseWhitespace(stripHtml(String(object.description ?? ""))) || "Listed on AMC IMAX showtimes.";
        const startRaw = object.startDate;
        if (typeof startRaw === "string" && startRaw) {
          const startDate = new Date(startRaw);
          if (!Number.isNaN(startDate.getTime())) {
            drafts.push({
              title,
              startAt: startDate.toISOString(),
              description,
              sourceUrl,
              rawPayload: raw,
              formatTags: Array.from(new Set(["IMAX", ...inferTagsFromText(`${title} ${description}`)])),
              film: {
                canonicalTitle: title,
                synopsis: description || undefined
              }
            });
          }
          continue;
        }

        const showtimes = Array.isArray(object.showtimes) ? object.showtimes : [];
        for (const showtime of showtimes) {
          if (typeof showtime !== "string") {
            continue;
          }
          const startAt = parseEasternLocalDateTime(dateHint, normalizeClockLabel(showtime)).toISOString();
          drafts.push({
            title,
            startAt,
            description,
            sourceUrl,
            rawPayload: raw,
            formatTags: Array.from(new Set(["IMAX", ...inferTagsFromText(`${title} ${description}`)])),
            film: {
              canonicalTitle: title,
              synopsis: description || undefined
            }
          });
        }
      }
    } catch {
      continue;
    }
  }

  return drafts;
}

function extractBalancedJsonArray(payload: string, key: string): string | null {
  const keyIndex = payload.indexOf(key);
  if (keyIndex < 0) {
    return null;
  }

  const openIndex = payload.indexOf("[", keyIndex + key.length);
  if (openIndex < 0) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let index = openIndex; index < payload.length; index += 1) {
    const character = payload[index];

    if (escaping) {
      escaping = false;
      continue;
    }
    if (character === "\\") {
      escaping = true;
      continue;
    }
    if (character === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (character === "[") {
      depth += 1;
      continue;
    }
    if (character === "]") {
      depth -= 1;
      if (depth === 0) {
        return payload.slice(openIndex, index + 1);
      }
    }
  }

  return null;
}

type FeverSession = {
  isExpired?: boolean;
  isSoldOut?: boolean;
  screenFormat?: string;
  time?: string;
};

type FeverScreenFormatSessions = {
  attributes?: string[];
  screenFormat?: string;
  sessions?: FeverSession[];
};

type FeverMovie = {
  advisoryRating?: { title?: string };
  coverPhotoUrl?: string;
  id?: number;
  reference?: string;
  runtimeMinutes?: number;
  screenFormatSessions?: FeverScreenFormatSessions[];
  timezone?: string;
  title?: string;
};

function decodeEscapedUnicode(value: string): string {
  return value.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16))
  );
}

export function parseAmcImaxFeverHtml(payload: string): ParsedScreeningDraft[] {
  const showtimesJson = extractBalancedJsonArray(payload, "\"showtimes\":");
  if (!showtimesJson) {
    return [];
  }

  let movies: FeverMovie[];
  try {
    movies = JSON.parse(showtimesJson) as FeverMovie[];
  } catch {
    return [];
  }

  return movies.flatMap((movie) => {
    const title = collapseWhitespace(decodeEscapedUnicode(String(movie.title ?? ""))).replace(/^"|"$/g, "");
    if (!title) {
      return [];
    }

    const sourceUrl = movie.reference ? `${FEVER_MOVIE_URL_BASE}${movie.reference}` : FEVER_AMC_URL;
    const formatSessions = Array.isArray(movie.screenFormatSessions) ? movie.screenFormatSessions : [];

    return formatSessions.flatMap((formatEntry) => {
      const screenFormat = collapseWhitespace(String(formatEntry.screenFormat ?? ""));
      if (!/imax/i.test(screenFormat)) {
        return [];
      }

      const attributes = Array.isArray(formatEntry.attributes) ? formatEntry.attributes.map((value) => collapseWhitespace(String(value))) : [];
      const sessions = Array.isArray(formatEntry.sessions) ? formatEntry.sessions : [];

      return sessions.flatMap((session) => {
        if (!session.time) {
          return [];
        }

        const startDate = new Date(session.time);
        if (Number.isNaN(startDate.getTime())) {
          return [];
        }

        const formatTags = Array.from(
          new Set([
            "IMAX",
            screenFormat,
            ...attributes.filter((attribute) => /caption|3d|laser|dolby|subtit|voice-over/i.test(attribute)),
            ...inferTagsFromText(`${title} ${screenFormat} ${attributes.join(" ")}`)
          ])
        );

        return [
          {
            title,
            startAt: startDate.toISOString(),
            description: `Listed on Fever AMC showtimes as ${screenFormat}.`,
            sourceUrl,
            rawPayload: JSON.stringify({
              title,
              reference: movie.reference,
              screenFormat,
              attributes,
              session
            }),
            soldOut: session.isSoldOut,
            formatTags,
            film: {
              canonicalTitle: title,
              runtimeMinutes: movie.runtimeMinutes,
              posterUrl: movie.coverPhotoUrl,
              metadataSourceIds: movie.reference ? { fever: movie.reference } : undefined
            }
          }
        ] satisfies ParsedScreeningDraft[];
      });
    });
  });
}

export function parseAmcImaxHtml(payload: string, sourceUrl: string, dateHint: string): ParsedScreeningDraft[] {
  const genericJsonLd = parseGenericJsonLdEvents(payload, {
    website: sourceUrl,
    slug: "amc-lincoln-square-13",
    name: "AMC 13 (IMAX)",
    includeRules: ["imax-only", "special-events-only"]
  }).map((draft) => ({
    ...draft,
    formatTags: Array.from(new Set(["IMAX", ...(draft.formatTags ?? [])]))
  }));

  if (genericJsonLd.length > 0) {
    return genericJsonLd;
  }

  const scriptJsonDrafts = parseFromScriptJson(payload, sourceUrl, dateHint);
  if (scriptJsonDrafts.length > 0) {
    return scriptJsonDrafts;
  }

  return Array.from(
    payload.matchAll(
      /<section[^>]*class="[^"]*showtimes[^"]*"[\s\S]*?<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>[\s\S]*?<ul[^>]*>([\s\S]*?)<\/ul>[\s\S]*?<\/section>/gi
    )
  ).flatMap((match) => {
    const title = collapseWhitespace(stripHtml(match[1] ?? ""));
    const listHtml = match[2] ?? "";
    if (!title) {
      return [];
    }

    return Array.from(listHtml.matchAll(/>(\d{1,2}(?::\d{2})?\s*[ap]m)</gi)).map((timeMatch) => {
      const time = normalizeClockLabel(timeMatch[1] ?? "");
      const startAt = parseEasternLocalDateTime(dateHint, time).toISOString();
      return {
        title,
        startAt,
        description: "Listed on AMC IMAX showtimes.",
        sourceUrl,
        rawPayload: match[0],
        formatTags: Array.from(new Set(["IMAX", ...inferTagsFromText(`${title} ${match[0]}`)])),
        film: {
          canonicalTitle: title
        }
      };
    });
  });
}

function dedupeDrafts(drafts: ParsedScreeningDraft[]): ParsedScreeningDraft[] {
  const map = new Map<string, ParsedScreeningDraft>();
  for (const draft of drafts) {
    const key = `${draft.title.toLowerCase()}::${new Date(draft.startAt).toISOString()}`;
    map.set(key, draft);
  }
  return Array.from(map.values());
}

export const amcImaxAdapter: VenueAdapter = {
  key: "amc-imax",
  lane: "structured_html",
  canHandle: (venue) => venue.slug === "amc-lincoln-square-13",
  async fetchIndexPages() {
    return [await fetchLiveText(AMC_IMAX_SOURCE_URL)];
  },
  async fetchEventPages() {
    return [];
  },
  async parseScreenings() {
    const daysAheadRaw = Number.parseInt(process.env.AMC_IMAX_DAYS_AHEAD ?? "10", 10);
    const daysAhead = Number.isFinite(daysAheadRaw) && daysAheadRaw > 0 ? daysAheadRaw : 10;
    const allDrafts: ParsedScreeningDraft[] = [];

    const today = parseEasternLocalDateTime(formatEasternDateKey(new Date()), "12:00");
    for (let offset = 0; offset < daysAhead; offset += 1) {
      const date = new Date(today);
      date.setUTCDate(date.getUTCDate() + offset);
      const dayKey = formatEasternDateKey(date);
      const sourceUrl = buildAmcImaxUrl(dayKey);
      try {
        const payload = await fetchLiveText(sourceUrl);
        allDrafts.push(...parseAmcImaxHtml(payload, toAbsoluteUrl(sourceUrl, AMC_SHOWTIMES_BASE_URL), dayKey));
      } catch {
        continue;
      }
    }

    if (allDrafts.length > 0) {
      return dedupeDrafts(allDrafts);
    }

    try {
      const imaxPayload = await fetchLiveText(IMAX_THEATER_URL);
      const todayKey = formatEasternDateKey(new Date());
      allDrafts.push(...parseAmcImaxHtml(imaxPayload, IMAX_THEATER_URL, todayKey));
    } catch {
      // Leave empty; caller handles zero-screening state.
    }

    if (allDrafts.length > 0) {
      return dedupeDrafts(allDrafts);
    }

    try {
      const feverPayload = await fetchLiveText(FEVER_AMC_URL);
      allDrafts.push(...parseAmcImaxFeverHtml(feverPayload));
    } catch {
      // Leave empty; caller handles zero-screening state.
    }

    return dedupeDrafts(allDrafts);
  },
  normalize(draft, context) {
    return normalizeDraftToScreening(context.venue, findFilmMatch(draft.title, context.films), draft);
  },
  async healthCheck(context) {
    try {
      const screenings = await this.parseScreenings(context);
      return {
        ok: screenings.length > 0,
        count: screenings.length,
        detail: screenings.length > 0 ? "AMC IMAX listings parsed" : "No AMC IMAX listings found"
      };
    } catch (error) {
      return {
        ok: false,
        count: 0,
        detail: error instanceof Error ? error.message : "AMC IMAX fetch failed"
      };
    }
  }
};
