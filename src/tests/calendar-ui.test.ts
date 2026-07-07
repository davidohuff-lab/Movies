import assert from "node:assert/strict";
import test from "node:test";

import { parseSharedCalendarParam } from "@/lib/calendar-storage";
import { applyCalendarTileOrdering, buildCalendarTileEntries } from "@/lib/calendar-tiles";
import { RecommendationResult, UserPreference } from "@/lib/domain";
import { extractPosterFromPage } from "@/lib/poster-recovery";
import { extractDescriptionFromSourcePage, extractScreeningPayloadMetadata } from "@/lib/source-page-enrichment";

test("shared calendar parser dedupes and ignores blanks", () => {
  assert.deepEqual(parseSharedCalendarParam("a,,b,a"), ["a", "b"]);
  assert.deepEqual(parseSharedCalendarParam(["a,b", "c"]), ["a", "b", "c"]);
});

test("poster recovery prefers film image over generic markup", () => {
  const payload = `
    <html>
      <head>
        <meta property="og:image" content="https://example.com/film-poster.jpg" />
      </head>
      <body>
        <img src="/logo.png" alt="Venue logo" />
      </body>
    </html>
  `;

  assert.equal(
    extractPosterFromPage(payload, "https://example.com/film/test", "Test Film"),
    "https://example.com/film-poster.jpg"
  );
});

test("poster recovery can extract styled background poster blocks", () => {
  const payload = `
    <html>
      <body>
        <div class="hero-poster" aria-label="I Live Here Now poster" style="background-image:url('/images/i-live-here-now.jpg')"></div>
      </body>
    </html>
  `;

  assert.equal(
    extractPosterFromPage(payload, "https://www.roxycinemanewyork.com/screenings/i-live-here-now", "I Live Here Now"),
    "https://www.roxycinemanewyork.com/images/i-live-here-now.jpg"
  );
});

test("source page enrichment extracts Roxy ticketing description copy", () => {
  const payload = `
    <html>
      <body>
        <div>Location</div>
        <div>Roxy Cinema New York</div>
        <div>Screen</div>
        <div>Roxy Cinema</div>
        <div>In the surreal landscape of I LIVE HERE NOW, struggling actress Rose (Lucy Fry) finds her life upended by unexpected visitors and psychic unraveling.</div>
        <h2>Select tickets</h2>
      </body>
    </html>
  `;

  assert.match(
    extractDescriptionFromSourcePage(payload, "I Live Here Now") ?? "",
    /struggling actress Rose/
  );
});

test("poster recovery can extract direct MoMA asset image urls", () => {
  const payload = `
    <html>
      <body>
        <a href="https://www.moma.org/d/assets/W1siZiIsIjIwMjYvMDIvMTMvNmltcDM3dXR6MF9SYW5fdmlhX1Bob3RvZmVzdF8zX3llcy5qcGciXSJd/Ran.jpg?sha=abc123">
          Image: Ran. 1985. Japan. Directed by Akira Kurosawa.
        </a>
      </body>
    </html>
  `;

  assert.equal(
    extractPosterFromPage(payload, "https://www.moma.org/calendar/events/11287", "Ran"),
    "https://www.moma.org/d/assets/W1siZiIsIjIwMjYvMDIvMTMvNmltcDM3dXR6MF9SYW5fdmlhX1Bob3RvZmVzdF8zX3llcy5qcGciXSJd/Ran.jpg?sha=abc123"
  );
});

test("source page enrichment extracts MoMA body synopsis between image block and events", () => {
  const payload = `
    <html>
      <body>
        <h1>Ran (乱). 1985. Directed by Akira Kurosawa</h1>
        <a href="https://www.moma.org/d/assets/ran.jpg">Image: Ran. 1985. Japan. Directed by Akira Kurosawa. Courtesy of Photofest</a>
        <p>Ran (乱). 1985. Japan. Directed by Akira Kurosawa. Written by Kurosawa, Hideo Oguni, Masato Ide. With Tatsuya Nakadai. In Japanese; English subtitles. 35mm. 162 min.</p>
        <p>28 years after Throne of Blood, Akira Kurosawa again turned to Shakespeare for inspiration, reimagining King Lear as an epic drama of power and betrayal in feudal Japan.</p>
        <p>Ran is one of the last great screen spectacles, with epic battle scenes filmed on Mount Fuji.</p>
        <h2>Events</h2>
      </body>
    </html>
  `;

  assert.match(
    extractDescriptionFromSourcePage(payload, "Ran") ?? "",
    /Akira Kurosawa again turned to Shakespeare/
  );
});

