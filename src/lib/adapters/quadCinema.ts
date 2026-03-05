import { VenueAdapter } from "@/lib/adapters/base";
import { findFilmMatch, normalizeDraftToScreening } from "@/lib/adapters/helpers";
import { fetchLiveText } from "@/lib/live-fetch";
import { inferTagsFromText } from "@/lib/tags";
import {
  collapseWhitespace,
  parseEasternLocalDateTime,
  stripHtml,
  toAbsoluteUrl
} from "@/lib/utils";

const QUAD_CINEMA_URL = "https://quadcinema.com/";

function normalizeQuadTime(rawTime: string): string {
  return rawTime.replace(/^(\d{1,2})\.(\d{2})(am|pm)$/i, "$1:$2 $3");
}

export function parseQuadCinemaHtml(payload: string) {
  return payload
    .split('<div class="day-wrap ')
    .slice(1)
    .flatMap((dayChunk) => {
      return dayChunk
        .split('<div class="col span_3 grid-item">')
        .slice(1)
        .flatMap((item) => {
          const title = collapseWhitespace(stripHtml(item.match(/<h4><a href="[^"]+">([\s\S]*?)<\/a><\/h4>/)?.[1] ?? ""));
          const sourceUrl = toAbsoluteUrl(item.match(/<h4><a href="([^"]+)"/)?.[1] ?? QUAD_CINEMA_URL, QUAD_CINEMA_URL);
          const seriesName = collapseWhitespace(stripHtml(item.match(/related-program"><a [^>]+>([\s\S]*?)<\/a>/)?.[1] ?? ""));
          const posterUrl = item.match(/background-image:url\(([^)]+)\)/)?.[1];
          const formatTags = inferTagsFromText(`${seriesName} ${item}`);

          if (/bug-35mm/i.test(item) && !formatTags.includes("35MM")) {
            formatTags.push("35MM");
          }
          if (/bug-70mm/i.test(item) && !formatTags.includes("70MM")) {
            formatTags.push("70MM");
          }

          return Array.from(item.matchAll(/<li class="time-[^"]+"><a href="[^"]*date=(\d{4}-\d{2}-\d{2})[^"]*">([^<]+)<\/a><\/li>/g)).map(
            (timeMatch) => {
              const date = timeMatch[1];
              const time = normalizeQuadTime(collapseWhitespace(stripHtml(timeMatch[2])));
              const description = [seriesName ? `Program: ${seriesName}.` : "", "Listed on Quad Cinema's schedule page."]
                .filter(Boolean)
                .join(" ");

              return {
                title,
                startAt: parseEasternLocalDateTime(date, time).toISOString(),
                description,
                sourceUrl,
                rawPayload: item,
                formatTags,
                seriesName: seriesName || undefined,
                film: {
                  canonicalTitle: title,
                  posterUrl
                }
              };
            }
          );
        });
    })
    .filter((draft) => draft.title);
}

export const quadCinemaAdapter: VenueAdapter = {
  key: "quad-cinema",
  lane: "structured_html",
  canHandle: (venue) => venue.slug === "quad-cinema",
  async fetchIndexPages() {
    return [await fetchLiveText(QUAD_CINEMA_URL)];
  },
  async fetchEventPages() {
    return [];
  },
  async parseScreenings() {
    const [payload] = await this.fetchIndexPages();
    return parseQuadCinemaHtml(payload);
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
        detail: screenings.length > 0 ? "Homepage day-by-day schedule parsed" : "No Quad Cinema screenings found"
      };
    } catch (error) {
      return {
        ok: false,
        count: 0,
        detail: error instanceof Error ? error.message : "Quad Cinema fetch failed"
      };
    }
  }
};
