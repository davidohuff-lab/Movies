import { ParsedScreeningDraft, VenueAdapter } from "@/lib/adapters/base";
import { findFilmMatch, normalizeDraftToScreening } from "@/lib/adapters/helpers";
import { fetchLiveText } from "@/lib/live-fetch";
import { inferTagsFromText } from "@/lib/tags";
import { collapseWhitespace, normalizeClockLabel, parseEasternLocalDateTime, stripHtml, toAbsoluteUrl } from "@/lib/utils";

const SYNDICATED_SHOWTIMES_URL = "https://ticketing.useast.veezi.com/sessions/?siteToken=dxdq5wzbef6bz2sjqt83ytzn1c";

function monthNumber(month: string): string | undefined {
  const months: Record<string, string> = {
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
  return months[month.toLowerCase()];
}

export function parseSyndicatedVeezi(payload: string): ParsedScreeningDraft[] {
  const dateBlocks = Array.from(
    payload.matchAll(/<div class="date">\s*<h3 class="date-title[^"]*">([\s\S]*?)<\/h3>([\s\S]*?)(?=<div class="date">|<\/div>\s*<\/div>\s*<\/div>\s*$)/gi)
  );

  const currentYear = new Date().getFullYear();
  const drafts: ParsedScreeningDraft[] = [];

  for (const [, rawDate, block] of dateBlocks) {
    const dateText = collapseWhitespace(stripHtml(rawDate));
    const dateMatch = dateText.match(/^[A-Za-z]+\s+(\d{1,2}),\s+([A-Za-z]+)$/);
    if (!dateMatch) {
      continue;
    }
    const day = dateMatch[1].padStart(2, "0");
    const month = monthNumber(dateMatch[2]);
    if (!month) {
      continue;
    }
    const dayKey = `${currentYear}-${month}-${day}`;

    const filmBlocks = Array.from(
      block.matchAll(/<div\s+class="film[\s\S]*?<div class="poster-container">([\s\S]*?)<\/div>\s*<div>[\s\S]*?<h3 class="title">\s*([\s\S]*?)\s*<\/h3>[\s\S]*?<ul class="session-times">([\s\S]*?)<\/ul>/gi)
    );

    for (const [, posterChunk, rawTitle, timesChunk] of filmBlocks) {
      const title = collapseWhitespace(stripHtml(rawTitle));
      if (!title) {
        continue;
      }

      const posterUrl = posterChunk.match(/<img class="poster" src="([^"]+)"/i)?.[1];
      const timeLinks = Array.from(timesChunk.matchAll(/<a href="([^"]+)">[\s\S]*?<time>([\s\S]*?)<\/time>/gi));
      for (const [, href, rawTime] of timeLinks) {
        const clock = normalizeClockLabel(collapseWhitespace(stripHtml(rawTime)));
        const startAt = parseEasternLocalDateTime(dayKey, clock).toISOString();
        const sourceUrl = toAbsoluteUrl(href, SYNDICATED_SHOWTIMES_URL);
        const description = `Listed on Syndicated showtimes.`;
        drafts.push({
          title,
          startAt,
          description,
          sourceUrl,
          rawPayload: `${dateText}\n${title}\n${timesChunk}`,
          formatTags: inferTagsFromText(title),
          film: {
            canonicalTitle: title,
            synopsis: description,
            posterUrl: posterUrl ? toAbsoluteUrl(posterUrl, SYNDICATED_SHOWTIMES_URL) : undefined,
            metadataSourceIds: { syndicated: sourceUrl }
          }
        });
      }
    }
  }

  return drafts;
}

export const syndicatedAdapter: VenueAdapter = {
  key: "syndicated-veezi",
  lane: "structured_html",
  canHandle: (venue) => venue.slug === "syndicated",
  async fetchIndexPages() {
    return [SYNDICATED_SHOWTIMES_URL];
  },
  async fetchEventPages() {
    return [];
  },
  async parseScreenings() {
    const payload = await fetchLiveText(SYNDICATED_SHOWTIMES_URL);
    return parseSyndicatedVeezi(payload);
  },
  normalize(draft, context) {
    return normalizeDraftToScreening(context.venue, findFilmMatch(draft.title, context.films), draft);
  },
  async healthCheck(context) {
    const screenings = await this.parseScreenings(context);
    return {
      ok: screenings.length > 0,
      count: screenings.length,
      detail: screenings.length > 0 ? "Parsed Syndicated Veezi showtimes" : "No Syndicated screenings found"
    };
  }
};
