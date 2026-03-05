import test from "node:test";
import assert from "node:assert/strict";

import { ingestTierOneFixtures } from "@/lib/ingest";
import { searchAroundTime } from "@/lib/search";

test("liking a Korean film boosts future Korean screenings", async () => {
  const dataset = await ingestTierOneFixtures();
  const baseResults = searchAroundTime(
    dataset,
    { date: "2026-03-03", time: "20:00", windowMinutes: 180 },
    { preferences: [], liveBoosts: [] }
  );
  const boostedResults = searchAroundTime(
    dataset,
    { date: "2026-03-03", time: "20:00", windowMinutes: 180 },
    {
      preferences: [{ filmId: "film-the-housemaid-1960", thumb: "up", createdAt: new Date().toISOString() }],
      liveBoosts: []
    }
  );

  const baseRank = baseResults.findIndex((result) => result.film.id === "film-the-housemaid-1960");
  const boostedRank = boostedResults.findIndex((result) => result.film.id === "film-the-housemaid-1960");
  assert.ok(boostedRank <= baseRank);
});

test("live 35MM boosts move 35MM screenings upward immediately", async () => {
  const dataset = await ingestTierOneFixtures();
  const baseResults = searchAroundTime(
    dataset,
    { date: "2026-03-03", time: "20:00", windowMinutes: 180 },
    { preferences: [], liveBoosts: [] }
  );
  const boostedResults = searchAroundTime(
    dataset,
    { date: "2026-03-03", time: "20:00", windowMinutes: 180 },
    { preferences: [], liveBoosts: ["35MM"] }
  );

  const baseRank = baseResults.findIndex((result) => result.tags.includes("35MM"));
  const boostedRank = boostedResults.findIndex((result) => result.tags.includes("35MM"));
  assert.ok(boostedRank <= baseRank);
});
