import { VenueAdapter } from "@/lib/adapters/base";
import { findFilmMatch, normalizeDraftToScreening } from "@/lib/adapters/helpers";
import { fetchLiveText } from "@/lib/live-fetch";
import { inferTagsFromText } from "@/lib/tags";
import {
  collapseWhitespace,
  normalizeTitle,
  parseEasternLocalDateTime,
  stripHtml,
  toAbsoluteUrl
} from "@/lib/utils";

const SCREENSLATE_ROOT = "https://www.screenslate.com";
const SCREENSLATE_NYC_CITY_ID = "10969";

interface ScreenSlateDateItem {
  nid: string;
  field_time: string;
  field_note?: string;
  field_timestamp: string;
}

interface ScreenSlateDetailItem {
  nid: string;
  title?: string;
  field_display_title?: string;
  media_title_labels?: string;
  media_title_info?: string;
  field_series?: string;
  field_url?: string;
  body?: string;
  venue_title?: string;
  media_title_format?: string;
}

function formatDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function uniqueByNid(items: ScreenSlateDateItem[]): ScreenSlateDateItem[] {
  const map = new Map<string, ScreenSlateDateItem>();
  for (const item of items) {
    map.set(item.nid, item);
  }
  return Array.from(map.values());
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function extractSpanValues(input: string): string[] {
  return Array.from(input.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/gi))
    .map((match) => collapseWhitespace(stripHtml(match[1] ?? "")))
    .filter(Boolean);
}

function parseScreenSlateInfo(detail: ScreenSlateDetailItem) {
  const values = extractSpanValues(detail.media_title_info ?? "");
  const directors: string[] = [];
  let releaseYear: number | undefined;
  let runtimeMinutes: number | undefined;

  for (const value of values) {
    if (!releaseYear && /^\d{4}$/.test(value)) {
      releaseYear = Number.parseInt(value, 10);
      continue;
    }

    if (!runtimeMinutes) {
      const runtimeMatch = value.match(/^(\d+)\s*M$/i);
      if (runtimeMatch) {
        runtimeMinutes = Number.parseInt(runtimeMatch[1] ?? "0", 10);
        continue;
      }
    }

    if (/^(35mm|70mm|16mm|dcp|digital|imax)$/i.test(value)) {
      continue;
    }

    directors.push(value);
  }

  return {
    directors,
    releaseYear,
    runtimeMinutes
  };
}

function extractPrimaryTitle(detail: ScreenSlateDetailItem): string {
  const mediaLabels = (detail.media_title_labels ?? "")
    .split("|")
    .map((value) => collapseWhitespace(stripHtml(value)))
    .filter(Boolean);
  if (mediaLabels.length > 0) {
    return mediaLabels[0];
  }

  const displayTitle = collapseWhitespace(stripHtml(detail.field_display_title ?? ""));
  if (displayTitle) {
    return displayTitle;
  }

  return collapseWhitespace(stripHtml(detail.title ?? ""));
}

function isMoMAVenueName(value: string): boolean {
  const normalized = normalizeTitle(value);
  return normalized === "moma" || normalized === "moma film" || normalized === "museum of modern art";
}

async function fetchScreenSlateDate(dateKey: string): Promise<ScreenSlateDateItem[]> {
  const url = `${SCREENSLATE_ROOT}/api/screenings/date?_format=json&date=${dateKey.replace(/-/g, "")}&field_city_target_id=${SCREENSLATE_NYC_CITY_ID}`;
  const payload = await fetchLiveText(url);
  const parsed = JSON.parse(payload) as ScreenSlateDateItem[];
  return Array.isArray(parsed) ? parsed : [];
}

