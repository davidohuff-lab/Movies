import test from "node:test";
import assert from "node:assert/strict";

import { parseFilmForumNowPlayingHtml } from "@/lib/adapters/filmForum";
import { parseFilmNoirProgramHtml } from "@/lib/adapters/filmNoir";
import { parseGenericJsonLdEvents } from "@/lib/adapters/genericJsonLd";
import { parseIfcFilmPageHtml, parseIfcHomeWidgetHtml } from "@/lib/adapters/ifcCenter";
import { parseLowCinemaHtml } from "@/lib/adapters/lowCinema";
import { parseSyndicatedVeezi } from "@/lib/adapters/syndicated";
import { parseMetrographFilmPageHtml, parseMetrographNycHtml } from "@/lib/adapters/metrograph";
import { mayslesAdapter } from "@/lib/adapters/maysles";
import { parseMoMAScreenSlateEntries } from "@/lib/adapters/moma";
import { parseMovingImageHtml } from "@/lib/adapters/movingImage";
import { parseBamDetailEvents, parseBamFilmLinks } from "@/lib/adapters/bam";
import { parseAmcImaxFeverHtml, parseAmcImaxHtml } from "@/lib/adapters/amcImax";
import { parseAngelikaNowShowingResponse } from "@/lib/adapters/angelika";
import { parseNitehawkSchedulePage, parseNitehawkScheduleUrls } from "@/lib/adapters/nitehawk";
import { parseParisTheaterHomepageHtml } from "@/lib/adapters/parisTheater";
import { parseQuadCinemaHtml } from "@/lib/adapters/quadCinema";
import { parseRoxyHomepageHtml } from "@/lib/adapters/roxy";
import { parseSpectacleRollingHtml } from "@/lib/adapters/spectacle";
import { curatedVenues } from "@/lib/catalog";
import { __testables__ as screenSlateTestables } from "@/lib/screenslate";

test("film noir parser extracts upcoming program entries", () => {
  const payload = `
    <article class="eventlist-event eventlist-event--upcoming">
      <h1 class="eventlist-title"><a href="/program/2026/2/25/el-asesino-de-munecas" class="eventlist-title-link">EL ASESINO DE MUNECAS</a></h1>
      <time class="event-date" datetime="2026-03-04">Wednesday, March 4, 2026</time>
      <time class="event-time-24hr-start" datetime="2026-03-04">19:00</time>
      <div class="eventlist-description"><p>Spanish cult horror rarity.</p></div></div></div><a href=
    </article>
  `;

  const screenings = parseFilmNoirProgramHtml(payload);
  assert.equal(screenings.length, 1);
  assert.equal(screenings[0]?.title, "EL ASESINO DE MUNECAS");
  assert.match(screenings[0]?.description ?? "", /cult horror/i);
});

test("syndicated veezi parser extracts dated showtimes and posters", () => {
  const payload = `
    <div class="date">
      <h3 class="date-title h5">Sunday 22, March</h3>
      <div class="films">
        <div class="film">
          <div class="poster-container">
            <img class="poster" src="/cdn/posters/house.jpg" />
          </div>
          <div>
            <h3 class="title">House</h3>
            <ul class="session-times">
              <li><a href="/sessions/123"><time>7:00 PM</time></a></li>
              <li><a href="/sessions/124"><time>9:30 PM</time></a></li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  `;

  const screenings = parseSyndicatedVeezi(payload);
  assert.equal(screenings.length, 2);
  assert.equal(screenings[0]?.title, "House");
  assert.match(screenings[0]?.film?.posterUrl ?? "", /house\.jpg$/);
  assert.match(screenings[0]?.sourceUrl ?? "", /sessions\/123$/);
});

test("maysles adapter extracts event links from calendar payload", async () => {
  const calendarPayload = `
    <a href="/calendar/francophone-harlem-sunday-afternoon">Francophone Harlem</a>
    <a href="/calendar/francophone-harlem-sunday-afternoon">Duplicate</a>
    <a href="/calendar/another-screening">Another</a>
  `;

  const links = await mayslesAdapter.fetchIndexPages({} as never);
  assert.deepEqual(links, ["https://www.maysles.org/calendar"]);
  assert.ok(calendarPayload.includes("/calendar/francophone-harlem-sunday-afternoon"));
});

