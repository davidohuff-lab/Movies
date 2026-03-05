import {
  PublicDataset,
  RecommendationResult,
  ScreeningWithRelations,
  SearchContext,
  SearchFilters
} from "@/lib/domain";
import { buildRecommendationProfile, scoreScreening } from "@/lib/scoring";
import { endOfDay, minutesBetween, parseLocalDateTime, sortBy, startOfDay } from "@/lib/utils";

function enrich(dataset: PublicDataset): ScreeningWithRelations[] {
  const filmMap = new Map(dataset.films.map((film) => [film.id, film]));
  const venueMap = new Map(dataset.venues.map((venue) => [venue.id, venue]));
  const tagsByScreening = new Map<string, string[]>();

  dataset.screeningTags.forEach((screeningTag) => {
    const tag = dataset.tags.find((candidate) => candidate.id === screeningTag.tagId);
    if (!tag) {
      return;
    }
    tagsByScreening.set(screeningTag.screeningId, [...(tagsByScreening.get(screeningTag.screeningId) ?? []), tag.name]);
  });

  return dataset.screenings
    .map((screening) => {
      const film = filmMap.get(screening.filmId);
      const venue = venueMap.get(screening.venueId);
      if (!film || !venue) {
        return null;
      }
      return {
        screening,
        film,
        venue,
        tags: tagsByScreening.get(screening.id) ?? []
      };
    })
    .filter((item): item is ScreeningWithRelations => Boolean(item));
}

function passesFilters(item: ScreeningWithRelations, filters: SearchFilters, context: SearchContext): boolean {
  if (filters.venue && item.venue.slug !== filters.venue) {
    return false;
  }
  if (filters.borough && item.venue.borough !== filters.borough) {
    return false;
  }
  if (filters.tags && filters.tags.length > 0 && !filters.tags.every((tag) => item.tags.includes(tag))) {
    return false;
  }
  if (filters.excludeDisliked && context.preferences.some((preference) => preference.filmId === item.film.id && preference.thumb === "down")) {
    return false;
  }
  if (filters.formatOnly && !item.tags.some((tag) => tag === "35MM" || tag === "70MM")) {
    return false;
  }
  if (filters.newReleaseOnly && !item.tags.includes("New Release")) {
    return false;
  }
  return true;
}

export function searchAroundTime(
  dataset: PublicDataset,
  filters: SearchFilters,
  context: SearchContext
): RecommendationResult[] {
  const center = parseLocalDateTime(filters.date, filters.time);
  const windowMinutes = filters.windowMinutes ?? 120;
  const profile = buildRecommendationProfile(enrich(dataset), context.preferences);

  return sortBy(
    enrich(dataset)
      .filter((item) => {
        const screeningDate = new Date(item.screening.startAt);
        const delta = minutesBetween(center, screeningDate);
        return Math.abs(delta) <= windowMinutes && passesFilters(item, filters, context);
      })
      .map((item) => {
        const screeningDate = new Date(item.screening.startAt);
        const delta = minutesBetween(center, screeningDate);
        return scoreScreening(item, delta, context, profile);
      }),
    (left, right) =>
      right.score - left.score ||
      Math.abs(left.deltaMinutes) - Math.abs(right.deltaMinutes) ||
      left.travelMinutes - right.travelMinutes
  );
}

export function searchTonight(
  dataset: PublicDataset,
  filters: SearchFilters,
  context: SearchContext
): RecommendationResult[] {
  const start = parseLocalDateTime(filters.date, filters.time);
  const end = endOfDay(start);
  const profile = buildRecommendationProfile(enrich(dataset), context.preferences);

  return sortBy(
    enrich(dataset)
      .filter((item) => {
        const screeningDate = new Date(item.screening.startAt);
        return screeningDate >= start && screeningDate <= end && passesFilters(item, filters, context);
      })
      .map((item) => scoreScreening(item, minutesBetween(start, new Date(item.screening.startAt)), context, profile)),
    (left, right) =>
      right.score - left.score ||
      left.deltaMinutes - right.deltaMinutes ||
      left.travelMinutes - right.travelMinutes
  );
}

export function getCalendarRecommendations(
  dataset: PublicDataset,
  monthDate: Date,
  context: SearchContext
): Map<string, RecommendationResult[]> {
  const profile = buildRecommendationProfile(enrich(dataset), context.preferences);
  const month = monthDate.getUTCMonth();
  const year = monthDate.getUTCFullYear();
  const byDay = new Map<string, RecommendationResult[]>();

  enrich(dataset).forEach((item) => {
    const screeningDate = new Date(item.screening.startAt);
    if (screeningDate.getUTCMonth() !== month || screeningDate.getUTCFullYear() !== year) {
      return;
    }
    const key = startOfDay(screeningDate).toISOString().slice(0, 10);
    const scored = scoreScreening(item, 0, context, profile);
    byDay.set(key, [...(byDay.get(key) ?? []), scored]);
  });

  byDay.forEach((items, key) => {
    byDay.set(
      key,
      sortBy(items, (left, right) => right.score - left.score || left.travelMinutes - right.travelMinutes).slice(0, 5)
    );
  });

  return byDay;
}

export function getFullDaySchedule(
  dataset: PublicDataset,
  day: string,
  context: SearchContext
): RecommendationResult[] {
  const target = new Date(`${day}T00:00:00Z`);
  const start = startOfDay(target);
  const end = endOfDay(target);
  const profile = buildRecommendationProfile(enrich(dataset), context.preferences);

  return sortBy(
    enrich(dataset)
      .filter((item) => {
        const screeningDate = new Date(item.screening.startAt);
        return screeningDate >= start && screeningDate <= end;
      })
      .map((item) => scoreScreening(item, 0, context, profile)),
    (left, right) =>
      right.score - left.score ||
      new Date(left.screening.startAt).getTime() - new Date(right.screening.startAt).getTime()
  );
}
