import assert from "node:assert/strict";
import test from "node:test";

import {
  hasWeakSynopsis,
  parseRottenTomatoesMovieHtml,
  parseRottenTomatoesSearchHtml
} from "@/lib/rottentomatoes";

test("rotten tomatoes search parser extracts movie results with year and url", () => {
  const payload = `
    <search-page-result skeleton="panel" type="movie" data-qa="search-result">
      <ul slot="list">
        <search-page-media-row release-year="2002">
          <a href="https://www.rottentomatoes.com/m/punchdrunk_love" class="unset" data-qa="info-name" slot="title">
            Punch-Drunk Love
          </a>
        </search-page-media-row>
        <search-page-media-row release-year="2022">
          <a href="https://www.rottentomatoes.com/m/punch_drunk_love" class="unset" data-qa="info-name" slot="title">
            Punch-Drunk Love
          </a>
        </search-page-media-row>
      </ul>
    </search-page-result>
  `;

  const results = parseRottenTomatoesSearchHtml(payload);
  assert.equal(results.length, 2);
  assert.equal(results[0]?.title, "Punch-Drunk Love");
  assert.equal(results[0]?.releaseYear, 2002);
  assert.equal(results[0]?.url, "https://www.rottentomatoes.com/m/punchdrunk_love");
});

test("rotten tomatoes movie parser extracts synopsis and title", () => {
  const payload = `
    <meta property="og:title" content="Punch-Drunk Love | Rotten Tomatoes" />
    <meta property="og:image" content="https://example.com/punchdrunklove.jpg" />
    <script>
      RottenTomatoes.dtmData = {"titleName":"Punch-Drunk Love","titleType":"Movie"};
    </script>
    <div class="synopsis-wrap">
      <rt-text class="key" size="0.875" data-qa="synopsis-label">Synopsis</rt-text>
      <rt-text data-qa="synopsis-value">Although susceptible to violent outbursts, Barry Egan lives a timid life until love and extortion collide.</rt-text>
    </div>
    <div>"release":"Oct 11, 2002"</div>
  `;

  const metadata = parseRottenTomatoesMovieHtml(payload);
  assert.equal(metadata.canonicalTitle, "Punch-Drunk Love");
  assert.match(metadata.synopsis ?? "", /Barry Egan/);
  assert.equal(metadata.posterUrl, "https://example.com/punchdrunklove.jpg");
  assert.equal(metadata.releaseYear, 2002);
});

test("weak synopsis detection flags placeholder venue copy", () => {
  assert.equal(hasWeakSynopsis("Back to films"), true);
  assert.equal(hasWeakSynopsis("Listed on Metrograph's NYC calendar."), true);
  assert.equal(
    hasWeakSynopsis("Although susceptible to violent outbursts, Barry Egan lives a timid life until love and extortion collide."),
    false
  );
});
