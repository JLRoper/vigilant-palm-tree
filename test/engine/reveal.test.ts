import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HERO_VISION_RANGE,
  mergePlayerReveal,
  revealForPlayer,
  visionKeysAroundPoints,
  visionKeysForPlayer,
} from "@heroes/engine";
import { makeHero, makePlayer, makeSettlement, makeState } from "../charter/_helpers";

function ringKeys(q: number, r: number, range: number): string[] {
  const keys: string[] = [];
  for (let dq = -range; dq <= range; dq++) {
    for (let dr = -range; dr <= range; dr++) {
      if (Math.abs(dq + dr) > range) continue;
      keys.push(`${q + dq},${r + dr}`);
    }
  }
  return keys;
}

test("visionKeysAroundPoints: radius 2 around one point yields exactly 19 keys", () => {
  const keys = visionKeysAroundPoints([{ q: 0, r: 0 }], 2);
  assert.equal(keys.size, 19);
  assert.deepEqual([...keys].sort(), ringKeys(0, 0, 2).sort());
});

test("visionKeysAroundPoints: radius 0 yields exactly the point", () => {
  const keys = visionKeysAroundPoints([{ q: 3, r: -5 }], 0);
  assert.equal(keys.size, 1);
  assert.ok(keys.has("3,-5"));
});

test("visionKeysAroundPoints: duplicate points collapse, overlapping points union", () => {
  const dup = visionKeysAroundPoints([{ q: 0, r: 0 }, { q: 0, r: 0 }, { q: 0, r: 0 }], 1);
  assert.equal(dup.size, 7, "the same point listed three times yields one ring");

  const overlap = visionKeysAroundPoints([{ q: 0, r: 0 }, { q: 1, r: 0 }], 1);
  assert.equal(overlap.size, 10, "union of the two radius-1 rings (4 shared tiles)");
  assert.ok(overlap.has("0,0"));
  assert.ok(overlap.has("1,0"));
  assert.ok(overlap.has("2,0"));
});

test("visionKeysAroundPoints defaults the hero radius", () => {
  const keys = visionKeysAroundPoints([{ q: 0, r: 0 }]);
  assert.equal(keys.size, ringKeys(0, 0, HERO_VISION_RANGE).length);
});

function visionFixture() {
  return makeState({
    players: [
      makePlayer(0, "player", ["h0"], ["s0"]),
      makePlayer(1, "player", ["h1"], ["s1"]),
      makePlayer(2, "player", [], ["s2"]),
    ],
    heroes: [makeHero("h0", 0, 0, 0), makeHero("h1", 1, 50, 50)],
    settlements: [
      makeSettlement("s0", 0, 0, 0, { level: 2 }),
      makeSettlement("s1", 1, 50, 50),
      makeSettlement("s2", 2, 10, 10, { level: 3 }),
    ],
  });
}

test("visionKeysForPlayer unions own hero ring and own settlement controlRange", () => {
  const state = visionFixture();
  const keys = visionKeysForPlayer(state, 0);
  // Hero ring radius 4 around (0,0) covers the settlement's radius-2 ring.
  assert.ok(keys.has("0,0"));
  assert.ok(keys.has("4,0"), "hero vision edge along +q");
  assert.ok(keys.has("0,4"), "hero vision edge along +r");
});

test("visionKeysForPlayer: settlement-only player reveals its controlRange ring", () => {
  const state = visionFixture();
  const keys = visionKeysForPlayer(state, 2);
  // Player 2 has no hero; only s2 (level 3 -> controlRange 3) at (10,10).
  assert.ok(keys.has("10,10"));
  assert.ok(keys.has("13,10"), "level-3 settlement reaches dq=3");
  assert.ok(keys.has("10,13"));
  assert.ok(!keys.has("14,10"), "nothing beyond controlRange 3");
});

test("visionKeysForPlayer excludes other players' heroes and settlements", () => {
  const state = visionFixture();
  const keys0 = visionKeysForPlayer(state, 0);
  assert.ok(!keys0.has("50,50"), "player 1's hero/settlement is outside player 0's vision");
  assert.ok(!keys0.has("10,10"), "player 2's settlement is outside player 0's vision");
  assert.ok(!keys0.has("13,10"));

  const keys2 = visionKeysForPlayer(state, 2);
  assert.ok(!keys2.has("0,0"), "player 0's hero/settlement is outside player 2's vision");
  assert.ok(!keys2.has("50,50"), "player 1's hero/settlement is outside player 2's vision");
});