async function fetchScreenSlateDetails(nids: string[]): Promise<ScreenSlateDetailItem[]> {
  if (nids.length === 0) {
    return [];
  }

  const groups = chunk(nids, 80);
  const details: ScreenSlateDetailItem[] = [];
  for (const group of groups) {
    const payload = await fetchLiveText(`${SCREENSLATE_ROOT}/api/screenings/id/${group.join("+")}?_format=json`);
    const parsed = JSON.parse(payload) as ScreenSlateDetailItem[];
    if (Array.isArray(parsed)) {
      details.push(...parsed);
    }
  }
  return details;
}

export function parseMoMAScreenSlateEntries(
  dateKey: string,
  items: ScreenSlateDateItem[],
  details: ScreenSlateDetailItem[]
) {
  const detailByNid = new Map(details.map((detail) => [detail.nid, detail]));

  return items.flatMap((item) => {
    const detail = detailByNid.get(item.nid);
    if (!detail) {
      return [];
    }

    const venueName = collapseWhitespace(stripHtml(detail.venue_title ?? ""));
    if (!isMoMAVenueName(venueName)) {
      return [];
    }

    const title = extractPrimaryTitle(detail);
    if (!title) {
      return [];
    }

    const bodyDescription = collapseWhitespace(stripHtml(detail.body ?? ""));
    const noteDescription = collapseWhitespace(stripHtml(item.field_note ?? ""));
    const parsedInfo = parseScreenSlateInfo(detail);
    const sourceUrl = detail.field_url
      ? toAbsoluteUrl(detail.field_url, SCREENSLATE_ROOT)
      : `${SCREENSLATE_ROOT}/listings?date=${dateKey}`;
    const description = bodyDescription || noteDescription || "Listed on Screen Slate for MoMA Film Screenings.";
    const seriesName = collapseWhitespace(stripHtml(detail.field_series ?? "")) || undefined;
    const formatTags = inferTagsFromText(
      `${detail.media_title_format ?? ""} ${detail.media_title_info ?? ""} ${item.field_note ?? ""} ${detail.body ?? ""}`
    );

    return [
      {
        title,
        startAt: parseEasternLocalDateTime(dateKey, item.field_time).toISOString(),
        description,
        sourceUrl,
        seriesName,
        rawPayload: JSON.stringify({ screenSlate: { item, detail } }),
        formatTags,
        film: {
          canonicalTitle: title,
          synopsis: bodyDescription || undefined,
          directors: parsedInfo.directors,
          releaseYear: parsedInfo.releaseYear,
          runtimeMinutes: parsedInfo.runtimeMinutes,
          metadataSourceIds: { screenslate: String(item.nid), sourceUrl }
        }
      }
    ];
  });
}

export const momaAdapter: VenueAdapter = {
  key: "moma-film-screenings",
  lane: "event_page",
  canHandle: (venue) => venue.slug === "moma-film-screenings",
  async fetchIndexPages() {
    return [];
  },
  async fetchEventPages() {
    return [];
  },
  async parseScreenings() {
    const daysAhead = Number.parseInt(process.env.SCREENSLATE_DAYS_AHEAD ?? "7", 10);
    const maxDays = Number.isFinite(daysAhead) && daysAhead > 0 ? daysAhead : 7;
    const drafts = [];
    const todayKey = formatDateKey(new Date());
    const today = parseEasternLocalDateTime(todayKey, "12:00");

    for (let offset = 0; offset < maxDays; offset += 1) {
      const date = new Date(today);
      date.setUTCDate(date.getUTCDate() + offset);
      const dayKey = formatDateKey(date);
      const dateItems = await fetchScreenSlateDate(dayKey);
      const details = await fetchScreenSlateDetails(uniqueByNid(dateItems).map((item) => item.nid));
      drafts.push(...parseMoMAScreenSlateEntries(dayKey, dateItems, details));
    }

    return drafts;
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
        detail: screenings.length > 0 ? "MoMA screenings parsed from Screen Slate feed" : "No MoMA screenings found"
      };
    } catch (error) {
      return {
        ok: false,
        count: 0,
        detail: error instanceof Error ? error.message : "MoMA ingestion failed"
      };
    }
  }
};
