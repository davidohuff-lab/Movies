export interface NearbyTheaterSummary {
  id: string;
  name: string;
  address: string;
  neighborhood?: string | null;
}

export interface NearbyPlace {
  placeId: string;
  name: string;
  address: string | null;
  types: string[];
  priceLevel: number | null;
  rating: number | null;
  userRatingsTotal: number | null;
  openingHours: {
    weekdayText: string[] | null;
  };
  websiteUrl: string | null;
  mapsUrl: string | null;
  location: {
    lat: number;
    lng: number;
  };
  walk: {
    minutes: number;
    durationText: string;
    distanceMeters: number;
    distanceText: string;
  };
}

export interface NearbyPlacesDataset {
  theater: {
    id: string;
    name: string;
    address: string;
    lat: number;
    lng: number;
  };
  walkCutoffMinutes: number;
  generatedAt: string;
  places: NearbyPlace[];
}

export const PLACE_BUCKETS = ["bar", "restaurant", "cafe"] as const;
export type PlaceBucket = (typeof PLACE_BUCKETS)[number];

const GENERIC_TYPES = new Set(["establishment", "food", "point_of_interest", "store"]);

export function getPlaceBuckets(place: NearbyPlace): Set<PlaceBucket> {
  const buckets = new Set<PlaceBucket>();
  const types = new Set(place.types);

  if (types.has("bar") || types.has("night_club")) {
    buckets.add("bar");
  }
  if (types.has("restaurant") || types.has("meal_takeaway") || types.has("meal_delivery")) {
    buckets.add("restaurant");
  }
  if (types.has("cafe") || types.has("bakery")) {
    buckets.add("cafe");
  }

  return buckets;
}

export function formatPriceLevel(priceLevel: number | null): string {
  if (priceLevel == null || priceLevel < 0) {
    return "Price unknown";
  }
  return "$".repeat(Math.max(1, Math.min(4, priceLevel + 1)));
}

export function formatPlaceType(type: string): string {
  return type
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function getPlaceTypeLine(place: NearbyPlace): string {
  const buckets = getPlaceBuckets(place);
  const preferredTypes = place.types
    .filter((type) => !GENERIC_TYPES.has(type))
    .filter((type) => type !== "restaurant" || buckets.size === 1)
    .filter((type) => type !== "bar" || buckets.size === 1)
    .filter((type) => type !== "cafe" || buckets.size === 1);

  const labels = preferredTypes.length > 0 ? preferredTypes : Array.from(buckets);
  const formatted = Array.from(new Set(labels.map(formatPlaceType)));
  return formatted.slice(0, 3).join(" · ") || "Bar · Restaurant · Cafe";
}

export function getTodayHours(weekdayText: string[] | null): string {
  if (!weekdayText || weekdayText.length === 0) {
    return "Hours unknown";
  }

  const weekday = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    timeZone: "America/New_York"
  }).format(new Date());

  const entry = weekdayText.find((line) => line.startsWith(`${weekday}:`));
  if (!entry) {
    return weekdayText[0] ?? "Hours unknown";
  }

  const parts = entry.split(": ");
  return parts.length > 1 ? parts.slice(1).join(": ") : entry;
}
