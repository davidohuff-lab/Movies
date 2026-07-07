import assert from "node:assert/strict";
import test from "node:test";

import { cycleTagFilterMode, matchesTagFilterStates, parseStoredTagFilterStates, setTagFilterMode } from "@/lib/tag-filter-state";
import { FIRST_CLASS_TAGS, inferTagsFromText } from "@/lib/tags";

test("tri-state filter cycles include, exclude, then neutral", () => {
  assert.equal(cycleTagFilterMode(undefined), "include");
  assert.equal(cycleTagFilterMode("include"), "exclude");
  assert.equal(cycleTagFilterMode("exclude"), undefined);
});

test("legacy stored array becomes include-only state map", () => {
  const parsed = parseStoredTagFilterStates(JSON.stringify(["35MM", "Premiere", "Nope"]), FIRST_CLASS_TAGS);

  assert.deepEqual(parsed, {
    "35MM": "include",
    Premiere: "include"
  });
});

test("include and exclude filters use OR include semantics plus exclusion suppression", () => {
  let states = setTagFilterMode({}, "Documentary", "include");
  states = setTagFilterMode(states, "Premiere", "exclude");

  assert.equal(matchesTagFilterStates(["Documentary", "Restoration"], states), true);
  assert.equal(matchesTagFilterStates(["Documentary", "Premiere"], states), false);
  assert.equal(matchesTagFilterStates(["Animation"], states), false);
});

test("text inference adds documentary, animation, restoration, premiere, and retrospective", () => {
  const tags = inferTagsFromText(
    "New 4K restoration documentary retrospective with opening night premiere and animated short."
  );

  assert.deepEqual(
    tags.sort(),
    ["Animation", "Documentary", "Premiere", "Restoration", "Retrospective"].sort()
  );
});
