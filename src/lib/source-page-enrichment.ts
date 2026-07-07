import { Screening } from "@/lib/domain";
import { extractPosterFromPage } from "@/lib/poster-recovery";
import { fetchLiveText } from "@/lib/live-fetch";
import { collapseWhitespace, decodeHtmlEntities, normalizeTitle, stripHtml } from "@/lib/utils";

interface PayloadMetadata {
  title?: string;
  description?: string;
  releaseYear?: number;
  runtimeMinutes?: number;
  directors: string[];
}

function readMetaContent(payload: string, property: string): string | undefined {
  return (
    payload.match(new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, "i"))?.[1] ??
    payload.match(new RegExp(`<meta[^>]+name=["']${property}["'][^>]+content=["']([^"']+)["']`, "i"))?.[1]
  );
}

function isBoilerplateText(text: string): boolean {
  const normalized = normalizeTitle(text);
  if (!normalized) {
    return true;
  }

  return [
    "buy tickets",
    "watch trailer",
    "join our mailing list",
    "privacy policy",
    "terms of use",
    "eat drink",
    "showtimes at",
    "the cinephile",
    "view all",
    "learn more",
    "membership",
    "about",
    "faq"
  ].some((phrase) => normalized.includes(phrase));
}

function extractMetaDescription(payload: string): string | undefined {
  const description = cleanDescriptionText(
    collapseWhitespace(
      stripHtml(
        readMetaContent(payload, "og:description") ??
          readMetaContent(payload, "description") ??
          readMetaContent(payload, "twitter:description") ??
          ""
      )
    )
  );
  return description && !isBoilerplateText(description) ? description : undefined;
}

function cleanDescriptionText(text: string): string | undefined {
  const cleaned = collapseWhitespace(
    decodeHtmlEntities(text)
      .replace(/https?:\/\/\S+/gi, " ")
      .replace(/\bshow more\b/gi, " ")
      .replace(/\bselect tickets\b/gi, " ")
      .replace(/\s+[|·]+\s+/g, " ")
  ).trim();

  if (!cleaned || cleaned.length < 40 || isBoilerplateText(cleaned)) {
    return undefined;
  }

  return cleaned;
}

function extractStructuredDescription(payload: string, filmTitle: string): string | undefined {
  const normalizedTitle = normalizeTitle(filmTitle);
  let best: { text: string; score: number } | null = null;

  const descriptionPattern = /"description"\s*:\s*"((?:\\.|[^"\\])+)"/gi;
  let match: RegExpExecArray | null;
  while ((match = descriptionPattern.exec(payload))) {
    const candidate = cleanDescriptionText(
      match[1]
        .replace(/\\"/g, "\"")
        .replace(/\\n/g, " ")
        .replace(/\\u003c/gi, "<")
        .replace(/\\u003e/gi, ">")
        .replace(/\\u0026/gi, "&")
    );

    if (!candidate) {
      continue;
    }

    const normalizedCandidate = normalizeTitle(candidate);
    let score = candidate.length;

    if (normalizedTitle && normalizedCandidate.includes(normalizedTitle)) {
      score += 80;
    }

    if (/loosely based|follows|finds|struggling|stars|directed by|screening|selected by/i.test(candidate)) {
      score += 40;
    }

    if (!best || score > best.score) {
      best = { text: candidate, score };
    }
  }

  return best?.text;
}

function extractRoxyTicketingDescription(payload: string): string | undefined {
  const flattened = collapseWhitespace(stripHtml(payload));
  const match = flattened.match(/Location\s+Roxy Cinema New York\s+Screen\s+Roxy Cinema\s+(.+?)\s+Select tickets/i);
  return cleanDescriptionText(match?.[1] ?? "");
}

function extractMoMADescription(payload: string): string | undefined {
  const flattened = collapseWhitespace(stripHtml(payload));
  const match = flattened.match(
    /Image:\s+.+?\)\s*\.\s*\d{4}\.\s+.+?\. \d+mm\. \d+ min\.\s+(.+?)(?:This film accompanies|Events|Licensing)/i
  );
  return cleanDescriptionText(match?.[1] ?? "");
}

function extractBestBodyDescription(payload: string, filmTitle: string): string | undefined {
  const normalizedTitle = normalizeTitle(filmTitle);
  const titlePosition = normalizedTitle ? normalizeTitle(payload).indexOf(normalizedTitle) : -1;
  let best: { text: string; score: number } | null = null;

  const blockPattern = /<(p|div|section)[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = blockPattern.exec(payload))) {
    const raw = match[2];
    const text = cleanDescriptionText(collapseWhitespace(stripHtml(raw)));
    if (!text) {
      continue;
    }

    const normalizedText = normalizeTitle(text);
    let score = text.length;

    if (normalizedText && normalizedTitle && (normalizedText.includes(normalizedTitle) || normalizedTitle.includes(normalizedText))) {
      score += 180;
    }

    if (/[.!?]$/.test(text)) {
      score += 20;
    }

    if (/loosely based|follows|stars|directed by|screening|selected by|introduction/i.test(text)) {
      score += 35;
    }

    if (titlePosition >= 0) {
      const distance = Math.abs(match.index - titlePosition);
      if (distance < 6000) {
        score += 60;
      } else if (distance > 20000) {
        score -= 40;
      }
    }

    if (!best || score > best.score) {
      best = { text, score };
    }
  }

  return best?.text;
}

