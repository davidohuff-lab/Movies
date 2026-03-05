import { Film, Screening, Venue } from "@/lib/domain";

export interface ParsedFilmSeed {
  canonicalTitle?: string;
  originalTitle?: string;
  releaseYear?: number;
  runtimeMinutes?: number;
  directors?: string[];
  countries?: string[];
  languages?: string[];
  synopsis?: string;
  posterUrl?: string;
  criterionLikely?: boolean;
  metadataSourceIds?: Record<string, string>;
}

export interface ParsedScreeningDraft {
  title: string;
  startAt: string;
  description: string;
  sourceUrl: string;
  formatTags?: string[];
  seriesName?: string;
  rawPayload: string;
  soldOut?: boolean;
  film?: ParsedFilmSeed;
}

export interface AdapterContext {
  venue: Venue;
  films: Film[];
}

export interface VenueAdapter {
  key: string;
  lane: "ics" | "structured_html" | "event_page" | "headless" | "manual";
  canHandle(venue: Venue): boolean;
  fetchIndexPages(): Promise<string[]>;
  fetchEventPages(): Promise<string[]>;
  parseScreenings(context: AdapterContext): Promise<ParsedScreeningDraft[]>;
  parseVenueMetadata?(venue: Venue): Promise<Partial<Venue>>;
  normalize(draft: ParsedScreeningDraft, context: AdapterContext): Screening | null;
  healthCheck(context: AdapterContext): Promise<{ ok: boolean; count: number; detail: string }>;
}
