import { VenueAdapter } from "@/lib/adapters/base";
import { findFilmMatch, normalizeDraftToScreening } from "@/lib/adapters/helpers";
import { fetchLiveText } from "@/lib/live-fetch";
import { inferTagsFromText } from "@/lib/tags";
import { collapseWhitespace, stripHtml, toAbsoluteUrl } from "@/lib/utils";

const ROXY_HOME_URL = "https://www.roxycinemanewyork.com/";

export function parseRoxyHomepageHtml(payload: string) {
  const cardBlocks = payload
    .split(/<div class='screening__card\b/i)
    .slice(1)
    .map((chunk) => `<div class='screening__card${chunk}`);

  return cardBlocks.flatMap((block) => {
    const title = collapseWhitespace(stripHtml(block.match(/<a class="screening__cta" href="[^"]+">([\s\S]*?)<\/a>/)?.[1] ?? ""));
    const sourceUrl = toAbsoluteUrl(block.match(/<a class="screening__cta" href="([^"]+)"/)?.[1] ?? ROXY_HOME_URL, ROXY_HOME_URL);
    const datetimeLabel = block.match(/data-datetime='([^']+)'/)?.[1];
    const posterUrl = toAbsoluteUrl(block.match(/<img [^>]*class="screening__image"[^>]*src="([^"]+)"/)?.[1] ?? "", ROXY_HOME_URL);
    const dateText = collapseWhitespace(stripHtml(block.match(/<p class='screening__date'>\s*([\s\S]*?)\s*<\/p>/)?.[1] ?? ""));
    if (!title || !datetimeLabel) {
      return [];
    }

    const startAt = new Date(datetimeLabel).toISOString();
    const description = dateText ? `Listed on Roxy now showing schedule: ${dateText}.` : "Listed on Roxy now showing schedule.";
    return [
      {
        title,
        startAt,
        description,
        sourceUrl,
        rawPayload: block,
        formatTags: inferTagsFromText(`${title} ${description}`),
        film: {
          canonicalTitle: title,
          posterUrl: posterUrl || undefined,
          metadataSourceIds: { roxy: sourceUrl }
        }
      }
    ];
  });
}

export const roxyAdapter: VenueAdapter = {
  key: "roxy-cinema-new-york",
  lane: "structured_html",
  canHandle: (venue) => venue.slug === "roxy-cinema-new-york",
  async fetchIndexPages() {
    return [await fetchLiveText(ROXY_HOME_URL)];
  },
  async fetchEventPages() {
    return [];
  },
  async parseScreenings() {
    const [payload] = await this.fetchIndexPages();
    return parseRoxyHomepageHtml(payload);
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
        detail: screenings.length > 0 ? "Now showing cards parsed from homepage" : "No Roxy screenings found"
      };
    } catch (error) {
      return {
        ok: false,
        count: 0,
        detail: error instanceof Error ? error.message : "Roxy fetch failed"
      };
    }
  }
};