test("low cinema parser extracts multiple showtimes from tickets page", () => {
  const payload = `
    <div class="movie-card">
      <div class="movie-poster"><a href="/movie/sugar-2/"><img src="https://example.com/sugar.jpg" /></a></div>
      <h2 class="movie-title"><a href="/movie/sugar-2/">Sugar</a></h2>
      <div class="showtimes-panel" id="panel-abc-2026-03-04">
        <b>Wednesday, March 4:</b><br>
        <a href="/checkout/1/" class="showtime-link">6 PM</a>
        <a href="/checkout/2/" class="showtime-link">8:15 PM</a>
      </div>
    </div>
  `;

  const screenings = parseLowCinemaHtml(payload);
  assert.equal(screenings.length, 2);
  assert.equal(screenings[0]?.title, "Sugar");
  assert.equal(new Date(screenings[1]?.startAt ?? "").toISOString(), "2026-03-05T01:15:00.000Z");
});

test("ifc film page parser captures metadata and 35MM markers", () => {
  const payload = `
    <meta property="og:image" content="https://example.com/poster.jpg" />
    <h1 class="title">The Ugly Stepsister</h1>
    <p class="date-time">Friday, February 27 - Wednesday, March 4, 2026</p>
    <span><strong>Wed Mar 4:</strong></span>&nbsp;<p><strong>Screening on 35mm at 7:00!</strong></p>
    <h2>SHOWTIMES AT IFC CENTER</h2>
    <ul class="schedule-list">
      <li>
        <div class="details">
          <p><strong>Wed Mar 04</strong></p>
          <ul class="times">
            <li><span>7:00 pm</span></li>
          </ul>
        </div>
      </li>
    </ul>
    <p>Fairy tale body horror.</p>
    <ul class="film-details">
      <li><strong>Country</strong> Norway, Poland</li>
      <li><strong>Language</strong> Norwegian with English subtitles</li>
      <li><strong>Running Time</strong> 109 minutes</li>
      <li><strong>Director</strong> Emilie Blichfeldt</li>
    </ul>
  `;

  const screenings = parseIfcFilmPageHtml("https://www.ifccenter.com/films/the-ugly-stepsister/", payload);
  assert.equal(screenings.length, 1);
  assert.equal(screenings[0]?.film?.runtimeMinutes, 109);
  assert.ok(screenings[0]?.formatTags?.includes("35MM"));
});

test("ifc film page parser does not apply past Q&A synopsis text to unmatched screenings", () => {
  const payload = `
    <meta property="og:image" content="https://example.com/poster.jpg" />
    <h1 class="title">Blue Heron</h1>
    <p class="date-time">Thursday, April 16 - Wednesday, April 29, 2026</p>
    <h2>SHOWTIMES AT IFC CENTER</h2>
    <p>Thursday, April 16 at 7:00: Sneak Preview + Q&A with director Sophy Romvari after the screening Friday, April 17 at 6:45: Q&A with director Sophy Romvari after the screening.</p>
    <ul class="schedule-list">
      <li>
        <div class="details">
          <p><strong>Mon Apr 27</strong></p>
          <ul class="times">
            <li><span>10:35 am</span></li>
            <li><span>7:45 pm</span></li>
          </ul>
        </div>
      </li>
    </ul>
    <ul class="film-details">
      <li><strong>Running Time</strong> 90 minutes</li>
      <li><strong>Director</strong> Sophy Romvari</li>
    </ul>
  `;

  const screenings = parseIfcFilmPageHtml("https://www.ifccenter.com/films/blue-heron/", payload);
  assert.equal(screenings.length, 2);
  assert.deepEqual(screenings.flatMap((screening) => screening.formatTags ?? []), []);
  assert.equal(screenings[0]?.description, "Listed on IFC Center's film page.");
});

