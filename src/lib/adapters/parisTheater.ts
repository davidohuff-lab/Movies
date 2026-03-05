import { VenueAdapter } from "@/lib/adapters/base";
import { findFilmMatch, normalizeDraftToScreening } from "@/lib/adapters/helpers";
import { fetchLiveText } from "@/lib/live-fetch";
import { inferTagsFromText } from "@/lib/tags";
import {
  collapseWhitespace,
  parseEasternLocalDateTime,
  toAbsoluteUrl
} from "@/lib/utils";

const PARIS_THEATER_URL = "https://www.paristheaternyc.com/";

function decodeJsonish(input: string): string {
  return collapseWhitespace(
    input
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
      .replace(/\\"/g, "\"")
      .replace(/\\n/g, " ")
      .replace(/\\r/g, " ")
      .replace(/\\\\/g, "\\")
  );
}

export function parseParisTheaterHomepageHtml(payload: string) {
  const filmMetadata = new Map<
    string,
    {
      canonicalTitle: string;
      sourceUrl: string;
      synopsis?: string;
      directors: string[];
      releaseYear?: number;
      runtimeMinutes?: number;
      posterUrl?: string;
      format?: string;
    }
  >();

  for (const filmMatch of payload.matchAll(
    /"FilmName":"([^"]+)","Slug":"([^"]+)".*?"Director":"([^"]*)".*?"Synopsis":"([^"]*)".*?"Runtime":(null|\d+).*?"FilmFormat":"([^"]*)".*?"Year":"(\d{4})"/g
  )) {
    const title = decodeJsonish(filmMatch[1]);
    const slug = filmMatch[2];
    const runtime = Number(filmMatch[5] ?? "");
    const releaseYear = Number(filmMatch[7] ?? "");
    filmMetadata.set(title.toLowerCase(), {
      canonicalTitle: title,
      sourceUrl: toAbsoluteUrl(`/film/${slug}`, PARIS_THEATER_URL),
      synopsis: decodeJsonish(filmMatch[4]) || undefined,
      directors: decodeJsonish(filmMatch[3])
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      releaseYear: Number.isNaN(releaseYear) ? undefined : releaseYear,
      runtimeMinutes: Number.isNaN(runtime) ? undefined : runtime,
      format: decodeJsonish(filmMatch[6]) || undefined
    });
  }

  return Array.from(
    payload.matchAll(
      /"EventName":"([^"]+)","EventDate":"(\d{4}-\d{2}-\d{2})","HeroDetails":"([^"]*)".*?"TicketLink":"([^"]+)".*?"Slug":"([^"]+)".*?"EventTime":"([^"]+)"/g
    )
  ).map((eventMatch) => {
    const eventName = decodeJsonish(eventMatch[1]);
    const filmTitle = collapseWhitespace(eventName.split("|")[0] ?? eventName);
    const film = filmMetadata.get(filmTitle.toLowerCase());
    const description = decodeJsonish(eventMatch[3]) || `${eventName} at Paris Theater.`;
    const time = decodeJsonish(eventMatch[6]);
    const formatTags = inferTagsFromText(`${eventName} ${description} ${film?.format ?? ""}`);
    if (/35mm/i.test(film?.format ?? "") && !formatTags.includes("35MM")) {
      formatTags.push("35MM");
    }
    if (/70mm/i.test(film?.format ?? "") && !formatTags.includes("70MM")) {
      formatTags.push("70MM");
    }

    return {
      title: film?.canonicalTitle ?? filmTitle,
      startAt: parseEasternLocalDateTime(eventMatch[2], time).toISOString(),
      description,
      sourceUrl: toAbsoluteUrl(`/event/${eventMatch[5]}`, PARIS_THEATER_URL),
      rawPayload: eventMatch[0],
      formatTags,
      seriesName: eventName,
      film:
        film ??
        ({
          canonicalTitle: filmTitle
        } as const)
    };
  });
}

export const parisTheaterAdapter: VenueAdapter = {
  key: "paris-theater",
  lane: "event_page",
  canHandle: (venue) => venue.slug === "paris-theater",
  async fetchIndexPages() {
    return [await fetchLiveText(PARIS_THEATER_URL)];
  },
  async fetchEventPages() {
    return [];
  },
  async parseScreenings() {
    const [payload] = await this.fetchIndexPages();
    return parseParisTheaterHomepageHtml(payload);
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
        detail:
          screenings.length > 0
            ? "Public event listings parsed from Paris Theater site"
            : "No public Paris Theater event listings found"
      };
    } catch (error) {
      return {
        ok: false,
        count: 0,
        detail: error instanceof Error ? error.message : "Paris Theater fetch failed"
      };
    }
  }
};
