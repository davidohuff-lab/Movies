import { Film, Tag, Venue } from "@/lib/domain";
import { slugify, unique } from "@/lib/utils";

export const FIRST_CLASS_TAGS = [
  "Special Event/Talkback",
  "70MM",
  "35MM",
  "Psychedelic",
  "Cult Classic",
  "Science Fiction",
  "Kung Fu",
  "Korean",
  "Criterion Collection",
  "New Release"
] as const;

export function buildBaseTags(venues: Venue[]): Tag[] {
  const base: Tag[] = FIRST_CLASS_TAGS.map((name) => ({
    id: `tag-${slugify(name)}`,
    slug: slugify(name),
    name,
    type:
      name === "35MM" || name === "70MM"
        ? "format"
        : name === "Special Event/Talkback"
          ? "program"
          : "genre",
    active: true
  }));

  const venueTags = venues.map((venue) => ({
    id: `tag-${slugify(venue.name)}`,
    slug: slugify(venue.name),
    name: venue.name,
    type: "venue" as const,
    active: true
  }));

  return [...base, ...venueTags];
}

export function inferTagsFromFilm(film: Film): string[] {
  const tags: string[] = [];

  if (film.criterionLikely) {
    tags.push("Criterion Collection");
  }

  if (film.countries.some((country) => country.toLowerCase().includes("korea"))) {
    tags.push("Korean");
  }

  const synopsis = `${film.canonicalTitle} ${film.synopsis ?? ""}`.toLowerCase();
  if (/\bspace|simulation|cybernetic|future|cosmic\b/.test(synopsis)) {
    tags.push("Science Fiction");
  }
  if (/\bmartial|kung fu|bruce lee\b/.test(synopsis)) {
    tags.push("Kung Fu");
  }
  if (/\bhaunted|delirious|visionary|avant-garde|surreal\b/.test(synopsis)) {
    tags.push("Psychedelic");
  }
  if (film.releaseYear && film.releaseYear >= 2024) {
    tags.push("New Release");
  }

  return unique(tags);
}

export function inferTagsFromText(text: string): string[] {
  const source = text.toLowerCase();
  const tags: string[] = [];

  if (source.includes("35mm")) {
    tags.push("35MM");
  }
  if (source.includes("70mm")) {
    tags.push("70MM");
  }
  if (source.includes("q&a") || source.includes("talkback") || source.includes("conversation")) {
    tags.push("Special Event/Talkback");
  }
  if (source.includes("cult")) {
    tags.push("Cult Classic");
  }

  return unique(tags);
}

export function mergeScreeningTags(film: Film, text: string, venueName: string, formatTags: string[] = []): string[] {
  return unique([
    venueName,
    ...inferTagsFromFilm(film),
    ...inferTagsFromText(text),
    ...formatTags
  ]);
}

export function isSpecialtyListing(text: string): boolean {
  return /imax|70mm|35mm|special event|q&a|talkback|anniversary|repertory|archive|restoration|one night/i.test(text);
}

export function isAlamoSpecialty(text: string): boolean {
  return /movie party|terror tuesday|weird wednesday|video vortex|q&a|repertory|special event|35mm|70mm/i.test(text);
}

export function isPublicBookableMoMA(text: string): boolean {
  return /tickets|ticketed|book|booking|reserve|member tickets|general admission/i.test(text);
}
