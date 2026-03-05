export type SourceType = "ics" | "html" | "event_page" | "manual" | "api";

export type TagType = "genre" | "format" | "venue" | "program" | "manual";

export type ThumbValue = "up" | "down";

export type AdapterLane = "ics" | "structured_html" | "event_page" | "headless" | "manual";

export interface Venue {
  id: string;
  name: string;
  slug: string;
  website: string;
  address: string;
  borough: string;
  lat: number;
  lng: number;
  neighborhood: string;
  nearestSubwayStops: string[];
  active: boolean;
  adapterType: string;
  notes?: string;
  includeRules?: string[];
  tags: string[];
}

export interface Film {
  id: string;
  slug: string;
  canonicalTitle: string;
  originalTitle?: string;
  releaseYear?: number;
  runtimeMinutes?: number;
  directors: string[];
  countries: string[];
  languages: string[];
  metadataSourceIds?: Record<string, string>;
  synopsis?: string;
  aiSummary?: string;
  posterUrl?: string;
  criterionLikely?: boolean;
}

export interface Screening {
  id: string;
  venueId: string;
  filmId: string;
  startAt: string;
  endAt?: string;
  seriesName?: string;
  eventTitleRaw: string;
  descriptionRaw: string;
  formatTags: string[];
  userTags: string[];
  sourceType: SourceType;
  sourceUrl: string;
  sourceHash: string;
  rawPayload: string;
  lastSeenAt: string;
  isManualOverride: boolean;
  isCancelled: boolean;
  soldOut?: boolean;
}

export interface Tag {
  id: string;
  slug: string;
  name: string;
  type: TagType;
  active: boolean;
}

export interface ScreeningTag {
  screeningId: string;
  tagId: string;
  confidence: number;
  source: "parsed" | "inferred" | "manual" | "ai";
}

export interface UserPreference {
  filmId: string;
  thumb: ThumbValue;
  note?: string;
  createdAt: string;
}

export interface AdminOverride {
  manualVenues: Venue[];
  manualScreenings: Screening[];
  pausedVenueSlugs: string[];
  screeningTagOverrides: Record<string, string[]>;
  summaryOverrides: Record<string, string>;
}

export interface ScreeningWithRelations {
  screening: Screening;
  film: Film;
  venue: Venue;
  tags: string[];
}

export interface RecommendationResult extends ScreeningWithRelations {
  score: number;
  explanation: string;
  tier: "strong" | "medium" | "weak";
  travelMinutes: number;
  deltaMinutes: number;
  matchedTags: string[];
  boostedByCurrentToggle: boolean;
}

export interface PublicDataset {
  generatedAt: string;
  dataMode?: "fixture" | "live";
  dataStatusMessage?: string;
  venues: Venue[];
  films: Film[];
  screenings: Screening[];
  tags: Tag[];
  screeningTags: ScreeningTag[];
  curatedVenueCount: number;
}

export interface SearchFilters {
  date: string;
  time: string;
  windowMinutes?: number;
  includeAfterTime?: boolean;
  venue?: string;
  borough?: string;
  tags?: string[];
  excludeDisliked?: boolean;
  formatOnly?: boolean;
  newReleaseOnly?: boolean;
}

export interface SearchContext {
  preferences: UserPreference[];
  liveBoosts: string[];
  now?: Date;
}

export interface RecommendationProfile {
  likedFilmIds: Set<string>;
  dislikedFilmIds: Set<string>;
  tagAffinity: Map<string, number>;
  venueAffinity: Map<string, number>;
  directorAffinity: Map<string, number>;
  countryAffinity: Map<string, number>;
  languageAffinity: Map<string, number>;
}
