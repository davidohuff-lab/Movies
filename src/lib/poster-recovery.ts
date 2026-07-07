import { Screening } from "@/lib/domain";
import { fetchLiveText } from "@/lib/live-fetch";
import { collapseWhitespace, normalizeTitle, stripHtml, toAbsoluteUrl } from "@/lib/utils";

function readMetaContent(payload: string, property: string): string | undefined {
  return (
    payload.match(new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, "i"))?.[1] ??
    payload.match(new RegExp(`<meta[^>]+name=["']${property}["'][^>]+content=["']([^"']+)["']`, "i"))?.[1]
  );
}

function isLikelyImageUrl(url: string): boolean {
  return /\.(avif|gif|jpe?g|png|webp)(\?|$)/i.test(url) || /image\/upload|cloudinary|imgix/i.test(url);
}

function isLikelyLogo(url: string, context: string): boolean {
  return /logo|wordmark|favicon|icon|avatar|badge|sprite/i.test(`${url} ${context}`);
}

function readAttribute(tag: string, attribute: string): string | undefined {
  return (
    tag.match(new RegExp(`${attribute}=["']([^"']+)["']`, "i"))?.[1] ??
    tag.match(new RegExp(`${attribute}=([^\\s>]+)`, "i"))?.[1]
  );
}

