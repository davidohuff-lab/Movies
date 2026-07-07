import { VenueAdapter } from "@/lib/adapters/base";
import { findFilmMatch, normalizeDraftToScreening } from "@/lib/adapters/helpers";
import { fetchLiveText } from "@/lib/live-fetch";
import { inferTagsFromText } from "@/lib/tags";
import { collapseWhitespace, toAbsoluteUrl } from "@/lib/utils";

const BAM_FILM_URL = "https://www.bam.org/film";

function normalizeBamEventTitle(input: string): string {
  const title = collapseWhitespace(input);
  return title.replace(/\s+-\s+[A-Za-z]{3},?\s+[A-Za-z]{3}\s+\d{1,2}\s+at\s+\d{1,2}:\d{2}\s*[AP]M$/i, "").replace(/^["“”]|["“”]$/g, "").trim();
}

export function parseBamFilmLinks(payload: string): string[] {
  const links = Array.from(payload.matchAll(/href="(\/film\/\d{4}\/[^"?#]+\/?)"/g)).map((match) =>
    toAbsoluteUrl(match[1], BAM_FILM_URL)
  );
  return Array.from(new Set(links));
}

export function parseBamDetailEvents(payload: string, detailUrl: string) {
  const scriptMatches = Array.from(
    payload.matchAll(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/g)
  );

  const events: Array<{
    title: string;
    startAt: string;
    description: string;
    sourceUrl: string;
    rawPayload: string;
    formatTags: string[];
    film: { canonicalTitle: string; synopsis?: string; posterUrl?: string; metadataSourceIds: Record<string, string> };
  }> = [];

  for (const match of scriptMatches) {
    const rawJson = match[1];
    if (!rawJson) {
      continue;
    }
    try {
      const parsed = JSON.parse(rawJson) as unknown;
      const entries = Array.isArray(parsed) ? parsed : [parsed];
      for (const entry of entries) {
        if (!entry || typeof entry !== "object") {
          continue;
        }
        const event = entry as Record<string, unknown>;
        if (event["@type"] !== "Event") {
          continue;
        }
        const startDate = typeof event.startDate === "string" ? event.startDate : "";
        const name = typeof event.name === "string" ? event.name : "";
        if (!startDate || !name) {
          continue;
        }
        const status = typeof event.eventStatus === "string" ? event.eventStatus : "";
        if (/EventCancelled$/i.test(status)) {
          continue;
        }
        const title = normalizeBamEventTitle(name);
        const description = typeof event.description === "string" ? collapseWhitespace(event.description) : "Listed on BAM film page.";
        const image = typeof event.image === "string" ? toAbsoluteUrl(event.image, BAM_FILM_URL) : undefined;
        const offers = typeof event.offers === "object" && event.offers ? (event.offers as Record<string, unknown>) : null;
        const sourceUrl =
          (offers && typeof offers.url === "string" ? offers.url : undefined) ??
          detailUrl;

        events.push({
          title,
          startAt: new Date(startDate).toISOString(),
          description,
          sourceUrl: toAbsoluteUrl(sourceUrl, BAM_FILM_URL),
          rawPayload: rawJson,
          formatTags: inferTagsFromText(`${title} ${description}`),
          film: {
            canonicalTitle: title,
            synopsis: description || undefined,
            posterUrl: image,
            metadataSourceIds: { bam: detailUrl }
          }
        });
      }
    } catch {
      continue;
    }
  }

  return events;
}

export const bamAdapter: VenueAdapter = {
  key: "bam-rose-cinemas",
  lane: "event_page",
  canHandle: (venue) => venue.slug === "bam-rose-cinemas",
  async fetchIndexPages() {
    return [await fetchLiveText(BAM_FILM_URL)];
  },
  async fetchEventPages() {
    const [payload] = await this.fetchIndexPages();
    const links = parseBamFilmLinks(payload);
    return Promise.all(links.map((url) => fetchLiveText(url)));
  },
  async parseScreenings() {
    const [payload] = await this.fetchIndexPages();
    const links = parseBamFilmLinks(payload);
    const pages = await Promise.all(links.map((url) => fetchLiveText(url)));
    return pages.flatMap((page, index) => parseBamDetailEvents(page, links[index] ?? BAM_FILM_URL));
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
        detail: screenings.length > 0 ? "JSON-LD event schedule parsed from BAM film pages" : "No BAM screenings found"
      };
    } catch (error) {
      return {
        ok: false,
        count: 0,
        detail: error instanceof Error ? error.message : "BAM fetch failed"
      };
    }
  }
};