test("ifc home widget parser captures showtimes directly from the homepage", () => {
  const payload = `
    <div class="daily-schedule wed">
      <h3>Wed Mar 4</h3>
      <ul>
        <li>
          <div class="details">
            <h3><a href="https://www.ifccenter.com/films/the-ugly-stepsister/">The Ugly Stepsister</a></h3>
            <ul class="times">
              <li><a href="https://tickets.ifccenter.com/showtime/1">7:00 PM</a></li>
              <li><a href="https://tickets.ifccenter.com/showtime/2">9:10 PM</a></li>
            </ul>
          </div>
        </li>
      </ul>
    </div>
    <p><span>Wed Mar 4:</span> <span class="ipe-title"><a href="https://www.ifccenter.com/films/the-ugly-stepsister/">The Ugly Stepsister</a></span> <span class="ipe-caption">Screening on 35mm at 7:00!</span></p>
  `;

  const screenings = parseIfcHomeWidgetHtml(payload, new Date("2026-03-02T12:00:00-05:00"));
  assert.equal(screenings.length, 2);
  assert.equal(screenings[0]?.title, "The Ugly Stepsister");
  assert.ok(screenings[0]?.formatTags?.includes("35MM"));
  assert.equal(screenings[1]?.formatTags?.includes("35MM"), false);
});

test("film forum parser maps the weekly tabs to concrete dates", () => {
  const payload = `
    <div id="tabs-0">
      <p><strong><a href="https://filmforum.org/film/days-and-nights-in-the-forest">Satyajit Ray’s<br />DAYS AND NIGHTS IN THE FOREST</a></strong><br />
      <span>12:30</span> <span>8:00</span></p>
    </div>
    <div id="tabs-1">
      <p><span class="alert">Special Screening!</span><strong><a href="https://filmforum.org/film/the-bigamist">Ida Lupino’s<br /> THE BIGAMIST</a></strong><br />
      <span>8:00</span></p>
    </div>
  `;

  const screenings = parseFilmForumNowPlayingHtml(payload, new Date("2026-03-02T12:00:00-05:00"));
  assert.equal(screenings.length, 3);
  assert.equal(screenings[0]?.title, "DAYS AND NIGHTS IN THE FOREST");
  assert.equal(screenings[2]?.title, "THE BIGAMIST");
  assert.ok(screenings[2]?.formatTags?.includes("Special Event/Talkback"));
  assert.equal(new Date(screenings[2]?.startAt ?? "").toISOString(), "2026-03-04T01:00:00.000Z");
});

test("quad cinema parser captures dated homepage schedules and format bugs", () => {
  const payload = `
    <div class="day-wrap date-03">
      <div class="col span_3 grid-item">
        <div class="imgSpacing bgImg" style="background-image:url(https://example.com/place.jpg)"><a href="https://quadcinema.com/film/a-place-in-the-sun/" class="overlayLink"></a></div>
        <h4><a href="https://quadcinema.com/film/a-place-in-the-sun/">A Place in the Sun</a></h4>
        <ul class="showtimes-list list-inline ts-2 aCRed">
          <li class="time-815pm"><a href="http://www.fandango.com/quadcinema_aaefp/theaterpage?date=2026-03-03">8.15pm</a></li>
          <li class="bug-35mm"><a href="/35mm/">35mm</a></li>
        </ul>
        <div class="aCGray related-program"><a class="ts-2" href="https://quadcinema.com/program/march-melodrama/">March Melodrama</a></div>
      </div>
    </div>
  `;

  const screenings = parseQuadCinemaHtml(payload);
  assert.equal(screenings.length, 1);
  assert.equal(screenings[0]?.title, "A Place in the Sun");
  assert.equal(screenings[0]?.seriesName, "March Melodrama");
  assert.ok(screenings[0]?.formatTags?.includes("35MM"));
});

