import { ParsedScreeningDraft, VenueAdapter } from "@/lib/adapters/base";
import { findFilmMatch, normalizeDraftToScreening } from "@/lib/adapters/helpers";
import { fetchLiveText } from "@/lib/live-fetch";
import { inferTagsFromText } from "@/lib/tags";
import {
  collapseWhitespace,
  parseEasternLocalDateTime,
  stripHtml,
  toAbsoluteUrl
} from "@/lib/utils";

const METROGRAPH_NYC_URL = "https://metrograph.com/nyc/";

interface MetrographFilmPageMetadata {
  canonicalTitle?: string;
  synopsis?: string;
  posterUrl?: string;
  directors?: string[];
  releaseYear?: number;
  runtimeMinutes?: number;
  formatTags?: string[];
}

const GENERIC_METROGRAPH_TITLES = new Set([
  "now playing",
  "showtimes",
  "all films",
  "back to films",
  "watch",
  "journal",
  "membership",
  "store",
  "eat & drink",
  "tickets",
  "location"
]);

function parseMetrographMetadata(metadata: string) {
  const parts = metadata.split("/").map((part) => collapseWhitespace(part));
  const directors = parts[0] ? [parts[0]] : [];
  const releaseYear = Number(parts.find((part) => /^\d{4}$/.test(part)) ?? "");
  const runtimeMinutes = Number(parts.find((part) => /\d+\s*min/i.test(part))?.match(/(\d+)/)?.[1] ?? "");
  const format = parts[parts.length - 1] ?? "";

  return {
    directors,
    releaseYear: Number.isNaN(releaseYear) ? undefined : releaseYear,
    runtimeMinutes: Number.isNaN(runtimeMinutes) ? undefined : runtimeMinutes,
    format
  };
}

