import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanupDefeatedHeroCharters } from "@heroes/engine";
import { makeCharter, makeHero, makeState } from "./_helpers";

test("cleanupDefeatedHeroCharters is a no-op when the hero does not exist", () => {
  const s = makeState({
    activeCharters: [makeCharter({ id: "c0", heroId: "h0", ownerId: 0 })],
  });
  const next = cleanupDefeatedHeroCharters(s, "ghost");
  assert.equal(next, s);
  assert.equal(next.activeCharters.length, 1);
});

test("cleanupDefeatedHeroCharters is a no-op when the hero was not chartering", () => {
  const s = makeState({
    heroes: [makeHero("h0", 0, 2, 2, { isChartering: false, charterId: null })],
    activeCharters: [makeCharter({ id: "c0", heroId: "h1", ownerId: 1 })],
  });
  const next = cleanupDefeatedHeroCharters(s, "h0");
  assert.equal(next, s);
});

test("cleanupDefeatedHeroCharters is a no-op when isChartering is true but charterId is null", () => {
  const s = makeState({
    heroes: [makeHero("h0", 0, 2, 2, { isChartering: true, charterId: null })],
    activeCharters: [],
  });
  const next = cleanupDefeatedHeroCharters(s, "h0");
  assert.equal(next, s);
});

test("cleanupDefeatedHeroCharters removes the defeated hero's active charter and marks state dirty", () => {
  const s = makeState({
    heroes: [makeHero("h0", 0, 2, 2, { isChartering: true, charterId: "c0" })],
    activeCharters: [makeCharter({ id: "c0", heroId: "h0", ownerId: 0 })],
  });
  const next = cleanupDefeatedHeroCharters(s, "h0");
  assert.notEqual(next, s);
  assert.equal(next.activeCharters.length, 0);
  assert.equal(next.dirty, true);
});

test("cleanupDefeatedHeroCharters only removes the defeated hero's charter, leaving others untouched", () => {
  const s = makeState({
    heroes: [
      makeHero("h0", 0, 2, 2, { isChartering: true, charterId: "c0" }),
      makeHero("h1", 1, 18, 4, { isChartering: true, charterId: "c1" }),
    ],
    activeCharters: [
      makeCharter({ id: "c0", heroId: "h0", ownerId: 0 }),
      makeCharter({ id: "c1", heroId: "h1", ownerId: 1 }),
    ],
  });
  const next = cleanupDefeatedHeroCharters(s, "h0");
  assert.equal(next.activeCharters.length, 1);
  assert.equal(next.activeCharters[0].id, "c1");
});
