import { curatedVenues, filmCatalog } from "@/lib/catalog";
import { PublicDataset, Screening, ScreeningTag } from "@/lib/domain";
import { findFilmMatch, normalizeDraftToScreening } from "@/lib/adapters/helpers";
import { filmNoirIcsFixture } from "@/lib/fixtures/filmNoirIcs";
import { ifcCenterHtmlFixture } from "@/lib/fixtures/ifcCenterHtml";
import { lowCinemaHtmlFixture } from "@/lib/fixtures/lowCinemaHtml";
import { movingImageHtmlFixture } from "@/lib/fixtures/movingImageHtml";
import { spectacleHtmlFixture } from "@/lib/fixtures/spectacleHtml";
import { parseIcsEvents } from "@/lib/ics";
import { buildBaseTags, mergeScreeningTags } from "@/lib/tags";
import { slugify } from "@/lib/utils";

function parseFixtureDrafts(venueSlug: string) {
  if (venueSlug === "film-noir-cinema") {
    return parseIcsEvents(filmNoirIcsFixture).map((event) => ({
      title: event.title.replace(/\s+\(\d{4}\)$/, ""),
      startAt: event.startAt,
      description: event.description,
      sourceUrl: event.url,
      rawPayload: JSON.stringify(event),
      formatTags: []
    }));
  }

  if (venueSlug === "ifc-center") {
    return ifcCenterHtmlFixture
      .split("<div data-screening>")
      .slice(1)
      .map((chunk) => ({
        title: chunk.match(/<h3>(.+?)<\/h3>/)?.[1] ?? "",
        startAt: chunk.match(/datetime="(.+?)"/)?.[1] ?? "",
        description: chunk.match(/<p>(.+?)<\/p>/)?.[1] ?? "",
        sourceUrl: chunk.match(/<a href="(.+?)">/)?.[1] ?? "",
        rawPayload: chunk,
        formatTags: /35mm/i.test(chunk) ? ["35MM"] : /Q&amp;A|Q&A/i.test(chunk) ? ["Special Event/Talkback"] : []
      }));
  }

  if (venueSlug === "low-cinema") {
    return lowCinemaHtmlFixture
      .split("<article data-screening>")
      .slice(1)
      .map((chunk) => ({
        title: chunk.match(/<h3>(.+?)<\/h3>/)?.[1] ?? "",
        startAt: chunk.match(/data-start="(.+?)"/)?.[1] ?? "",
        description: chunk.match(/<p class="description">(.+?)<\/p>/)?.[1] ?? "",
        seriesName: chunk.match(/<p class="series">(.+?)<\/p>/)?.[1],
        sourceUrl: chunk.match(/<a href="(.+?)">/)?.[1] ?? "",
        rawPayload: chunk,
        formatTags: /talkback/i.test(chunk) ? ["Special Event/Talkback"] : []
      }));
  }

  if (venueSlug === "spectacle-theater") {
    return spectacleHtmlFixture
      .split('<div data-screening>')
      .slice(1)
      .map((chunk) => ({
        title: chunk.match(/<h3>(.+?)<\/h3>/)?.[1] ?? "",
        startAt: chunk.match(/datetime="(.+?)"/)?.[1] ?? "",
        description: chunk.match(/<p class="description">(.+?)<\/p>/)?.[1] ?? "",
        seriesName: chunk.match(/<p class="series">(.+?)<\/p>/)?.[1],
        sourceUrl: chunk.match(/<a href="(.+?)">/)?.[1] ?? "",
        rawPayload: chunk,
        formatTags: /kung fu/i.test(chunk) ? ["Kung Fu"] : /psychedelic/i.test(chunk) ? ["Psychedelic"] : []
      }));
  }

  if (venueSlug === "museum-of-the-moving-image") {
    return movingImageHtmlFixture
      .split("<article data-screening>")
      .slice(1)
      .map((chunk) => ({
        title: chunk.match(/<h3>(.+?)<\/h3>/)?.[1] ?? "",
        startAt: chunk.match(/datetime="(.+?)"/)?.[1] ?? "",
        description: chunk.match(/<p class="description">(.+?)<\/p>/)?.[1] ?? "",
        sourceUrl: chunk.match(/<a href="(.+?)">/)?.[1] ?? "",
        rawPayload: chunk,
        formatTags: /70mm/i.test(chunk) ? ["70MM"] : []
      }))
      .filter((draft) => /book/i.test(draft.description));
  }

  return [];
}

export async function ingestTierOneFixtures(): Promise<PublicDataset> {
  const tierOneSlugs = new Set([
    "film-noir-cinema",
    "low-cinema",
    "ifc-center",
    "spectacle-theater",
    "museum-of-the-moving-image"
  ]);

  const activeVenues = curatedVenues.filter((venue) => tierOneSlugs.has(venue.slug));
  const screenings: Screening[] = [];

  for (const venue of activeVenues) {
    const drafts = parseFixtureDrafts(venue.slug);
    for (const draft of drafts) {
      const normalized = normalizeDraftToScreening(venue, findFilmMatch(draft.title, filmCatalog), draft);
      if (normalized) {
        screenings.push(normalized);
      }
    }
  }

  const tags = buildBaseTags(curatedVenues);
  const screeningTags: ScreeningTag[] = screenings.flatMap((screening) => {
    const venue = curatedVenues.find((candidate) => candidate.id === screening.venueId)!;
    const film = filmCatalog.find((candidate) => candidate.id === screening.filmId)!;
    return mergeScreeningTags(
      film,
      `${screening.descriptionRaw} ${screening.eventTitleRaw} ${screening.seriesName ?? ""}`,
      venue.name,
      screening.formatTags
    ).map((tag) => ({
      screeningId: screening.id,
      tagId: `tag-${slugify(tag)}`,
      confidence: screening.formatTags.includes(tag) ? 0.98 : venue.name === tag ? 1 : 0.72,
      source: screening.formatTags.includes(tag) ? "parsed" : film.countries.join(" ").includes(tag) ? "inferred" : "parsed"
    }));
  });

  return {
    generatedAt: new Date("2026-03-02T15:00:00Z").toISOString(),
    dataMode: "fixture",
    dataStatusMessage: "Sample fixture data only. These listings are not live or venue-verified.",
    venues: curatedVenues,
    films: filmCatalog,
    screenings,
    tags,
    screeningTags,
    curatedVenueCount: curatedVenues.length
  };
}