function extractMetaContent(payload: string, property: string) {
  return payload.match(new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`, "i"))?.[1];
}

function cleanMetrographTitle(value: string) {
  return collapseWhitespace(
    stripHtml(value)
      .replace(/\s*[-|:]\s*now playing in (?:theater|theatre) at metrograph$/i, "")
      .replace(/\s+[|:-]\s+Metrograph$/i, "")
      .trim()
  );
}

function isUsefulMetrographTitle(value?: string) {
  if (!value) {
    return false;
  }

  const cleaned = cleanMetrographTitle(value);
  if (!cleaned) {
    return false;
  }

  return !GENERIC_METROGRAPH_TITLES.has(cleaned.toLowerCase());
}

export function parseMetrographFilmPageHtml(sourceUrl: string, payload: string): MetrographFilmPageMetadata {
  const posterUrl =
    extractMetaContent(payload, "og:image") ??
    payload.match(/<img[^>]+src="([^"]+)"[^>]*class="[^"]*(?:hero|poster|film)[^"]*"/i)?.[1] ??
    payload.match(/<img[^>]+class="[^"]*(?:hero|poster|film)[^"]*"[^>]+src="([^"]+)"/i)?.[1];
  const titleCandidates = [
    extractMetaContent(payload, "og:title"),
    extractMetaContent(payload, "twitter:title"),
    payload.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1],
    ...Array.from(payload.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)).map((match) => match[1])
  ]
    .map((candidate) => cleanMetrographTitle(candidate ?? ""))
    .filter(Boolean);
  const title = titleCandidates.find((candidate) => isUsefulMetrographTitle(candidate));
  const metadataRegion =
    payload.match(/DIRECTOR:\s*[\s\S]{0,500}?(?=Distributor:|Trailer|<\/section>|<\/article>|<\/main>|$)/i)?.[0] ?? "";
  const synopsis =
    collapseWhitespace(
      stripHtml(
        payload.match(/<div[^>]+class="[^"]*(?:synopsis|description|film-copy|entry-content)[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ??
          payload.match(/<p>([^<]{120,}.*?)<\/p>/i)?.[1] ??
          ""
      )
    ) || collapseWhitespace(extractMetaContent(payload, "description") ?? "");
  const metadataText = collapseWhitespace(stripHtml(metadataRegion));
  const directorLine = metadataText.match(/DIRECTOR:\s*([^/]+?)(?=\s+\d{4}\s*\/|$)/i)?.[1];
  const releaseYear = Number(metadataText.match(/\b(19|20)\d{2}\b/)?.[0] ?? "");
  const runtimeMinutes = Number(metadataText.match(/\b(\d{2,3})\s*MIN\b/i)?.[1] ?? "");
  const formatTags = inferTagsFromText(`${metadataText} ${synopsis}`);

  return {
    canonicalTitle: title || undefined,
    synopsis: synopsis || undefined,
    posterUrl,
    directors: directorLine ? [collapseWhitespace(directorLine)] : undefined,
    releaseYear: Number.isNaN(releaseYear) ? undefined : releaseYear,
    runtimeMinutes: Number.isNaN(runtimeMinutes) ? undefined : runtimeMinutes,
    formatTags
  };
}

export function parseMetrographNycHtml(payload: string): ParsedScreeningDraft[] {
  return Array.from(payload.matchAll(/<div class="calendar-list-day(?: movies-grid)?" id="calendar-list-day-(\d{4}-\d{2}-\d{2})">([\s\S]*?)(?=<div class="calendar-list-day|$)/g))
    .flatMap((dayMatch) => {
      const date = dayMatch[1];
      return dayMatch[2]
        .split('<div class="item film-thumbnail homepage-in-theater-movie">')
        .slice(1)
        .flatMap((item) => {
          const title = collapseWhitespace(stripHtml(item.match(/<a href="([^"]+)" class="title">([\s\S]*?)<\/a>/)?.[2] ?? ""));
          const sourceUrl = toAbsoluteUrl(item.match(/<a href="([^"]+)" class="title">/)?.[1] ?? "", METROGRAPH_NYC_URL);
          const posterUrl = item.match(/<img[^>]+src="([^"]+)"/)?.[1];
          const metadataText = collapseWhitespace(stripHtml(item.match(/<div class="film-metadata">([\s\S]*?)<\/div>/)?.[1] ?? ""));
          const description = collapseWhitespace(stripHtml(item.match(/<div class="film-description">([\s\S]*?)<\/div>/)?.[1] ?? ""));
          const metadata = parseMetrographMetadata(metadataText);
          const formatTags = inferTagsFromText(`${metadataText} ${description}`);
          if (/35mm/i.test(metadata.format) && !formatTags.includes("35MM")) {
            formatTags.push("35MM");
          }
          if (/70mm/i.test(metadata.format) && !formatTags.includes("70MM")) {
            formatTags.push("70MM");
          }

          return Array.from(item.matchAll(/<a([^>]*)>([^<]+)<\/a>/g))
            .filter((timeMatch) => /title="Buy Tickets"|class="sold_out"/.test(timeMatch[1]))
            .map((timeMatch) => {
              const time = collapseWhitespace(stripHtml(timeMatch[2]));
              const draft: ParsedScreeningDraft = {
                title,
                startAt: parseEasternLocalDateTime(date, time).toISOString(),
                description: description || "Listed on Metrograph's NYC calendar.",
                sourceUrl,
                rawPayload: item,
                formatTags,
                soldOut: /sold_out/.test(timeMatch[1]),
                film: {
                  canonicalTitle: title,
                  synopsis: description || undefined,
                  posterUrl,
                  directors: metadata.directors,
                  releaseYear: metadata.releaseYear,
                  runtimeMinutes: metadata.runtimeMinutes
                }
              };
              return draft;
            });
        });
    })
    .filter((draft) => draft.title);
}

export const metrographAdapter: VenueAdapter = {
  key: "metrograph",
  lane: "structured_html",
  canHandle: (venue) => venue.slug === "metrograph",
  async fetchIndexPages() {
    return [await fetchLiveText(METROGRAPH_NYC_URL)];
  },
  async fetchEventPages() {
    return [];
  },
  async parseScreenings() {
    const [payload] = await this.fetchIndexPages();
    const drafts = parseMetrographNycHtml(payload);
    const filmPages = Array.from(new Set(drafts.map((draft) => draft.sourceUrl).filter(Boolean)));
    const metadataEntries = await Promise.all(
      filmPages.map(async (sourceUrl) => {
        try {
          const filmPayload = await fetchLiveText(sourceUrl);
          return [sourceUrl, parseMetrographFilmPageHtml(sourceUrl, filmPayload)] as const;
        } catch {
          return [sourceUrl, null] as const;
        }
      })
    );
    const metadataByUrl = new Map(metadataEntries);

    return drafts.map((draft) => {
      const filmPage = metadataByUrl.get(draft.sourceUrl);
      if (!filmPage) {
        return draft;
      }

      return {
        ...draft,
        title: filmPage.canonicalTitle ?? draft.title,
        description: filmPage.synopsis ?? draft.description,
        formatTags: Array.from(new Set([...(draft.formatTags ?? []), ...(filmPage.formatTags ?? [])])),
        film: {
          canonicalTitle: filmPage.canonicalTitle ?? draft.film?.canonicalTitle ?? draft.title,
          posterUrl: filmPage.posterUrl ?? draft.film?.posterUrl,
          synopsis: filmPage.synopsis ?? draft.film?.synopsis,
          directors: filmPage.directors ?? draft.film?.directors,
          releaseYear: filmPage.releaseYear ?? draft.film?.releaseYear,
          runtimeMinutes: filmPage.runtimeMinutes ?? draft.film?.runtimeMinutes,
          metadataSourceIds: { metrograph: draft.sourceUrl }
        }
      };
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
        detail: screenings.length > 0 ? "NYC calendar listings parsed" : "No Metrograph screenings found"
      };
    } catch (error) {
      return {
        ok: false,
        count: 0,
        detail: error instanceof Error ? error.message : "Metrograph fetch failed"
      };
    }
  }
};