test("metrograph parser extracts metadata and sold-out state from the NYC calendar", () => {
  const payload = `
    <div class="calendar-list-day movies-grid" id="calendar-list-day-2026-03-21">
      <div class="item film-thumbnail homepage-in-theater-movie">
        <a href="/film/?vista_film_id=9999004735" class="image"><img src="https://example.com/bluest.jpg" /></a>
        <h4><a href="/film/?vista_film_id=9999004735" class="title">By the Bluest of Seas</a></h4>
        <div class="film-metadata">Boris Barnet / 1936 / 71min / 35mm</div>
        <div class="film-description">Introduction by Metrograph Programmer Edo Choi</div>
        <div class="showtimes"><a class="sold_out" title="Sold Out">8:45pm</a></div>
      </div>
    </div>
  `;

  const screenings = parseMetrographNycHtml(payload);
  assert.equal(screenings.length, 1);
  assert.equal(screenings[0]?.film?.directors?.[0], "Boris Barnet");
  assert.ok(screenings[0]?.formatTags?.includes("35MM"));
  assert.equal(screenings[0]?.soldOut, true);
  assert.equal(screenings[0]?.sourceUrl, "https://metrograph.com/film/?vista_film_id=9999004735");
});

test("metrograph film page parser extracts poster and long synopsis", () => {
  const payload = `
    <meta property="og:image" content="https://example.com/madame.jpg" />
    <h1>THE EARRINGS OF MADAME DE...</h1>
    <div>DIRECTOR: MAX OPHULS 1953 / 105MIN / 35MM</div>
    <div class="entry-content">
      <p>Noblewoman Danielle Darrieux, desperate for cash, sells a pair of diamond earrings gifted by aristocrat spouse Charles Boyer.</p>
      <p>The gift returns to her by way of an Italian baron, setting off an elegant and destructive love affair.</p>
    </div>
  `;

  const film = parseMetrographFilmPageHtml("https://metrograph.com/film/?vista_film_id=9999001228", payload);
  assert.equal(film.posterUrl, "https://example.com/madame.jpg");
  assert.match(film.synopsis ?? "", /Danielle Darrieux/);
  assert.equal(film.directors?.[0], "MAX OPHULS");
  assert.equal(film.releaseYear, 1953);
  assert.equal(film.runtimeMinutes, 105);
  assert.ok(film.formatTags?.includes("35MM"));
});

test("metrograph film page parser ignores generic now playing headers", () => {
  const payload = `
    <meta property="og:title" content="The Earrings of Madame de... - Now Playing In Theater at Metrograph" />
    <meta property="og:image" content="https://example.com/madame.jpg" />
    <h1>Now Playing</h1>
    <h2>THE EARRINGS OF MADAME DE...</h2>
    <div>SELECT SHOWTIME BELOW TO PURCHASE TICKETS</div>
    <div>DIRECTOR: MAX OPHULS 1953 / 105MIN / 35MM</div>
    <div class="entry-content">
      <p>Noblewoman Danielle Darrieux sells a pair of diamond earrings and sets off a destructive love affair.</p>
    </div>
  `;

  const film = parseMetrographFilmPageHtml("https://metrograph.com/film/?vista_film_id=9999001228", payload);
  assert.equal(film.canonicalTitle, "The Earrings of Madame de...");
  assert.equal(film.directors?.[0], "MAX OPHULS");
  assert.equal(film.releaseYear, 1953);
});

test("paris theater parser extracts public dated event listings from the homepage payload", () => {
  const payload = `
    "FilmName":"Peaky Blinders: The Immortal Man","Slug":"peaky-blinders-the-immortal-man-paris","Director":"Tom Harper","Synopsis":"Epic feature film.","Runtime":112,"FilmFormat":"DCP","Year":"2026"
    "EventName":"PEAKY BLINDERS: THE IMMORTAL MAN | Opening Night Celebration","EventDate":"2026-03-06","HeroDetails":"Dress in your Shelby best.","TicketLink":"https://tickets.paristheaternyc.com/order/showtimes/2001-2322/seats","Slug":"peaky-blinders-the-immortal-man-opening-night","EventTime":"7 PM"
  `;

  const screenings = parseParisTheaterHomepageHtml(payload);
  assert.equal(screenings.length, 1);
  assert.equal(screenings[0]?.title, "Peaky Blinders: The Immortal Man");
  assert.equal(screenings[0]?.seriesName, "PEAKY BLINDERS: THE IMMORTAL MAN | Opening Night Celebration");
  assert.equal(new Date(screenings[0]?.startAt ?? "").toISOString(), "2026-03-07T00:00:00.000Z");
});

