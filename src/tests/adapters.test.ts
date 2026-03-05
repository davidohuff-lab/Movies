import test from "node:test";
import assert from "node:assert/strict";

import { parseFilmForumNowPlayingHtml } from "@/lib/adapters/filmForum";
import { parseFilmNoirProgramHtml } from "@/lib/adapters/filmNoir";
import { parseIfcFilmPageHtml, parseIfcHomeWidgetHtml } from "@/lib/adapters/ifcCenter";
import { parseLowCinemaHtml } from "@/lib/adapters/lowCinema";
import { parseMetrographFilmPageHtml, parseMetrographNycHtml } from "@/lib/adapters/metrograph";
import { parseMovingImageHtml } from "@/lib/adapters/movingImage";
import { parseParisTheaterHomepageHtml } from "@/lib/adapters/parisTheater";
import { parseQuadCinemaHtml } from "@/lib/adapters/quadCinema";
import { parseSpectacleRollingHtml } from "@/lib/adapters/spectacle";

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
            </ul>
          </div>
        </li>
      </ul>
    </div>
    <p><span>Wed Mar 4:</span> <span class="ipe-title"><a href="https://www.ifccenter.com/films/the-ugly-stepsister/">The Ugly Stepsister</a></span> <span class="ipe-caption">Screening on 35mm at 7:00!</span></p>
  `;

  const screenings = parseIfcHomeWidgetHtml(payload, new Date("2026-03-02T12:00:00-05:00"));
  assert.equal(screenings.length, 1);
  assert.equal(screenings[0]?.title, "The Ugly Stepsister");
  assert.ok(screenings[0]?.formatTags?.includes("35MM"));
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