export function extractDescriptionFromSourcePage(payload: string, filmTitle: string): string | undefined {
  return (
    extractMetaDescription(payload) ??
    extractStructuredDescription(payload, filmTitle) ??
    extractMoMADescription(payload) ??
    extractRoxyTicketingDescription(payload) ??
    extractBestBodyDescription(payload, filmTitle)
  );
}

export async function enrichFilmDetailFromSourcePage(
  filmTitle: string,
  screenings: Screening[]
): Promise<{ posterUrl?: string; description?: string; sourceUrl?: string }> {
  const sourceUrls = Array.from(new Set(screenings.map((screening) => screening.sourceUrl).filter(Boolean))).slice(0, 3);

  for (const sourceUrl of sourceUrls) {
    try {
      const payload = await fetchLiveText(sourceUrl);
      const posterUrl = extractPosterFromPage(payload, sourceUrl, filmTitle);
      const description = extractDescriptionFromSourcePage(payload, filmTitle);
      if (posterUrl || description) {
        return { posterUrl, description, sourceUrl };
      }
    } catch {
      continue;
    }
  }

  return {};
}

export function extractScreeningDescriptionCandidate(screening: Screening): string | undefined {
  return cleanDescriptionText(collapseWhitespace(decodeHtmlEntities(stripHtml(screening.descriptionRaw ?? ""))));
}

function extractScreenSlatePrimaryTitle(payload: Record<string, unknown>): string | undefined {
  const detail = (payload.screenSlate as { detail?: Record<string, unknown> } | undefined)?.detail;
  if (!detail) {
    return undefined;
  }

  const mediaTitleLabels = typeof detail.media_title_labels === "string" ? detail.media_title_labels : "";
  const labels = Array.from(mediaTitleLabels.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/gi))
    .map((match) => collapseWhitespace(stripHtml(match[1] ?? "")))
    .filter(Boolean);
  if (labels.length > 0) {
    return labels[0];
  }

  const displayTitle = typeof detail.field_display_title === "string" ? collapseWhitespace(stripHtml(detail.field_display_title)) : "";
  if (displayTitle) {
    return displayTitle;
  }

  const rawTitle = typeof detail.title === "string" ? collapseWhitespace(stripHtml(detail.title)) : "";
  return rawTitle || undefined;
}

function parseScreenSlateInfoSpans(infoHtml: string): PayloadMetadata {
  const spans = Array.from(infoHtml.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/gi))
    .map((match) => collapseWhitespace(stripHtml(match[1] ?? "")))
    .filter(Boolean);

  const directors: string[] = [];
  let releaseYear: number | undefined;
  let runtimeMinutes: number | undefined;

  for (const entry of spans) {
    if (!releaseYear && /^\d{4}$/.test(entry)) {
      releaseYear = Number.parseInt(entry, 10);
      continue;
    }

    if (!runtimeMinutes) {
      const runtimeMatch = entry.match(/^(\d+)\s*M$/i);
      if (runtimeMatch) {
        runtimeMinutes = Number.parseInt(runtimeMatch[1] ?? "0", 10);
        continue;
      }
    }

    if (/^(35mm|70mm|16mm|dcp|digital|imax)$/i.test(entry)) {
      continue;
    }

    directors.push(entry);
  }

  return {
    directors,
    releaseYear,
    runtimeMinutes
  };
}

export function extractScreeningPayloadMetadata(screening: Screening): PayloadMetadata {
  try {
    const payload = JSON.parse(screening.rawPayload) as Record<string, unknown>;
    const detail = (payload.screenSlate as { detail?: Record<string, unknown> } | undefined)?.detail;
    const item = (payload.screenSlate as { item?: Record<string, unknown> } | undefined)?.item;
    if (!detail) {
      return { directors: [] };
    }

    const infoHtml = typeof detail.media_title_info === "string" ? detail.media_title_info : "";
    const bodyHtml = typeof detail.body === "string" ? detail.body : "";
    const noteText = typeof item?.field_note === "string" ? item.field_note : "";
    const title = extractScreenSlatePrimaryTitle(payload);
    const parsedInfo = parseScreenSlateInfoSpans(infoHtml);
    const description =
      cleanDescriptionText(collapseWhitespace(stripHtml(bodyHtml))) ??
      cleanDescriptionText(collapseWhitespace(stripHtml(noteText)));

    return {
      ...parsedInfo,
      title,
      description,
      directors: parsedInfo.directors
    };
  } catch {
    return { directors: [] };
  }
}