test("angelika parser extracts showtimes, poster, and format tags from now showing api payload", () => {
  const venue = curatedVenues.find((entry) => entry.slug === "angelika-film-center");
  assert.ok(venue);

  const screenings = parseAngelikaNowShowingResponse(venue, [
    {
      theater: "Angelika New York",
      movieSlug: "ephus",
      name: "Ephus",
      synopsis: "<p>Baseball, friendship, and one last game.</p>",
      director: "Carson Lund",
      language: "English",
      genre: "Drama",
      status: "Now Showing",
      length: "98",
      release_date: "2025-03-07",
      film_image_original_size: "https://cdn.example.com/ephus.jpg",
      showdates: [
        {
          date: "2026-03-14",
          showtypes: [
            {
              type: "35mm",
              amenities: ["Special Event/Talkback"],
              showtimes: [
                {
                  id: "show-1",
                  date_time: "2026-03-14T19:00:00-04",
                  statusCode: "0",
                  soldout: false,
                  searchAttributes: "35mm Q&A"
                }
              ]
            }
          ]
        }
      ]
    }
  ]);

  assert.equal(screenings.length, 1);
  assert.equal(screenings[0]?.title, "Ephus");
  assert.equal(screenings[0]?.film?.posterUrl, "https://cdn.example.com/ephus.jpg");
  assert.equal(screenings[0]?.film?.runtimeMinutes, 98);
  assert.ok(screenings[0]?.formatTags?.includes("35MM"));
  assert.ok(screenings[0]?.formatTags?.includes("Special Event/Talkback"));
});

test("screenslate parser prefers note/body description over concatenated source text and parses metadata", async () => {
  const venue = curatedVenues.find((entry) => entry.slug === "moma-film-screenings");
  assert.ok(venue);

  const info = `<span>Akira Kurosawa</span><span>1985</span><span>162M</span><span>35mm</span>`;
  const parsed = screenSlateTestables.parseScreenSlateInfo({
    nid: "101121",
    title: "MOMA CHAOS",
    media_title_info: info,
    media_title_labels: `<span>Ran</span>`
  });

  assert.deepEqual(parsed.directors, ["Akira Kurosawa"]);
  assert.equal(parsed.releaseYear, 1985);
  assert.equal(parsed.runtimeMinutes, 162);
});

test("moma adapter parses screenslate MoMA entries into film drafts", () => {
  const drafts = parseMoMAScreenSlateEntries(
    "2026-03-15",
    [
      {
        nid: "100958",
        field_time: "4:00pm",
        field_timestamp: "2026-03-15T16:00:00",
        field_note: ""
      }
    ],
    [
      {
        nid: "100958",
        title: "gent blondes",
        field_display_title: "",
        media_title_info: `<span>Howard Hawks</span><span>1953</span><span>91M</span><span>DCP</span>`,
        field_series: `<a href="/series/marilyn-monroe-celluloid-dream">Marilyn Monroe: Celluloid Dream</a>`,
        field_url: "https://www.moma.org/calendar/events/11220",
        body: "",
        media_title_labels: `<span>Gentlemen Prefer Blondes</span>`,
        venue_title: `<a href="/venues/museum-modern-art">Museum of Modern Art</a>`,
        media_title_format: "DCP"
      }
    ]
  );

  assert.equal(drafts.length, 1);
  assert.equal(drafts[0]?.title, "Gentlemen Prefer Blondes");
  assert.equal(drafts[0]?.film?.releaseYear, 1953);
  assert.equal(drafts[0]?.film?.runtimeMinutes, 91);
  assert.deepEqual(drafts[0]?.film?.directors, ["Howard Hawks"]);
  assert.equal(drafts[0]?.sourceUrl, "https://www.moma.org/calendar/events/11220");
});

