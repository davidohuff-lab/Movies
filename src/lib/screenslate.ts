import { ParsedScreeningDraft } from "@/lib/adapters/base";
import { Venue } from "@/lib/domain";
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

interface ExternalPageMeta {
  description?: string;
  image?: string;
}

interface ParsedScreenSlateInfo {
  directors: string[];
  releaseYear?: number;
  runtimeMinutes?: number;
}

const VENUE_ALIASES: Record<string, string> = {
  "ifc": "ifc-center",
  "amc lincoln square 13": "amc-lincoln-square-13",
  "amc lincoln square 13 imax": "amc-lincoln-square-13",
  "amc lincoln square imax": "amc-lincoln-square-13",
  "amc 13 imax": "amc-lincoln-square-13",
  "amc 14 imax": "amc-lincoln-square-13",
  "alamo": "alamo-drafthouse",
  "alamo drafthouse": "alamo-drafthouse",
  "angelika": "angelika-film-center",
  "angelika film center": "angelika-film-center",
  "angelika nyc": "angelika-film-center",
  "anthology": "anthology-film-archives",
  "anthology film archives": "anthology-film-archives",
  "bam": "bam-rose-cinemas",
  "bam rose": "bam-rose-cinemas",
  "bam rose cinemas": "bam-rose-cinemas",
  "cinema village": "cinema-village",
  "moma": "moma-film-screenings",
  "museum of modern art": "moma-film-screenings",
  "moma film": "moma-film-screenings",
  "museum of the moving image": "museum-of-the-moving-image",
  "moving image": "museum-of-the-moving-image",
  "nitehawk prospect park": "nitehawk-cinema-prospect-park",
  "nitehawk williamsburg": "nitehawk-cinema-williamsburg",
  "film at lincoln center": "film-at-lincoln-center",
  "film at lincoln ctr": "film-at-lincoln-center",
  "film noir": "film-noir-cinema",
  "film noir cinema": "film-noir-cinema",
  "roxy": "roxy-cinema-new-york",
  "roxy cinema": "roxy-cinema-new-york",
  "roxy cinema new york": "roxy-cinema-new-york",
  "paris theater": "paris-theater",
  "firehouse": "firehouse-dctvs-cinema-for-documentary-film",
  "firehouse cinema": "firehouse-dctvs-cinema-for-documentary-film",
  "dctv": "firehouse-dctvs-cinema-for-documentary-film",
  "dctv firehouse": "firehouse-dctvs-cinema-for-documentary-film",
  "dctv's cinema for documentary film": "firehouse-dctvs-cinema-for-documentary-film",
  "light industry": "light-industry",
  "e-flux": "e-flux-screening-room",
  "e flux": "e-flux-screening-room",
  "e-flux screening room": "e-flux-screening-room",
  "millennium": "millennium-film-workshop",
  "millennium film workshop": "millennium-film-workshop",
  "maysles": "maysles-documentary-center",
  "maysles documentary center": "maysles-documentary-center",
  "syndicated": "syndicated",
  "spectacle": "spectacle-theater",
  "spectacle theater": "spectacle-theater",
  "low": "low-cinema",
  "low cinema": "low-cinema",
  "village east": "village-east-by-angelika",
  "village east by angelika": "village-east-by-angelika",
  "cinema 123": "cinema-123-by-angelika",
  "cinema 123 by angelika": "cinema-123-by-angelika"
};

function formatDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function toApiDate(dateKey: string): string {
  return dateKey.replace(/-/g, "");
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function readMetaContent(payload: string, property: string): string | undefined {
  return (
    payload.match(new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, "i"))?.[1] ??
    payload.match(new RegExp(`<meta[^>]+name=["']${property}["'][^>]+content=["']([^"']+)["']`, "i"))?.[1]
  );
}

function parseExternalPageMeta(payload: string, sourceUrl: string): ExternalPageMeta {
  const description = collapseWhitespace(
    stripHtml(readMetaContent(payload, "description") ?? readMetaContent(payload, "og:description") ?? "")
  );
  const image = readMetaContent(payload, "og:image") ?? readMetaContent(payload, "twitter:image");
  return {
    description: description || undefined,
    image: image ? toAbsoluteUrl(image, sourceUrl) : undefined
  };
}