test("screening payload metadata extracts screen slate title, director, year, and runtime", () => {
  const metadata = extractScreeningPayloadMetadata({
    id: "screening-moma-ran",
    venueId: "venue-moma",
    filmId: "film-ran",
    startAt: "2026-03-14T20:00:00.000Z",
    eventTitleRaw: "Ran",
    descriptionRaw: "Ran Museum of Modern Art Akira Kurosawa 1985 162M 35mm 35mm",
    formatTags: ["35MM"],
    userTags: [],
    sourceType: "api",
    sourceUrl: "https://www.moma.org/calendar/events/11287",
    sourceHash: "abc",
    rawPayload: JSON.stringify({
      screenSlate: {
        item: {
          nid: "101121",
          field_time: "4:00pm",
          field_note: "",
          field_timestamp: "2026-03-14T16:00:00"
        },
        detail: {
          title: "MOMA CHAOS",
          field_display_title: "",
          media_title_info: "<span>Akira Kurosawa</span><span>1985</span><span>162M</span><span>35mm</span>",
          field_series: "",
          nid: "101121",
          field_url: "https://www.moma.org/calendar/events/11287",
          body: "",
          media_title_labels: "<span>Ran</span>",
          venue_title: "<a href=\"/venues/museum-modern-art\">Museum of Modern Art</a>",
          media_title_format: "35mm"
        }
      }
    }),
    lastSeenAt: "2026-03-14T00:00:00.000Z",
    isManualOverride: false,
    isCancelled: false
  });

  assert.equal(metadata.title, "Ran");
  assert.equal(metadata.directors[0], "Akira Kurosawa");
  assert.equal(metadata.releaseYear, 1985);
  assert.equal(metadata.runtimeMinutes, 162);
});

test("calendar tiles collapse multiple local-day showtimes into one tile", () => {
  const baseItem = {
    score: 1,
    deltaMinutes: 0,
    travelMinutes: 20,
    explanation: "test",
    tags: ["35MM"],
    film: {
      id: "film-ran",
      canonicalTitle: "Ran",
      originalTitle: "Ran",
      releaseYear: 1985,
      runtimeMinutes: 162,
      directors: ["Akira Kurosawa"],
      countries: ["Japan"],
      languages: ["Japanese"],
      metadataSourceIds: {},
      synopsis: "",
      aiSummary: "",
      posterUrl: "",
      criterionLikely: false,
      createdAt: "",
      updatedAt: ""
    },
    venue: {
      id: "venue-moma",
      name: "MoMA Film Screenings",
      slug: "moma-film-screenings",
      website: "https://www.moma.org/calendar/",
      address: "",
      borough: "Manhattan",
      lat: 0,
      lng: 0,
      nearestSubwayStops: [],
      active: true,
      adapterType: "html",
      notes: "",
      includeRules: "",
      tags: []
    }
  } satisfies Omit<RecommendationResult, "screening">;

  const items: RecommendationResult[] = [
    {
      ...baseItem,
      screening: {
        id: "screening-1",
        venueId: "venue-moma",
        filmId: "film-ran",
        startAt: "2026-03-14T00:30:00.000Z",
        endAt: null,
        seriesName: null,
        eventTitleRaw: "Ran",
        descriptionRaw: "",
        formatTags: ["35MM"],
        userTags: [],
        sourceType: "api",
        sourceUrl: "",
        sourceHash: "1",
        rawPayload: "{}",
        lastSeenAt: "",
        isManualOverride: false,
        isCancelled: false,
        soldOut: null,
        createdAt: "",
        updatedAt: ""
      }
    },
    {
      ...baseItem,
      screening: {
        id: "screening-2",
        venueId: "venue-moma",
        filmId: "film-ran",
        startAt: "2026-03-13T21:00:00.000Z",
        endAt: null,
        seriesName: null,
        eventTitleRaw: "Ran",
        descriptionRaw: "",
        formatTags: ["35MM"],
        userTags: [],
        sourceType: "api",
        sourceUrl: "",
        sourceHash: "2",
        rawPayload: "{}",
        lastSeenAt: "",
        isManualOverride: false,
        isCancelled: false,
        soldOut: null,
        createdAt: "",
        updatedAt: ""
      }
    }
  ];

  const entries = buildCalendarTileEntries(items);
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].showtimes, ["5:00 PM", "8:30 PM"]);
});

