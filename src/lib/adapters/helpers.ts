import { Film, Screening, Venue } from "@/lib/domain";
import { hashString, normalizeTitle, slugify } from "@/lib/utils";

export function findFilmMatch(title: string, films: Film[]): Film | undefined {
  const normalized = normalizeTitle(title);
  return films.find((film) => normalizeTitle(film.canonicalTitle) === normalized);
}

export function normalizeDraftToScreening(
  venue: Venue,
  film: Film | undefined,
  draft: {
    title: string;
    startAt: string;
    description: string;
    sourceUrl: string;
    formatTags?: string[];
    seriesName?: string;
    rawPayload: string;
    soldOut?: boolean;
  }
): Screening | null {
  if (!film) {
    return null;
  }

  const key = `${venue.slug}-${film.slug}-${draft.startAt}`;
  return {
    id: `screening-${slugify(key)}`,
    venueId: venue.id,
    filmId: film.id,
    startAt: new Date(draft.startAt).toISOString(),
    seriesName: draft.seriesName,
    eventTitleRaw: draft.title,
    descriptionRaw: draft.description,
    formatTags: draft.formatTags ?? [],
    userTags: [],
    sourceType: venue.adapterType === "ics" ? "ics" : venue.adapterType === "structured_html" ? "html" : "event_page",
    sourceUrl: draft.sourceUrl,
    sourceHash: hashString(`${key}-${draft.rawPayload}`),
    rawPayload: draft.rawPayload,
    lastSeenAt: new Date().toISOString(),
    isManualOverride: false,
    isCancelled: false,
    soldOut: draft.soldOut
  };
}
