import { VenueAdapter } from "@/lib/adapters/base";
import { findFilmMatch, normalizeDraftToScreening } from "@/lib/adapters/helpers";
import { fetchLiveText } from "@/lib/live-fetch";
import { inferTagsFromText, isPublicBookableMoMA } from "@/lib/tags";
import { collapseWhitespace, normalizeClockLabel, stripHtml, toAbsoluteUrl } from "@/lib/utils";

const MOVING_IMAGE_URL = "https://movingimage.org/whats-on/screenings-and-series/";

export function parseMovingImageHtml(payload: string) {
  return payload
    .split("<article")
    .slice(1)
    .map((chunk) => {
      const title = collapseWhitespace(stripHtml(chunk.match(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/)?.[1] ?? ""));
      const date = chunk.match(/datetime="(\d{4}-\d{2}-\d{2})"/)?.[1] ?? "";
      const time = collapseWhitespace(stripHtml(chunk.match(/class="[^"]*time[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/)?.[1] ?? ""));
      const description = collapseWhitespace(stripHtml(chunk.match(/<p class="description">([\s\S]*?)<\/p>/)?.[1] ?? ""));
      const sourceUrl = toAbsoluteUrl(chunk.match(/<a href="([^"]+)"/)?.[1] ?? MOVING_IMAGE_URL, MOVING_IMAGE_URL);
      const format = collapseWhitespace(stripHtml(chunk.match(/<p class="format">([\s\S]*?)<\/p>/)?.[1] ?? ""));
      return {
        title,
        startAt: date && time ? new Date(`${date}T${normalizeClockLabel(time)}:00-05:00`).toISOString() : "",
        description,
        sourceUrl,
        rawPayload: chunk,
        formatTags: inferTagsFromText(`${chunk} ${format}`)
      };
    })
    .filter((draft) => draft.title && draft.startAt)
    .filter((draft) => isPublicBookableMoMA(`${draft.description} ${draft.sourceUrl}`));
}

export const movingImageAdapter: VenueAdapter = {
  key: "moving-image",
  lane: "event_page",
  canHandle: (venue) => venue.slug === "museum-of-the-moving-image",
  async fetchIndexPages() {
    return [await fetchLiveText(MOVING_IMAGE_URL)];
  },
  async fetchEventPages() {
    return [];
  },
  async parseScreenings() {
    const [payload] = await this.fetchIndexPages();
    return parseMovingImageHtml(payload);
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
        detail: screenings.length > 0 ? "Ticketed/public screenings isolated" : "No public ticketed screenings found"
      };
    } catch (error) {
      return {
        ok: false,
        count: 0,
        detail: error instanceof Error ? error.message : "Moving Image fetch failed"
      };
    }
  }
};