function extractVenueName(input: string): string {
  return collapseWhitespace(stripHtml(input));
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

  const fallback = collapseWhitespace(stripHtml(detail.title ?? ""));
  if (!fallback) {
    return "";
  }
  return fallback.replace(/\s+at\s+.+$/i, "").trim();
}

function extractSpanValues(input: string): string[] {
  return Array.from(input.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/gi))
    .map((match) => collapseWhitespace(stripHtml(match[1] ?? "")))
    .filter(Boolean);
}

function parseScreenSlateInfo(detail: ScreenSlateDetailItem): ParsedScreenSlateInfo {
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

function mapVenueNameToCuratedVenue(venueName: string, venues: Venue[]): Venue | undefined {
  const normalizedTarget = normalizeTitle(venueName);
  const aliasSlug = VENUE_ALIASES[normalizedTarget];
  if (aliasSlug) {
    const aliasedVenue = venues.find((venue) => venue.slug === aliasSlug);
    if (aliasedVenue) {
      return aliasedVenue;
    }
  }

  const exact = venues.find((venue) => normalizeTitle(venue.name) === normalizedTarget);
  if (exact) {
    return exact;
  }

  return venues.find((venue) => {
    const normalizedVenue = normalizeTitle(venue.name);
    return normalizedVenue.includes(normalizedTarget) || normalizedTarget.includes(normalizedVenue);
  });
}

function passesVenueSpecificRules(venue: Venue, sourceText: string): boolean {
  if (venue.slug !== "amc-lincoln-square-13") {
    return true;
  }
  return /\bimax\b/i.test(sourceText);
}

function uniqueByNid(items: ScreenSlateDateItem[]): ScreenSlateDateItem[] {
  const map = new Map<string, ScreenSlateDateItem>();
  for (const item of items) {
    map.set(item.nid, item);
  }
  return Array.from(map.values());
}

async function fetchScreenSlateDate(dateKey: string): Promise<ScreenSlateDateItem[]> {
  const date = toApiDate(dateKey);
  const url = `${SCREENSLATE_ROOT}/api/screenings/date?_format=json&date=${date}&field_city_target_id=${SCREENSLATE_NYC_CITY_ID}`;
  const payload = await fetchLiveText(url);
  const parsed = JSON.parse(payload) as ScreenSlateDateItem[];
  return Array.isArray(parsed) ? parsed : [];
}

async function fetchScreenSlateDetails(nids: string[]): Promise<ScreenSlateDetailItem[]> {
  if (nids.length === 0) {
    return [];
  }

  const chunks = chunk(nids, 80);
  const all: ScreenSlateDetailItem[] = [];
  for (const group of chunks) {
    const url = `${SCREENSLATE_ROOT}/api/screenings/id/${group.join("+")}?_format=json`;
    const payload = await fetchLiveText(url);
    const parsed = JSON.parse(payload) as ScreenSlateDetailItem[];
    if (Array.isArray(parsed)) {
      all.push(...parsed);
    }
  }
  return all;
}

async function fetchPageMetaWithCache(
  sourceUrl: string,
  cache: Map<string, ExternalPageMeta | null>
): Promise<ExternalPageMeta | null> {
  if (cache.has(sourceUrl)) {
    return cache.get(sourceUrl) ?? null;
  }

  try {
    const payload = await fetchLiveText(sourceUrl);
    const meta = parseExternalPageMeta(payload, sourceUrl);
    cache.set(sourceUrl, meta);
    return meta;
  } catch {
    cache.set(sourceUrl, null);
    return null;
  }
}

export async function ingestScreenSlateScreenings(venues: Venue[]): Promise<{
  drafts: Array<ParsedScreeningDraft & { venue: Venue }>;
  warnings: string[];
}> {
  const warnings: string[] = [];
  const pageMetaCache = new Map<string, ExternalPageMeta | null>();
  const drafts: Array<ParsedScreeningDraft & { venue: Venue }> = [];

  const daysAhead = Number.parseInt(process.env.SCREENSLATE_DAYS_AHEAD ?? "14", 10);
  const maxDays = Number.isFinite(daysAhead) && daysAhead > 0 ? daysAhead : 14;
  const pageMetaLimitRaw = Number.parseInt(process.env.SCREENSLATE_PAGE_META_LIMIT ?? "0", 10);
  const pageMetaLimit = Number.isFinite(pageMetaLimitRaw) && pageMetaLimitRaw >= 0 ? pageMetaLimitRaw : 0;
  let fetchedPageMetaCount = 0;

  const todayKey = formatDateKey(new Date());
  const today = parseEasternLocalDateTime(todayKey, "12:00");

  for (let offset = 0; offset < maxDays; offset += 1) {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() + offset);
    const dayKey = formatDateKey(date);

    try {
      const dateItems = await fetchScreenSlateDate(dayKey);
      const uniqueItems = uniqueByNid(dateItems);
      const details = await fetchScreenSlateDetails(uniqueItems.map((item) => item.nid));
      const detailByNid = new Map(details.map((detail) => [detail.nid, detail]));

      for (const item of dateItems) {
        const detail = detailByNid.get(item.nid);
        if (!detail) {
          continue;
        }

        const venueName = extractVenueName(detail.venue_title ?? "");
        const venue = mapVenueNameToCuratedVenue(venueName, venues);
        if (!venue) {
          continue;
        }
        if (venue.slug === "moma-film-screenings") {
          continue;
        }

        const title = extractPrimaryTitle(detail);
        if (!title) {
          continue;
        }

        const sourceUrl = detail.field_url
          ? toAbsoluteUrl(detail.field_url, SCREENSLATE_ROOT)
          : `${SCREENSLATE_ROOT}/listings?date=${dayKey}`;

        let pageMeta: ExternalPageMeta | null = null;
        if (detail.field_url && fetchedPageMetaCount < pageMetaLimit) {
          pageMeta = await fetchPageMetaWithCache(sourceUrl, pageMetaCache);
          fetchedPageMetaCount += 1;
        }

        const sourceText = [
          title,
          venueName,
          stripHtml(detail.media_title_info ?? ""),
          stripHtml(detail.body ?? ""),
          stripHtml(item.field_note ?? ""),
          stripHtml(detail.media_title_format ?? ""),
          pageMeta?.description ?? "",
          sourceUrl
        ]
          .filter(Boolean)
          .join(" ");

        if (!passesVenueSpecificRules(venue, sourceText)) {
          continue;
        }

        const bodyDescription = collapseWhitespace(stripHtml(detail.body ?? ""));
        const noteDescription = collapseWhitespace(stripHtml(item.field_note ?? ""));
        const description =
          bodyDescription ||
          noteDescription ||
          pageMeta?.description ||
          `Listed on Screen Slate for ${venue.name}.`;
        const parsedInfo = parseScreenSlateInfo(detail);

        const startAt = parseEasternLocalDateTime(dayKey, item.field_time).toISOString();
        const seriesName = collapseWhitespace(stripHtml(detail.field_series ?? "")) || undefined;
        const formatTags = inferTagsFromText(
          `${detail.media_title_format ?? ""} ${detail.media_title_info ?? ""} ${item.field_note ?? ""}`
        );
        if (venue.slug === "amc-lincoln-square-13" && !formatTags.includes("IMAX")) {
          formatTags.push("IMAX");
        }

        drafts.push({
          venue,
          title,
          startAt,
          description,
          sourceUrl,
          seriesName,
          rawPayload: JSON.stringify({ screenSlate: { item, detail } }),
          formatTags,
          film: {
            canonicalTitle: title,
            synopsis: pageMeta?.description || undefined,
            posterUrl: pageMeta?.image || undefined,
            directors: parsedInfo.directors,
            releaseYear: parsedInfo.releaseYear,
            runtimeMinutes: parsedInfo.runtimeMinutes,
            metadataSourceIds: { screenslate: String(item.nid), sourceUrl }
          }
        });
      }
    } catch (error) {
      warnings.push(`Screen Slate ${dayKey}: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  return { drafts, warnings };
}

export const __testables__ = {
  extractVenueName,
  extractPrimaryTitle,
  mapVenueNameToCuratedVenue,
  parseExternalPageMeta,
  parseScreenSlateInfo
};