test("spectacle rolling calendar parser extracts next seven days listings", () => {
  const rollingPayload = `
    <table class="spexcal">
      <tr>
        <th>TUE - 3 <!-- 2026-03-03 --></th>
        <th>WED - 4 <!-- 2026-03-04 --></th>
      </tr>
      <tr>
        <td>7:30&#8239;PM<br/>Gaea Girls</td>
        <td><a href="/four-films-by-leida-laius/">7:30&#8239;PM<br/><img alt="Spring in the Forest/Ukuaru" /></a></td>
      </tr>
    </table>
  `;
  const homePayload = `<a href="https://www.spectacletheater.com/four-films-by-leida-laius/">FOUR FILMS BY LEIDA LAIUS</a>`;

  const screenings = parseSpectacleRollingHtml(rollingPayload, homePayload);
  assert.equal(screenings.length, 2);
  assert.equal(screenings[0]?.title, "Gaea Girls");
  assert.equal(screenings[1]?.seriesName, "FOUR FILMS BY LEIDA LAIUS");
});

test("moving image parser keeps only public ticketed screenings", () => {
  const payload = `
    <article>
      <h3>2001: A Space Odyssey</h3>
      <time datetime="2026-03-04"></time>
      <span class="time">8:30 PM</span>
      <p class="description">Tickets available now for the 70mm screening.</p>
      <a href="/events/2001"></a>
      <p class="format">70mm</p>
    </article>
    <article>
      <h3>Members Screening</h3>
      <time datetime="2026-03-04"></time>
      <span class="time">5:00 PM</span>
      <p class="description">Editorial listing with no public ticket language.</p>
      <a href="/events/members"></a>
    </article>
  `;

  const screenings = parseMovingImageHtml(payload);
  assert.equal(screenings.length, 1);
  assert.equal(screenings[0]?.title, "2001: A Space Odyssey");
  assert.ok(screenings[0]?.formatTags?.includes("70MM"));
});

test("roxy parser extracts homepage screening cards with datetimes", () => {
  const payload = `
    <div class='screening__card js-link swiper-slide' data-controller='screening-card' data-datetime='2026-03-09 19:00:00 -0400'>
      <img class="screening__image" src="https://cdn.example.com/moment.jpg" />
      <h3 class='screening__title'>
        <a class="screening__cta" href="https://www.roxycinemanewyork.com/screenings/the-moment/">The Moment</a>
      </h3>
      <p class='screening__date'>03.09.2026 | 7:00PM</p>
    </div>
  `;

  const screenings = parseRoxyHomepageHtml(payload);
  assert.equal(screenings.length, 1);
  assert.equal(screenings[0]?.title, "The Moment");
  assert.equal(new Date(screenings[0]?.startAt ?? "").toISOString(), "2026-03-09T23:00:00.000Z");
  assert.equal(screenings[0]?.film?.posterUrl, "https://cdn.example.com/moment.jpg");
});

test("bam parser extracts film detail links and JSON-LD events", () => {
  const listingPayload = `
    <a href="/film/2026/pillion">More</a>
    <a href="/film/2025/the-secret-agent">More</a>
  `;
  const links = parseBamFilmLinks(listingPayload);
  assert.equal(links.length, 2);
  assert.equal(links[0], "https://www.bam.org/film/2026/pillion");

  const detailPayload = `
    <script type="application/ld+json">
      [{
        "@type":"Event",
        "name":"Pillion - Tue, Mar 10 at 4:15PM",
        "description":"A timid young man is swept off his feet.",
        "startDate":"2026-03-10T16:15:00-04:00",
        "offers":{"url":"https://commerce.bam.org/booking/production/53945"},
        "image":"https://www.bam.org/globalassets/pillion.jpg",
        "eventStatus":"https://schema.org/EventScheduled"
      }]
    </script>
  `;
  const screenings = parseBamDetailEvents(detailPayload, "https://www.bam.org/film/2026/pillion");
  assert.equal(screenings.length, 1);
  assert.equal(screenings[0]?.title, "Pillion");
  assert.equal(new Date(screenings[0]?.startAt ?? "").toISOString(), "2026-03-10T20:15:00.000Z");
  assert.equal(screenings[0]?.sourceUrl, "https://commerce.bam.org/booking/production/53945");
});