test("mergePlayerReveal is sorted (numeric q then r), deduped, and unions with the existing set", () => {
  const state = makeState({ players: [makePlayer(0, "player", [], [])] });
  const once = mergePlayerReveal(state, 0, ["10,1", "2,0", "10,1", "9,1"]);
  assert.deepEqual(once.players[0].revealedTiles, ["2,0", "9,1", "10,1"], "numeric sort, not lexicographic");

  const twice = mergePlayerReveal(once, 0, ["5,5", "2,0"]);
  assert.deepEqual(twice.players[0].revealedTiles, ["2,0", "5,5", "9,1", "10,1"]);
});

test("mergePlayerReveal returns the same reference when nothing new is added", () => {
  const state = makeState({ players: [makePlayer(0, "player", [], [])] });
  const once = mergePlayerReveal(state, 0, ["1,0", "0,0"]);
  assert.notEqual(once, state);
  const again = mergePlayerReveal(once, 0, ["1,0"]);
  assert.equal(again, once, "second merge with only already-revealed keys is a no-op");
  assert.equal(mergePlayerReveal(state, 0, []), state, "empty keys is a no-op");
});

test("mergePlayerReveal returns the same reference when the player does not exist", () => {
  const state = makeState({ players: [makePlayer(0, "player", [], [])] });
  assert.equal(mergePlayerReveal(state, 99, ["1,0"]), state);
});

test("mergePlayerReveal preserves everything else by reference", () => {
  const state = visionFixture();
  const merged = mergePlayerReveal(state, 0, ["7,7"]);
  assert.notEqual(merged, state);
  assert.notEqual(merged.players, state.players);
  assert.notEqual(merged.players[0], state.players[0]);
  assert.equal(merged.players[1], state.players[1], "other players untouched by reference");
  assert.equal(merged.players[2], state.players[2]);
  assert.equal(merged.heroes, state.heroes);
  assert.equal(merged.settlements, state.settlements);
  assert.deepEqual(merged.players[1], state.players[1]);
});

// revealForPlayer is the ONE uncharted-mode rule: the server applies it and
// persists the result, the client applies it to its own optimistic state (see
// test/state/revealMirrorReconcile.test.ts). Its gate is the `revealedTiles`
// key, which init.ts stamps on the human seats of an uncharted game only.

test("revealForPlayer unions the seat's vision and the walked corridor into its reveal", () => {
  const base = visionFixture();
  const uncharted = {
    ...base,
    players: base.players.map((p) => (p.id === 0 ? { ...p, revealedTiles: [] as string[] } : p)),
  };
  const revealed = revealForPlayer(uncharted, 0, [{ q: 20, r: 20 }]);
  const keys = revealed.players[0].revealedTiles;
  assert.ok(keys, "the seat keeps its key");
  assert.ok(keys!.includes("0,0"), "the seat's own hero ring lands in the reveal");
  assert.ok(keys!.includes("4,0"), "…out to HERO_VISION_RANGE");
  assert.ok(keys!.includes("20,20"), "the walked corridor's point is revealed too");
  assert.equal(keys!.includes("50,50"), false, "another seat's hero is not revealed");
  assert.deepEqual(revealed.players[1], uncharted.players[1], "other seats untouched");
});

test("revealForPlayer is a no-op for a seat that maintains no reveal", () => {
  const classic = visionFixture();
  assert.equal(revealForPlayer(classic, 0), classic, "a classic game's human seat writes nothing");

  const ai = makeState({
    players: [{ ...makePlayer(0, "ai", ["h0"], []), revealedTiles: [] as string[] }],
    heroes: [makeHero("h0", 0, 0, 0)],
  });
  assert.equal(revealForPlayer(ai, 0, [{ q: 20, r: 20 }]), ai, "an AI seat is never reveal-stamped");

  assert.equal(revealForPlayer(classic, 99), classic, "an unknown seat is a no-op");
});
