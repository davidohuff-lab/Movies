import { VenueAdapter } from "@/lib/adapters/base";
import { findFilmMatch, normalizeDraftToScreening } from "@/lib/adapters/helpers";
import { fetchLiveText } from "@/lib/live-fetch";
import { inferTagsFromText } from "@/lib/tags";
import { collapseWhitespace, normalizeClockLabel, stripHtml, toAbsoluteUrl } from "@/lib/utils";

const LOW_CINEMA_TICKETS_URL = "https://lowcinema.com/tickets/";

export function parseLowCinemaHtml(payload: string) {
  return payload
    .split('<div class="movie-card">')
    .slice(1)
    .flatMap((chunk) => {
      const title = collapseWhitespace(stripHtml(chunk.match(/movie-title"><a [^>]+>([\s\S]*?)<\/a>/)?.[1] ?? ""));
      const sourceUrl = toAbsoluteUrl(chunk.match(/movie-title"><a href="([^"]+)"/)?.[1] ?? LOW_CINEMA_TICKETS_URL, LOW_CINEMA_TICKETS_URL);
      const posterUrl = chunk.match(/movie-poster">[\s\S]*?<img src="([^"]+)"/)?.[1];
      const panels = Array.from(chunk.matchAll(/showtimes-panel" id="panel-[^"]*-(\d{4}-\d{2}-\d{2})">([\s\S]*?)<\/div>/g));

      return panels.flatMap((panel) => {
        const date = panel[1];
        const times = Array.from(panel[2].matchAll(/showtime-link">\s*([\s\S]*?)\s*<\/a>/g));
        return times.map((timeMatch) => {
          const time = collapseWhitespace(stripHtml(timeMatch[1]));
          return {
            title,
            startAt: new Date(`${date}T${normalizeClockLabel(time)}:00-05:00`).toISOString(),
            description: "Listed on Low Cinema's tickets page.",
            sourceUrl,
            rawPayload: panel[0],
            formatTags: inferTagsFromText(`${title} ${panel[0]}`),
            film: { canonicalTitle: title, posterUrl }
          };
        });
      });
    })
    .filter((draft) => draft.title);
}

export const lowCinemaAdapter: VenueAdapter = {
  key: "low-cinema",
  lane: "structured_html",
  canHandle: (venue) => venue.slug === "low-cinema",
  async fetchIndexPages() {
    return [await fetchLiveText(LOW_CINEMA_TICKETS_URL)];
  },
  async fetchEventPages() {
    return [];
  },
  async parseScreenings() {
    const [payload] = await this.fetchIndexPages();
    return parseLowCinemaHtml(payload);
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
        detail: screenings.length > 0 ? "Centralized tickets listings parsed" : "No Low Cinema showtimes found"
      };
    } catch (error) {
      return {
        ok: false,
        count: 0,
        detail: error instanceof Error ? error.message : "Low Cinema fetch failed"
      };
    }
  }
};
