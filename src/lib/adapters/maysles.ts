import { ParsedScreeningDraft, VenueAdapter } from "@/lib/adapters/base";
import { findFilmMatch, normalizeDraftToScreening } from "@/lib/adapters/helpers";
import { fetchLiveText } from "@/lib/live-fetch";
import { inferTagsFromText } from "@/lib/tags";
import { collapseWhitespace, parseEasternLocalDateTime, stripHtml, toAbsoluteUrl } from "@/lib/utils";

const MAYSLES_CALENDAR_URL = "https://www.maysles.org/calendar";

function extractLinks(payload: string): string[] {
  const links = Array.from(payload.matchAll(/href="(\/calendar\/[^"#?]+)"/gi))
    .map((match) => match[1])
    .filter(Boolean);
  return Array.from(new Set(links)).map((path) => toAbsoluteUrl(path, MAYSLES_CALENDAR_URL));
}

function parseEventPage(payload: string, sourceUrl: string): ParsedScreeningDraft | null {
  const title =
    collapseWhitespace(stripHtml(payload.match(/<meta itemprop="name" content="([^"]+)"/i)?.[1] ?? ""))
      .replace(/\s+—\s+maysles documentary center$/i, "")
      .trim() ||
    collapseWhitespace(stripHtml(payload.match(/<h1[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>\s*<\/h1>/i)?.[1] ?? ""));
  if (!title) {
    return null;
  }

  const dateText = collapseWhitespace(
    stripHtml(payload.match(/<time class="event-date"[^>]*>([\s\S]*?)<\/time>/i)?.[1] ?? "")
  );
  const startText = collapseWhitespace(
    stripHtml(payload.match(/<time class="event-time-12hr-start"[^>]*>([\s\S]*?)<\/time>/i)?.[1] ?? "")
  );
  if (!dateText || !startText) {
    return null;
  }

  const dateMatch = dateText.match(/([A-Za-z]+),\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/);
  if (!dateMatch) {
    return null;
  }

  const [, , monthName, dayNumber, year] = dateMatch;
  const monthMap: Record<string, string> = {
    january: "01",
    february: "02",
    march: "03",
    april: "04",
    may: "05",
    june: "06",
    july: "07",
    august: "08",
    september: "09",
    october: "10",
    november: "11",
    december: "12"
  };
  const month = monthMap[monthName.toLowerCase()];
  if (!month) {
    return null;
  }

  const dayKey = `${year}-${month}-${dayNumber.padStart(2, "0")}`;
  const startAt = parseEasternLocalDateTime(dayKey, startText.replace(/\u202f/g, " ")).toISOString();

  const description =
    collapseWhitespace(stripHtml(payload.match(/<meta itemprop="description" content="([^"]+)"/i)?.[1] ?? "")) ||
    collapseWhitespace(stripHtml(payload.match(/<div class="sqs-layout[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? "")) ||
    `Listed on Maysles Documentary Center.`;

  const posterUrl =
    payload.match(/<meta itemprop="image" content="([^"]+)"/i)?.[1] ??
    payload.match(/<meta property="og:image" content="([^"]+)"/i)?.[1] ??
    payload.match(/<img[^>]+data-image="([^"]+)"/i)?.[1];

  const formatTags = inferTagsFromText(`${title} ${description}`);

  return {
    title,
    startAt,
    description,
    sourceUrl,
    rawPayload: payload,
    formatTags,
    film: {
      canonicalTitle: title,
      synopsis: description,
      posterUrl: posterUrl ? toAbsoluteUrl(posterUrl, sourceUrl) : undefined,
      metadataSourceIds: { maysles: sourceUrl }
    }
  };
}

export const mayslesAdapter: VenueAdapter = {
  key: "maysles-calendar",
  lane: "event_page",
  canHandle: (venue) => venue.slug === "maysles-documentary-center",
  async fetchIndexPages() {
    return [MAYSLES_CALENDAR_URL];
  },
  async fetchEventPages() {
    return [];
  },
  async parseScreenings() {
    const calendarPayload = await fetchLiveText(MAYSLES_CALENDAR_URL);
    const eventLinks = extractLinks(calendarPayload).slice(0, 30);
    const pages = await Promise.all(
      eventLinks.map(async (url) => {
        try {
          return { url, payload: await fetchLiveText(url) };
        } catch {
          return null;
        }
      })
    );

    return pages
      .filter((page): page is { url: string; payload: string } => Boolean(page))
      .map((page) => parseEventPage(page.payload, page.url))
      .filter((draft): draft is ParsedScreeningDraft => Boolean(draft));
  },
  normalize(draft, context) {
    return normalizeDraftToScreening(context.venue, findFilmMatch(draft.title, context.films), draft);
  },
  async healthCheck(context) {
    const screenings = await this.parseScreenings(context);
    return {
      ok: screenings.length > 0,
      count: screenings.length,
      detail: screenings.length > 0 ? "Parsed Maysles calendar pages" : "No Maysles screenings found"
    };
  }
};