test("nitehawk parser extracts day links and showtimes for a venue schedule", () => {
  const homepagePayload = `
    <a class="date-box selected" href="https://nitehawkcinema.com/prospectpark/2026-03-09/0/" data-date="2026-03-09">Today</a>
    <a class="date-box" href="https://nitehawkcinema.com/prospectpark/2026-03-10/1/" data-date="2026-03-10">Tuesday</a>
  `;
  const urls = parseNitehawkScheduleUrls(homepagePayload, "https://nitehawkcinema.com/prospectpark/");
  assert.equal(urls.length, 2);
  assert.equal(urls[0], "https://nitehawkcinema.com/prospectpark/2026-03-09/0/");

  const schedulePayload = `
    <ul id="buy-tickets-listview" class="thumbnails-container">
      <li class="show-container thumbnail" role="article">
        <div class="show-thumbnail-holder">
          <div class="show-thumbnail" style="background-image: url(https://example.com/poet.jpg)">
            <div class="show-info"><div class="show-title">A Poet</div></div>
          </div>
          <div class="more-info-container">
            <div class="short-description">A poet revisits the city of his youth.</div>
            <a class="overlay-link" href="https://nitehawkcinema.com/prospectpark/movies/a-poet/?date=today"></a>
          </div>
        </div>
        <div class="showtimes-container clearfix">
          <ul class="showtime-button-row">
            <li>
              <span class="showtime has-open-captions">7:30 pm <span class="badge open-captions">OC</span></span>
            </li>
            <li>
              <span class="showtime sold-out">10:00 pm</span>
            </li>
          </ul>
        </div>
      </li>
    </ul>
  `;
  const screenings = parseNitehawkSchedulePage(schedulePayload, "https://nitehawkcinema.com/prospectpark/", "2026-03-09");
  assert.equal(screenings.length, 2);
  assert.equal(screenings[0]?.title, "A Poet");
  assert.equal(new Date(screenings[0]?.startAt ?? "").toISOString(), "2026-03-09T23:30:00.000Z");
  assert.equal(screenings[0]?.film?.posterUrl, "https://example.com/poet.jpg");
  assert.equal(screenings[1]?.soldOut, true);
});

test("generic JSON-LD parser extracts event records and honors include rules", () => {
  const payload = `
    <script type="application/ld+json">
      {
        "@context":"https://schema.org",
        "@type":"Event",
        "name":"35mm Anniversary Screening",
        "startDate":"2026-03-13T19:00:00-04:00",
        "description":"Special event with tickets available now.",
        "url":"https://example.org/events/35mm",
        "image":"https://example.org/images/35mm.jpg"
      }
    </script>
    <script type="application/ld+json">
      {
        "@context":"https://schema.org",
        "@type":"Event",
        "name":"Generic Multiplex Title",
        "startDate":"2026-03-13T21:00:00-04:00",
        "description":"Standard daily show"
      }
    </script>
  `;

  const specialtyOnly = parseGenericJsonLdEvents(payload, {
    website: "https://example.org",
    slug: "amc-lincoln-square-13",
    name: "AMC 13 (IMAX)",
    includeRules: ["imax-only", "special-events-only"]
  });
  assert.equal(specialtyOnly.length, 1);
  assert.equal(specialtyOnly[0]?.title, "35mm Anniversary Screening");
  assert.ok(specialtyOnly[0]?.formatTags?.includes("35MM"));
});

test("AMC IMAX parser reads JSON-LD event showtimes and applies IMAX tag", () => {
  const payload = `
    <script type="application/ld+json">
      {
        "@context":"https://schema.org",
        "@type":"Event",
        "name":"Sinners: The IMAX Experience",
        "startDate":"2026-03-13T19:00:00-04:00",
        "description":"IMAX 70mm special event at AMC 13."
      }
    </script>
  `;

  const drafts = parseAmcImaxHtml(payload, "https://www.imax.com/theatre/amc-lincoln-square-13-imax", "2026-03-13");
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0]?.title, "Sinners: The IMAX Experience");
  assert.ok(drafts[0]?.formatTags?.includes("IMAX"));
  assert.ok(drafts[0]?.formatTags?.includes("70MM"));
});

