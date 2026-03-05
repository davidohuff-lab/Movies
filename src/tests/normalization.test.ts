import test from "node:test";
import assert from "node:assert/strict";

import { normalizeTitle } from "@/lib/utils";

test("normalizeTitle removes punctuation and leading articles", () => {
  assert.equal(normalizeTitle("The Housemaid!"), "housemaid");
  assert.equal(normalizeTitle("Paris, Texas"), "paris texas");
});
