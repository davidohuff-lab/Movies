import { AdminOverride, PublicDataset, Screening, ScreeningTag } from "@/lib/domain";
import { slugify } from "@/lib/utils";

export const EMPTY_ADMIN_OVERRIDE: AdminOverride = {
  manualVenues: [],
  manualScreenings: [],
  pausedVenueSlugs: [],
  screeningTagOverrides: {},
  summaryOverrides: {}
};

export function applyAdminOverrides(dataset: PublicDataset, overrides: AdminOverride): PublicDataset {
  const venues = dedupeVenues([...dataset.venues, ...overrides.manualVenues]);
  const pausedVenueIds = new Set(venues.filter((venue) => overrides.pausedVenueSlugs.includes(venue.slug)).map((venue) => venue.id));

  const screeningTagOverrides: ScreeningTag[] = Object.entries(overrides.screeningTagOverrides).flatMap(
    ([screeningId, tags]) =>
      tags.map((tag) => ({
        screeningId,
        tagId: `tag-${slugify(tag)}`,
        confidence: 1,
        source: "manual" as const
      }))
  );

  const screenings = [
    ...dataset.screenings.filter((screening) => !pausedVenueIds.has(screening.venueId)),
    ...overrides.manualScreenings
  ];

  return {
    ...dataset,
    venues,
    screenings: dedupeScreenings(screenings),
    screeningTags: [...dataset.screeningTags, ...screeningTagOverrides],
    tags: dedupeTags([
      ...dataset.tags,
      ...overrides.manualVenues.map((venue) => ({
        id: `tag-${slugify(venue.name)}`,
        slug: slugify(venue.name),
        name: venue.name,
        type: "venue" as const,
        active: true
      }))
    ])
  };
}

function dedupeScreenings(screenings: Screening[]): Screening[] {
  const seen = new Map<string, Screening>();
  screenings.forEach((screening) => {
    const key = `${screening.venueId}:${screening.filmId}:${screening.startAt}`;
    const existing = seen.get(key);
    if (!existing || screening.isManualOverride) {
      seen.set(key, screening);
    }
  });
  return Array.from(seen.values());
}

function dedupeVenues(venues: PublicDataset["venues"]): PublicDataset["venues"] {
  const seen = new Map<string, PublicDataset["venues"][number]>();
  venues.forEach((venue) => {
    seen.set(venue.slug, venue);
  });
  return Array.from(seen.values());
}

function dedupeTags(tags: PublicDataset["tags"]): PublicDataset["tags"] {
  const seen = new Map<string, PublicDataset["tags"][number]>();
  tags.forEach((tag) => {
    seen.set(tag.slug, tag);
  });
  return Array.from(seen.values());
}
