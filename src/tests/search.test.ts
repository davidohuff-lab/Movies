import test from "node:test";
import assert from "node:assert/strict";

import { ingestTierOneFixtures } from "@/lib/ingest";
import { searchAroundTime, searchTonight } from "@/lib/search";

test("around time returns screenings inside the default +/- 120 minute window", async () => {
  const dataset = await ingestTierOneFixtures();
  const results = searchAroundTime(
    dataset,
    { date: "2026-03-03", time: "20:00", windowMinutes: 120 },
    { preferences: [], liveBoosts: [] }
  );

  assert.ok(results.length > 0);
  assert.ok(results.every((result) => Math.abs(result.deltaMinutes) <= 120));
});

test("tonight mode only returns screenings at or after the chosen time", async () => {
  const dataset = await ingestTierOneFixtures();
  const results = searchTonight(
    dataset,
    { date: "2026-03-03", time: "19:00" },
    { preferences: [], liveBoosts: [] }
  );

  assert.ok(results.length > 0);
  assert.ok(results.every((result) => new Date(result.screening.startAt) >= new Date("2026-03-03T19:00:00-05:00")));
});
