import { RecommendationResult, UserPreference } from "@/lib/domain";
import { formatClock, formatEasternDateKey } from "@/lib/utils";

export interface CalendarTileEntry {
  key: string;
  item: RecommendationResult;
  screenings: RecommendationResult[];
  screeningIds: string[];
  showtimes: string[];
  tags: string[];
}

export function buildCalendarTileEntries(items: RecommendationResult[]): CalendarTileEntry[] {
  const byFilmVenueDay = new Map<string, CalendarTileEntry>();

  for (const item of items) {
    const screeningDay = formatEasternDateKey(item.screening.startAt);
    const key = `${item.film.id}::${item.venue.id}::${screeningDay}`;
    const screeningTime = formatClock(new Date(item.screening.startAt));
    const filteredTags = Array.from(new Set(item.tags)).filter(
      (tag) => tag.trim().toLowerCase() !== item.venue.name.trim().toLowerCase()
    );

    if (!byFilmVenueDay.has(key)) {
      byFilmVenueDay.set(key, {
        key,
        item,
        screenings: [item],
        screeningIds: [item.screening.id],
        showtimes: [screeningTime],
        tags: filteredTags
      });
      continue;
    }

    const current = byFilmVenueDay.get(key)!;
    current.screenings.push(item);
    if (!current.showtimes.includes(screeningTime)) {
      current.showtimes.push(screeningTime);
    }
    if (!current.screeningIds.includes(item.screening.id)) {
      current.screeningIds.push(item.screening.id);
    }
    current.tags = Array.from(new Set([...current.tags, ...filteredTags]));
  }

  return Array.from(byFilmVenueDay.values()).map((entry) => {
    const screenings = [...entry.screenings].sort(
      (left, right) => new Date(left.screening.startAt).getTime() - new Date(right.screening.startAt).getTime()
    );

    return {
      ...entry,
      screenings,
      screeningIds: screenings.map((screening) => screening.screening.id),
      showtimes: screenings.map((screening) => formatClock(new Date(screening.screening.startAt)))
    };
  });
}

export function getPreferenceThumb(preferences: UserPreference[], filmId: string): "up" | "down" | null {
  return preferences.find((preference) => preference.filmId === filmId)?.thumb ?? null;
}

export function isTileSaved(entry: CalendarTileEntry, savedScreeningIds: string[]): boolean {
  return entry.screeningIds.some((screeningId) => savedScreeningIds.includes(screeningId));
}

export function isTilePinned(entry: CalendarTileEntry, pinnedTileKeys: string[]): boolean {
  return pinnedTileKeys.includes(entry.key);
}

function getPinnedOrderIndex(entry: CalendarTileEntry, pinnedTileKeys: string[]): number {
  const pinnedIndex = pinnedTileKeys.indexOf(entry.key);
  return pinnedIndex >= 0 ? pinnedIndex : Number.POSITIVE_INFINITY;
}

function getProgramPriority(entry: CalendarTileEntry): number {
  if (entry.tags.includes("Special Event/Talkback")) {
    return 0;
  }

  if (entry.tags.includes("New Release")) {
    return 3;
  }

  if (entry.screenings.length === 1) {
    return 1;
  }

  return 2;
}

export function applyCalendarTileOrdering(
  entries: CalendarTileEntry[],
  preferences: UserPreference[],
  pinnedTileKeys: string[]
) {
  return entries
    .filter((entry) => getPreferenceThumb(preferences, entry.item.film.id) !== "down")
    .sort((left, right) => {
      const leftSavedIndex = getPinnedOrderIndex(left, pinnedTileKeys);
      const rightSavedIndex = getPinnedOrderIndex(right, pinnedTileKeys);

      if (leftSavedIndex !== rightSavedIndex) {
        return leftSavedIndex - rightSavedIndex;
      }

      const leftThumb = getPreferenceThumb(preferences, left.item.film.id);
      const rightThumb = getPreferenceThumb(preferences, right.item.film.id);
      if (leftThumb === "up" && rightThumb !== "up") {
        return -1;
      }
      if (rightThumb === "up" && leftThumb !== "up") {
        return 1;
      }

      const leftProgramPriority = getProgramPriority(left);
      const rightProgramPriority = getProgramPriority(right);
      if (leftProgramPriority !== rightProgramPriority) {
        return leftProgramPriority - rightProgramPriority;
      }

      const leftStart = new Date(left.screenings[0]?.screening.startAt ?? left.item.screening.startAt).getTime();
      const rightStart = new Date(right.screenings[0]?.screening.startAt ?? right.item.screening.startAt).getTime();
      if (leftStart !== rightStart) {
        return leftStart - rightStart;
      }

      return left.item.film.canonicalTitle.localeCompare(right.item.film.canonicalTitle);
    });
}
