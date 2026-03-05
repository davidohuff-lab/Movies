import { Film } from "@/lib/domain";
import { fetchLiveText } from "@/lib/live-fetch";
import { collapseWhitespace, normalizeTitle, stripHtml } from "@/lib/utils";

const ROTTEN_TOMATOES_SEARCH_URL = "https://www.rottentomatoes.com/search?search=";

interface RottenTomatoesSearchResult {
  title: string;
  url: string;
  releaseYear?: number;
}

interface RottenTomatoesMovieMetadata {
  canonicalTitle?: string;
  synopsis?: string;
  posterUrl?: string;
  releaseYear?: number;
}

const rtCache = new Map<string, RottenTomatoesMovieMetadata | null>();

function parseReleaseYear(value: string | undefined): number | undefined {
  const year = Number(value ?? "");
  return Number.isNaN(year) ? undefined : year;
}

function cleanRtTitle(value: string): string {
  return collapseWhitespace(
    stripHtml(value)
      .replace(/\s+\|\s+Rotten Tomatoes$/i, "")
      .trim()
  );
}

export function hasWeakSynopsis(value?: string): boolean {
  if (!value) {
    return true;
  }

  const cleaned = collapseWhitespace(value);
  if (cleaned.length < 40) {
    return true;
  }

  return /^(back to films|listed on .*calendar|listed on .*widget|summary unavailable)\.?$/i.test(cleaned);
}

export function parseRottenTomatoesSearchHtml(payload: string): RottenTomatoesSearchResult[] {
  return Array.from(payload.matchAll(/<search-page-media-row[\s\S]*?release-year="([^"]*)"[\s\S]*?<a href="(https:\/\/www\.rottentomatoes\.com\/m\/[^"]+)" class="unset" data-qa="info-name" slot="title">\s*([\s\S]*?)\s*<\/a>/gi))
    .map((match) => ({
      title: cleanRtTitle(match[3] ?? ""),
      url: match[2],
      releaseYear: parseReleaseYear(match[1])
    }))
    .filter((candidate) => candidate.title && candidate.url);
}

export function parseRottenTomatoesMovieHtml(payload: string): RottenTomatoesMovieMetadata {
  const title =
    cleanRtTitle(payload.match(/<meta property="og:title" content="([^"]+)"/i)?.[1] ?? "") ||
    cleanRtTitle(payload.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const synopsis =
    collapseWhitespace(
      stripHtml(
        payload.match(/data-qa="synopsis-value">([\s\S]*?)<\/rt-text>/i)?.[1] ??
          payload.match(/"description":"([^"]+)"/i)?.[1] ??
          ""
      )
    ) || undefined;
  const posterUrl =
    payload.match(/<meta property="og:image" content="([^"]+)"/i)?.[1] ??
    payload.match(/"primaryImageUrl":"([^"]+)"/i)?.[1];
  const releaseYear = parseReleaseYear(payload.match(/"titleName":"[^"]+","titleType":"Movie"[\s\S]*?"release":"[^"]*?(\d{4})"/i)?.[1]);

  return {
    canonicalTitle: title || undefined,
    synopsis,
    posterUrl,
    releaseYear
  };
}

function chooseRottenTomatoesResult(film: Film, candidates: RottenTomatoesSearchResult[]) {
  const normalizedFilmTitle = normalizeTitle(film.canonicalTitle);
  const exactTitleMatches = candidates.filter((candidate) => normalizeTitle(candidate.title) === normalizedFilmTitle);
  if (exactTitleMatches.length === 0) {
    return null;
  }

  if (film.releaseYear) {
    const yearMatch = exactTitleMatches.find((candidate) => candidate.releaseYear === film.releaseYear);
    if (yearMatch) {
      return yearMatch;
    }
  }

  return exactTitleMatches[0] ?? null;
}

export async function fetchRottenTomatoesMetadata(film: Film): Promise<RottenTomatoesMovieMetadata | null> {
  const cacheKey = `${normalizeTitle(film.canonicalTitle)}-${film.releaseYear ?? "unknown"}`;
  const cached = rtCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const searchPayload = await fetchLiveText(`${ROTTEN_TOMATOES_SEARCH_URL}${encodeURIComponent(film.canonicalTitle)}`);
    const candidates = parseRottenTomatoesSearchHtml(searchPayload);
    const match = chooseRottenTomatoesResult(film, candidates);
    if (!match) {
      rtCache.set(cacheKey, null);
      return null;
    }

    const moviePayload = await fetchLiveText(match.url);
    const metadata = parseRottenTomatoesMovieHtml(moviePayload);
    if (
      !metadata.canonicalTitle ||
      normalizeTitle(metadata.canonicalTitle) !== normalizeTitle(film.canonicalTitle) ||
      (film.releaseYear && metadata.releaseYear && metadata.releaseYear !== film.releaseYear)
    ) {
      rtCache.set(cacheKey, null);
      return null;
    }

    rtCache.set(cacheKey, metadata);
    return metadata;
  } catch {
    rtCache.set(cacheKey, null);
    return null;
  }
}
