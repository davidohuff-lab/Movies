import { VenueAdapter } from "@/lib/adapters/base";
import { findFilmMatch, normalizeDraftToScreening } from "@/lib/adapters/helpers";
import { fetchLiveText } from "@/lib/live-fetch";
import { inferTagsFromText } from "@/lib/tags";
import { collapseWhitespace, parseEasternLocalDateTime, stripHtml, toAbsoluteUrl } from "@/lib/utils";

const NITEHAWK_PROSPECT_PARK_URL = "https://nitehawkcinema.com/prospectpark/";
const NITEHAWK_WILLIAMSBURG_URL = "https://nitehawkcinema.com/williamsburg/";

function getVenueBaseUrl(venueSlug: string): string {
  if (venueSlug === "nitehawk-cinema-prospect-park") {
    return NITEHAWK_PROSPECT_PARK_URL;
  }
  return NITEHAWK_WILLIAMSBURG_URL;
}

function parseDateFromScheduleUrl(url: string): string | null {
  const match = url.match(/\/(\d{4}-\d{2}-\d{2})\/\d+\/?$/);
  return match?.[1] ?? null;
}

export function parseNitehawkScheduleUrls(payload: string, baseUrl: string): string[] {
  const dateBoxAnchors = Array.from(payload.matchAll(/<a[^>]+class="[^"]*date-box[^"]*"[^>]*>/g)).map((match) => match[0]);
  if (dateBoxAnchors.length === 0) {
    return [];
  }

  const links = dateBoxAnchors
    .map((anchor) => {
      const href = anchor.match(/href="([^"]+)"/)?.[1];
      const hasDate = /\bdata-date="(\d{4}-\d{2}-\d{2})"/.test(anchor);
      if (!href || !hasDate) {
        return null;
      }
      return toAbsoluteUrl(href, baseUrl);
    })
    .filter((url): url is string => Boolean(url))
    .filter((url) => Boolean(parseDateFromScheduleUrl(url)));
  return Array.from(new Set(links));
}

export function parseNitehawkSchedulePage(payload: string, baseUrl: string, scheduleDate: string) {
  return Array.from(
    payload.matchAll(/<li class="show-container thumbnail"[\s\S]*?<div class="showtimes-container[\s\S]*?<\/div>\s*<\/li>/g)
  )
    .flatMap((showMatch) => {
      const showPayload = showMatch[0];
      const title = collapseWhitespace(stripHtml(showPayload.match(/<div class="show-title">([\s\S]*?)<\/div>/)?.[1] ?? ""));
      if (!title) {
        return [];
      }

      const sourceUrl = toAbsoluteUrl(
        showPayload.match(/<a class="overlay-link" href="([^"]+)"/)?.[1] ?? baseUrl,
        baseUrl
      );
      const description = collapseWhitespace(
        stripHtml(showPayload.match(/<div class="short-description">([\s\S]*?)<\/div>/)?.[1] ?? "")
      );
      const posterUrl = toAbsoluteUrl(
        showPayload.match(/<div class="show-thumbnail"[^>]*style="[^"]*url\(([^)]+)\)/)?.[1] ?? "",
        baseUrl
      );
      const showtimeRows = Array.from(
        showPayload.matchAll(/<span[^>]+class="showtime[^"]*"[\s\S]*?>\s*([^<]+)\s*([\s\S]*?)<\/span>/g)
      );

      const drafts = showtimeRows.flatMap((row) => {
        const timeLabel = collapseWhitespace(stripHtml(row[1]));
        if (!timeLabel) {
          return [];
        }

        const rowPayload = `${row[0]} ${row[2]}`;
        const formatTags = inferTagsFromText(`${showPayload} ${rowPayload}`);
        const soldOut = /sold-out/i.test(rowPayload);
        return {
          title,
          startAt: parseEasternLocalDateTime(scheduleDate, timeLabel).toISOString(),
          description: description || "Listed on Nitehawk's ticket schedule page.",
          sourceUrl,
          rawPayload: showPayload,
          formatTags,
          soldOut,
          film: {
            canonicalTitle: title,
            synopsis: description || undefined,
            posterUrl: posterUrl || undefined,
            metadataSourceIds: { nitehawk: sourceUrl }
          }
        };
      });

      return drafts;
    })
    .filter((draft) => draft.title);
}

export const nitehawkAdapter: VenueAdapter = {
  key: "nitehawk",
  lane: "structured_html",
  canHandle: (venue) =>
    venue.slug === "nitehawk-cinema-prospect-park" || venue.slug === "nitehawk-cinema-williamsburg",
  async fetchIndexPages() {
    return [];
  },
  async fetchEventPages() {
    return [];
  },
  async parseScreenings(context) {
    const baseUrl = getVenueBaseUrl(context.venue.slug);
    const homePayload = await fetchLiveText(baseUrl);
    const scheduleUrls = parseNitehawkScheduleUrls(homePayload, baseUrl);

    const pages = scheduleUrls.length > 0 ? await Promise.all(scheduleUrls.map((url) => fetchLiveText(url))) : [homePayload];
    const pageUrls = scheduleUrls.length > 0 ? scheduleUrls : [baseUrl];

    return pages.flatMap((payload, index) => {
      const sourceUrl = pageUrls[index] ?? baseUrl;
      const scheduleDate = parseDateFromScheduleUrl(sourceUrl);
      if (!scheduleDate) {
        return [];
      }
      return parseNitehawkSchedulePage(payload, baseUrl, scheduleDate);
    });
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
        detail: screenings.length > 0 ? "Ticket schedule parsed for listed day links" : "No Nitehawk screenings found"
      };
    } catch (error) {
      return {
        ok: false,
        count: 0,
        detail: error instanceof Error ? error.message : "Nitehawk fetch failed"
      };
    }
  }
};
