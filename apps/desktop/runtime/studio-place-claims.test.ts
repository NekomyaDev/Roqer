import assert from "node:assert/strict";
import test from "node:test";

import { StudioPlaceClaims } from "./studio-place-claims";

test("one run writes a Studio place at a time, and a second is refused until the first releases it", () => {
  const places = new StudioPlaceClaims();
  const first = places.claim("place-a");
  assert.ok(first, "the first run gets the place");
  assert.equal(places.claim("place-a"), null, "a second run on the same place is refused");
  assert.equal(places.holds("place-a"), true);

  places.release(first);
  assert.equal(places.holds("place-a"), false);
  assert.ok(places.claim("place-a"), "a released place can be claimed again");
});

test("different Studio places are claimed independently", () => {
  const places = new StudioPlaceClaims();
  assert.ok(places.claim("place-a"));
  assert.ok(places.claim("place-b"), "another place is not blocked by the first");
});

test("a stale release cannot free a place another run has since claimed", () => {
  const places = new StudioPlaceClaims();
  const old = places.claim("place-a");
  places.release(old);
  const next = places.claim("place-a");
  assert.ok(next);

  places.release(old);
  assert.equal(places.holds("place-a"), true, "the new holder keeps the place");
  assert.equal(places.claim("place-a"), null);
});

test("a run with no Studio place claims nothing and releases nothing", () => {
  const places = new StudioPlaceClaims();
  places.release(null);
  assert.ok(places.claim("place-a"), "releasing nothing leaves the place free to claim");
});