test("calendar tile ordering prefers special events first, one-offs next, and new releases last", () => {
  const preferences: UserPreference[] = [];
  const makeEntry = (overrides: Partial<RecommendationResult>, tags: string[], extraStartAt?: string) => {
    const item: RecommendationResult = {
      score: 1,
      deltaMinutes: 0,
      travelMinutes: 10,
      explanation: "test",
      tags,
      film: {
        id: overrides.film?.id ?? `film-${tags.join("-") || "base"}`,
        canonicalTitle: overrides.film?.canonicalTitle ?? "Base Film",
        originalTitle: overrides.film?.originalTitle ?? "Base Film",
        releaseYear: 2000,
        runtimeMinutes: 100,
        directors: [],
        countries: [],
        languages: [],
        metadataSourceIds: {},
        synopsis: "",
        aiSummary: "",
        posterUrl: "",
        criterionLikely: false,
        createdAt: "",
        updatedAt: ""
      },
      venue: {
        id: "venue-1",
        name: "Venue",
        slug: "venue",
        website: "",
        address: "",
        borough: "Manhattan",
        lat: 0,
        lng: 0,
        nearestSubwayStops: [],
        active: true,
        adapterType: "html",
        notes: "",
        includeRules: "",
        tags: []
      },
      screening: {
        id: overrides.screening?.id ?? `screening-${tags.join("-") || "base"}`,
        venueId: "venue-1",
        filmId: overrides.film?.id ?? `film-${tags.join("-") || "base"}`,
        startAt: overrides.screening?.startAt ?? "2026-03-14T20:00:00.000Z",
        endAt: null,
        seriesName: null,
        eventTitleRaw: overrides.film?.canonicalTitle ?? "Base Film",
        descriptionRaw: "",
        formatTags: [],
        userTags: [],
        sourceType: "api",
        sourceUrl: "",
        sourceHash: "",
        rawPayload: "{}",
        lastSeenAt: "",
        isManualOverride: false,
        isCancelled: false,
        soldOut: null,
        createdAt: "",
        updatedAt: ""
      }
    };

    const items = [item];
    if (extraStartAt) {
      items.push({
        ...item,
        screening: {
          ...item.screening,
          id: `${item.screening.id}-extra`,
          startAt: extraStartAt
        }
      });
    }

    return buildCalendarTileEntries(items)[0];
  };

  const regular = makeEntry(
    {
      film: { id: "film-regular", canonicalTitle: "Regular Film", originalTitle: "Regular Film" } as RecommendationResult["film"],
      screening: { id: "screening-regular", startAt: "2026-03-14T21:00:00.000Z" } as RecommendationResult["screening"]
    },
    [],
    "2026-03-14T23:30:00.000Z"
  );
  const special = makeEntry(
    {
      film: { id: "film-special", canonicalTitle: "Special Film", originalTitle: "Special Film" } as RecommendationResult["film"],
      screening: { id: "screening-special", startAt: "2026-03-14T23:00:00.000Z" } as RecommendationResult["screening"]
    },
    ["Special Event/Talkback"]
  );
  const oneOff = makeEntry(
    {
      film: { id: "film-oneoff", canonicalTitle: "One Off", originalTitle: "One Off" } as RecommendationResult["film"],
      screening: { id: "screening-oneoff", startAt: "2026-03-14T22:00:00.000Z" } as RecommendationResult["screening"]
    },
    ["Cult Classic"]
  );
  const newRelease = makeEntry(
    {
      film: { id: "film-new", canonicalTitle: "New Release Film", originalTitle: "New Release Film" } as RecommendationResult["film"],
      screening: { id: "screening-new", startAt: "2026-03-14T20:30:00.000Z" } as RecommendationResult["screening"]
    },
    ["New Release"]
  );

  const ordered = applyCalendarTileOrdering([regular, newRelease, special, oneOff], preferences, []);

  assert.deepEqual(
    ordered.map((entry) => entry.item.film.canonicalTitle),
    ["Special Film", "One Off", "Regular Film", "New Release Film"]
  );
});