function extractJsonLdImage(payload: string, sourceUrl: string): string | undefined {
  const matches = payload.match(/"image"\s*:\s*("(.*?)"|\[(.*?)\])/gis) ?? [];
  for (const match of matches) {
    const urlMatch = match.match(/https?:\/\/[^"'\]\s]+/i) ?? match.match(/"([^"]+)"/);
    const candidate = urlMatch?.[1] ?? urlMatch?.[0];
    if (!candidate) {
      continue;
    }
    const absolute = toAbsoluteUrl(candidate, sourceUrl);
    if (isLikelyImageUrl(absolute) && !isLikelyLogo(absolute, match)) {
      return absolute;
    }
  }
  return undefined;
}

function extractBestImageFromImgTags(payload: string, sourceUrl: string, filmTitle: string): string | undefined {
  const normalizedTitle = normalizeTitle(filmTitle);
  let bestCandidate: { url: string; score: number } | null = null;

  for (const tag of payload.match(/<img\b[^>]*>/gi) ?? []) {
    const src =
      readAttribute(tag, "src") ??
      readAttribute(tag, "data-src") ??
      readAttribute(tag, "data-lazy-src") ??
      readAttribute(tag, "data-original");
    if (!src) {
      continue;
    }

    const absolute = toAbsoluteUrl(src, sourceUrl);
    if (!isLikelyImageUrl(absolute)) {
      continue;
    }

    const context = collapseWhitespace(
      stripHtml(
        [
          readAttribute(tag, "alt") ?? "",
          readAttribute(tag, "title") ?? "",
          readAttribute(tag, "class") ?? "",
          readAttribute(tag, "id") ?? ""
        ].join(" ")
      )
    );

    if (isLikelyLogo(absolute, context)) {
      continue;
    }

    const normalizedContext = normalizeTitle(context);
    let score = 0;
    if (normalizedContext.includes(normalizedTitle) || normalizedTitle.includes(normalizedContext)) {
      score += 6;
    }
    if (/poster|hero|featured|slide|film|movie|still/i.test(context)) {
      score += 3;
    }
    if (/thumbnail|thumb/i.test(context)) {
      score -= 2;
    }

    if (!bestCandidate || score > bestCandidate.score) {
      bestCandidate = { url: absolute, score };
    }
  }

  return bestCandidate?.score && bestCandidate.score > 0 ? bestCandidate.url : undefined;
}

function extractBestImageFromStyledBlocks(payload: string, sourceUrl: string, filmTitle: string): string | undefined {
  const normalizedTitle = normalizeTitle(filmTitle);
  let bestCandidate: { url: string; score: number } | null = null;

  const tagPattern = /<([a-z0-9]+)\b[^>]*style=["'][^"']*background-image\s*:\s*url\(([^)]+)\)[^"']*["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(payload))) {
    const candidate = match[2]?.replace(/^["']|["']$/g, "").trim();
    if (!candidate) {
      continue;
    }

    const absolute = toAbsoluteUrl(candidate, sourceUrl);
    if (!isLikelyImageUrl(absolute)) {
      continue;
    }

    const tag = match[0];
    const context = collapseWhitespace(
      stripHtml(
        [
          readAttribute(tag, "aria-label") ?? "",
          readAttribute(tag, "title") ?? "",
          readAttribute(tag, "class") ?? "",
          readAttribute(tag, "id") ?? ""
        ].join(" ")
      )
    );

    if (isLikelyLogo(absolute, context)) {
      continue;
    }

    const normalizedContext = normalizeTitle(context);
    let score = 1;
    if (normalizedContext.includes(normalizedTitle) || normalizedTitle.includes(normalizedContext)) {
      score += 6;
    }
    if (/poster|hero|featured|slide|film|movie|still/i.test(context)) {
      score += 3;
    }

    if (!bestCandidate || score > bestCandidate.score) {
      bestCandidate = { url: absolute, score };
    }
  }

  return bestCandidate?.score && bestCandidate.score > 0 ? bestCandidate.url : undefined;
}

function extractDirectImageUrls(payload: string, sourceUrl: string, filmTitle: string): string | undefined {
  const normalizedTitle = normalizeTitle(filmTitle);
  let bestCandidate: { url: string; score: number } | null = null;

  const candidates = payload.match(/https?:\/\/[^"'()\s]+\.(?:avif|gif|jpe?g|png|webp)(?:\?[^"'()\s]*)?/gi) ?? [];
  for (const candidate of candidates) {
    const absolute = toAbsoluteUrl(candidate, sourceUrl);
    if (!isLikelyImageUrl(absolute)) {
      continue;
    }
    if (isLikelyLogo(absolute, filmTitle)) {
      continue;
    }

    let score = 1;
    if (/\/d\/assets\//i.test(absolute)) {
      score += 4;
    }
    if (normalizeTitle(absolute).includes(normalizedTitle)) {
      score += 5;
    }
    if (/photofest|poster|still|hero/i.test(absolute)) {
      score += 2;
    }

    if (!bestCandidate || score > bestCandidate.score) {
      bestCandidate = { url: absolute, score };
    }
  }

  return bestCandidate?.score && bestCandidate.score > 0 ? bestCandidate.url : undefined;
}

export function extractPosterFromPage(payload: string, sourceUrl: string, filmTitle: string): string | undefined {
  const metaCandidates = [
    readMetaContent(payload, "og:image"),
    readMetaContent(payload, "twitter:image"),
    readMetaContent(payload, "twitter:image:src")
  ]
    .filter(Boolean)
    .map((value) => toAbsoluteUrl(value ?? "", sourceUrl))
    .filter((value) => isLikelyImageUrl(value) && !isLikelyLogo(value, filmTitle));

  if (metaCandidates.length > 0) {
    return metaCandidates[0];
  }

  return (
    extractJsonLdImage(payload, sourceUrl) ??
    extractBestImageFromImgTags(payload, sourceUrl, filmTitle) ??
    extractBestImageFromStyledBlocks(payload, sourceUrl, filmTitle) ??
    extractDirectImageUrls(payload, sourceUrl, filmTitle)
  );
}

export async function recoverPosterFromScreeningPages(
  filmTitle: string,
  screenings: Screening[],
  cache: Map<string, string | null>,
  fetchLimit: { remaining: number }
): Promise<{ posterUrl?: string; sourceUrl?: string }> {
  const sourceUrls = Array.from(new Set(screenings.map((screening) => screening.sourceUrl).filter(Boolean))).slice(0, 3);

  for (const sourceUrl of sourceUrls) {
    if (cache.has(sourceUrl)) {
      const cached = cache.get(sourceUrl);
      if (cached) {
        return { posterUrl: cached, sourceUrl };
      }
      continue;
    }

    if (fetchLimit.remaining <= 0) {
      break;
    }
    fetchLimit.remaining -= 1;

    try {
      const payload = await fetchLiveText(sourceUrl);
      const posterUrl = extractPosterFromPage(payload, sourceUrl, filmTitle);
      cache.set(sourceUrl, posterUrl ?? null);
      if (posterUrl) {
        return { posterUrl, sourceUrl };
      }
    } catch {
      cache.set(sourceUrl, null);
    }
  }

  return {};
}
