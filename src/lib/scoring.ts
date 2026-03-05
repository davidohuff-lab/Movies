import {
  RecommendationProfile,
  RecommendationResult,
  ScreeningWithRelations,
  SearchContext,
  UserPreference
} from "@/lib/domain";
import { estimateTravelMinutes } from "@/lib/travel";
import { clamp } from "@/lib/utils";

function increment(map: Map<string, number>, key: string, value: number) {
  map.set(key, (map.get(key) ?? 0) + value);
}

export function buildRecommendationProfile(
  items: ScreeningWithRelations[],
  preferences: UserPreference[]
): RecommendationProfile {
  const itemByFilm = new Map(items.map((item) => [item.film.id, item]));
  const likedFilmIds = new Set(preferences.filter((preference) => preference.thumb === "up").map((preference) => preference.filmId));
  const dislikedFilmIds = new Set(
    preferences.filter((preference) => preference.thumb === "down").map((preference) => preference.filmId)
  );

  const tagAffinity = new Map<string, number>();
  const venueAffinity = new Map<string, number>();
  const directorAffinity = new Map<string, number>();
  const countryAffinity = new Map<string, number>();
  const languageAffinity = new Map<string, number>();

  for (const preference of preferences) {
    const item = itemByFilm.get(preference.filmId);
    if (!item) {
      continue;
    }
    const weight = preference.thumb === "up" ? 1 : -1;
    item.tags.forEach((tag) => increment(tagAffinity, tag, weight));
    increment(venueAffinity, item.venue.name, weight);
    item.film.directors.forEach((director) => increment(directorAffinity, director, weight));
    item.film.countries.forEach((country) => increment(countryAffinity, country, weight));
    item.film.languages.forEach((language) => increment(languageAffinity, language, weight));
  }

  return {
    likedFilmIds,
    dislikedFilmIds,
    tagAffinity,
    venueAffinity,
    directorAffinity,
    countryAffinity,
    languageAffinity
  };
}

function tierForScore(score: number): "strong" | "medium" | "weak" {
  if (score >= 8.5) {
    return "strong";
  }
  if (score >= 4.5) {
    return "medium";
  }
  return "weak";
}

export function scoreScreening(
  item: ScreeningWithRelations,
  deltaMinutes: number,
  context: SearchContext,
  profile: RecommendationProfile
): RecommendationResult {
  let score = 0;
  const reasons: string[] = [];
  const matchedTags: string[] = [];

  if (profile.likedFilmIds.has(item.film.id)) {
    score += 9;
    reasons.push("You already liked this film");
  }
  if (profile.dislikedFilmIds.has(item.film.id)) {
    score -= 12;
    reasons.push("You previously thumbed this down");
  }

  for (const tag of item.tags) {
    const tagScore = profile.tagAffinity.get(tag) ?? 0;
    if (tagScore > 0) {
      score += 2.2 * tagScore;
      matchedTags.push(tag);
    } else if (tagScore < 0) {
      score += 1.8 * tagScore;
    }
  }

  const venueScore = profile.venueAffinity.get(item.venue.name) ?? 0;
  if (venueScore > 0) {
    score += 1.8 * venueScore;
    reasons.push(`Strong venue match at ${item.venue.name}`);
  } else if (venueScore < 0) {
    score += 1.4 * venueScore;
  }

  const directorHit = item.film.directors.find((director) => (profile.directorAffinity.get(director) ?? 0) > 0);
  if (directorHit) {
    score += 2.5;
    reasons.push(`Shares a director thread with films you liked`);
  }

  const countryHit = item.film.countries.find((country) => (profile.countryAffinity.get(country) ?? 0) > 0);
  if (countryHit) {
    score += 1.8;
    reasons.push(`Country affinity match: ${countryHit}`);
  }

  const languageHit = item.film.languages.find((language) => (profile.languageAffinity.get(language) ?? 0) > 0);
  if (languageHit) {
    score += 1.2;
  }

  const appliedBoosts = context.liveBoosts.filter((boost) => item.tags.includes(boost));
  if (appliedBoosts.length > 0) {
    score += appliedBoosts.length * 4.5;
    matchedTags.push(...appliedBoosts);
    reasons.push(`Live boost: ${appliedBoosts.join(", ")}`);
  }

  if (item.tags.includes("35MM")) {
    score += 1.6;
  }
  if (item.tags.includes("70MM")) {
    score += 1.8;
  }
  if (item.tags.includes("Special Event/Talkback")) {
    score += 1.4;
  }

  if (item.film.releaseYear && item.film.releaseYear >= 2024) {
    score += 0.8;
  } else {
    score += 0.6;
  }

  score += clamp(2.5 - Math.abs(deltaMinutes) / 55, -2, 2.5);

  const screeningDate = new Date(item.screening.startAt);
  const travelMinutes = estimateTravelMinutes(item.venue, screeningDate);
  score += clamp(2.2 - travelMinutes / 28, -1.5, 2.2);

  if (matchedTags.length > 0) {
    reasons.push(`Tag match: ${Array.from(new Set(matchedTags)).join(", ")}`);
  }
  if (reasons.length === 0) {
    reasons.push("Recommended for rarity, timing fit, and travel convenience");
  }

  return {
    ...item,
    score: Number(score.toFixed(2)),
    explanation: reasons.join(" + "),
    tier: tierForScore(score),
    travelMinutes,
    deltaMinutes,
    matchedTags: Array.from(new Set(matchedTags)),
    boostedByCurrentToggle: appliedBoosts.length > 0
  };
}