test("AMC Fever fallback parser keeps only IMAX with Laser sessions", () => {
  const payload = `
    <script>
      window.__DATA__ = {"movieDate":{"date":"2026-03-13","status":"available"},"showtimes":[
        {"coverPhotoUrl":"https://images.example.com/bride.jpg","id":44537,"reference":"44537-the-bride-2026","runtimeMinutes":126,
         "screenFormatSessions":[
           {"attributes":["CC","Reserved Seating"],"screenFormat":"IMAX with Laser","sessions":[
             {"isExpired":false,"isSoldOut":false,"sessionId":404122770,"time":"2026-03-13T22:45:00-04:00"}
           ]},
           {"attributes":["CC","Reserved Seating"],"screenFormat":"Laser at AMC","sessions":[
             {"isExpired":false,"isSoldOut":false,"sessionId":404629655,"time":"2026-03-13T19:15:00-04:00"}
           ]}
         ],
         "timezone":"America/New_York","title":"The Bride"},
        {"coverPhotoUrl":"https://images.example.com/undertone.jpg","id":45398,"reference":"45398-undertone","runtimeMinutes":93,
         "screenFormatSessions":[
           {"attributes":["CC"],"screenFormat":"Laser at AMC","sessions":[
             {"isExpired":false,"isSoldOut":false,"sessionId":393116729,"time":"2026-03-13T20:00:00-04:00"}
           ]}
         ],
         "timezone":"America/New_York","title":"Undertone"}
      ],"theaterCalendarAvailability":{"dates":[{"date":"2026-03-13","status":"available"}]}};
    </script>
  `;

  const drafts = parseAmcImaxFeverHtml(payload);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0]?.title, "The Bride");
  assert.equal(drafts[0]?.sourceUrl, "https://feverup.com/movies/en/movie/44537-the-bride-2026");
  assert.equal(drafts[0]?.film?.posterUrl, "https://images.example.com/bride.jpg");
  assert.ok(drafts[0]?.formatTags?.includes("IMAX"));
  assert.ok(drafts[0]?.formatTags?.includes("IMAX with Laser"));
  assert.equal(new Date(drafts[0]?.startAt ?? "").toISOString(), "2026-03-14T02:45:00.000Z");
});

test("screenslate helpers extract title, venue mapping, and page metadata", () => {
  const detail = {
    nid: "100374",
    title: "Live-Action Oscar-Nominated Shorts 2026 at IFC Center",
    field_display_title: "",
    media_title_labels:
      '  <span class="field field--name-title field--type-string field--label-hidden">Live-Action Oscar-Nominated Shorts 2026</span>\n',
    venue_title: '<a href="/venues/ifc-center" hreflang="en">IFC Center</a>'
  };

  const title = screenSlateTestables.extractPrimaryTitle(detail);
  assert.equal(title, "Live-Action Oscar-Nominated Shorts 2026");

  const venueName = screenSlateTestables.extractVenueName(detail.venue_title);
  assert.equal(venueName, "IFC Center");

  const venue = screenSlateTestables.mapVenueNameToCuratedVenue(venueName, curatedVenues);
  assert.equal(venue?.slug, "ifc-center");

  const amcAlias = screenSlateTestables.mapVenueNameToCuratedVenue("AMC Lincoln Square 13", curatedVenues);
  assert.equal(amcAlias?.slug, "amc-lincoln-square-13");
  assert.equal(amcAlias?.name, "AMC 13 (IMAX)");
  const amc14Alias = screenSlateTestables.mapVenueNameToCuratedVenue("AMC 14 IMAX", curatedVenues);
  assert.equal(amc14Alias?.slug, "amc-lincoln-square-13");

  const meta = screenSlateTestables.parseExternalPageMeta(
    `
      <meta property="og:image" content="https://example.com/film.jpg" />
      <meta name="description" content="A moving portrait of a city in flux." />
    `,
    "https://example.com/film"
  );
  assert.equal(meta.image, "https://example.com/film.jpg");
  assert.equal(meta.description, "A moving portrait of a city in flux.");
});

test("screenslate title helper prefers media labels over generic display titles", () => {
  const detail = {
    nid: "101436",
    title: "The House on Trubnaya Mar 26 Metrograph",
    field_display_title: "One Night Only!",
    media_title_labels:
      '  <span class="field field--name-title field--type-string field--label-hidden">The House on Trubnaya</span>\n'
  };

  const title = screenSlateTestables.extractPrimaryTitle(detail);
  assert.equal(title, "The House on Trubnaya");
});
