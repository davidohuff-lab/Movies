import test from "node:test";
import assert from "node:assert/strict";

import { isAlamoSpecialty, isPublicBookableMoMA, isSpecialtyListing } from "@/lib/tags";

test("specialty listing filter includes IMAX and special events", () => {
  assert.equal(isSpecialtyListing("IMAX 70mm special event"), true);
  assert.equal(isSpecialtyListing("Standard digital screening"), false);
});

test("alamo specialty filter excludes generic multiplex slates", () => {
  assert.equal(isAlamoSpecialty("Terror Tuesday presents House"), true);
  assert.equal(isAlamoSpecialty("2:00 PM Captain Generic"), false);
});

test("MoMA public-booking filter requires visible ticketing language", () => {
  assert.equal(isPublicBookableMoMA("Book tickets now"), true);
  assert.equal(isPublicBookableMoMA("Editorial essay and archive note"), false);
});
