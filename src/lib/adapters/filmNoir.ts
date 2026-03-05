import { VenueAdapter } from "@/lib/adapters/base";
import { findFilmMatch, normalizeDraftToScreening } from "@/lib/adapters/helpers";
import { fetchLiveText } from "@/lib/live-fetch";
import { collapseWhitespace, normalizeClockLabel, stripHtml, toAbsoluteUrl } from "@/lib/utils";

const FILM_NOIR_PROGRAM_URL = "https://www.filmnoircinema.com/program";

export function parseFilmNoirProgramHtml(payload: string) {
  return payload
    .split('class="eventlist-event eventlist-event--upcoming"')
    .slice(1)
    .map((chunk) => {
      const title = collapseWhitespace(stripHtml(chunk.match(/eventlist-title-link">([\s\S]*?)<\/a>/)?.[1] ?? ""));
      const date = chunk.match(/<time class="event-date" datetime="(\d{4}-\d{2}-\d{2})"/)?.[1] ?? "";
      const time = collapseWhitespace(stripHtml(chunk.match(/event-time-24hr-start"[^>]*>([\s\S]*?)<\/time>/)?.[1] ?? ""));
      const sourceUrl = toAbsoluteUrl(chunk.match(/eventlist-title-link" href="([^"]+)"/)?.[1] ?? FILM_NOIR_PROGRAM_URL, FILM_NOIR_PROGRAM_URL);
      const description = collapseWhitespace(
        stripHtml(chunk.match(/eventlist-description">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>\s*<a href=/)?.[1] ?? "")
      );

      if (!title || !date || !time) {
        return null;
      }

      return {
        title,
        startAt: new Date(`${date}T${normalizeClockLabel(time)}:00-05:00`).toISOString(),
        description: description || `Listed on Film Noir Cinema's program page.`,
        sourceUrl,
        rawPayload: chunk,
        formatTags: []
      };
    })
    .filter((draft): draft is NonNullable<typeof draft> => Boolean(draft));
}

export const filmNoirAdapter: VenueAdapter = {
  key: "film-noir",
  lane: "event_page",
  canHandle: (venue) => venue.slug === "film-noir-cinema",
  async fetchIndexPages() {
    return [await fetchLiveText(FILM_NOIR_PROGRAM_URL)];
  },
  async fetchEventPages() {
    return [];
  },
  async parseScreenings() {
    const [payload] = await this.fetchIndexPages();
    return parseFilmNoirProgramHtml(payload);
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
        detail: screenings.length > 0 ? "Upcoming program entries parsed" : "No upcoming program entries found"
      };
    } catch (error) {
      return {
        ok: false,
        count: 0,
        detail: error instanceof Error ? error.message : "Film Noir fetch failed"
      };
    }
  }
};
