import { test } from "node:test";
import assert from "node:assert/strict";
import { recruitHero } from "@heroes/engine";
import type { HeroState } from "@heroes/contracts";
import { makeHero, makeSettlement, makeState } from "../charter/_helpers";

// recruitHero used to scan only the recruiting player's own heroIds when
// picking the next h{N} id, so with the default seed (player 0 = "h0",
// AI = "h1") a player's second recruit allocated "h1" and silently
// overwrote the AI's hero in the global heroes record. The scan now covers
// the whole record; these tests pin that the id never collides with ANOTHER
// player's hero.

function recruitState(): ReturnType<typeof makeState> {
  return makeState({
    // h0 parked away from s0's own tile (2,2) so recruitHero's
    // "Hex is occupied" check doesn't trip.
    heroes: [makeHero("h0", 0, 5, 5), makeHero("h1", 1, 18, 4)],
    settlements: [makeSettlement("s0", 0, 2, 2, { gold: 10 }), makeSettlement("s1", 1, 18, 4)],
  });
}

test("recruitHero allocates the lowest h{N} absent from the GLOBAL heroes record, not just the player's roster", () => {
  const state = recruitState();
  const aiHero = state.heroes.h1;

  const result = recruitHero(state, 0, "Scout", "s0", "bubbly");
  assert.equal(result.error, undefined);
  assert.equal(result.hero?.id, "h2", "h1 is taken by the AI hero, so h2 must be allocated");

  assert.equal(result.state.players[0].heroIds.join(","), "h0,h2");
  assert.deepEqual(result.state.heroes.h1, aiHero, "the AI's h1 must not be removed or overwritten");
  assert.equal(result.state.heroes.h2?.name, "Scout");
  assert.equal(result.state.settlements.s0.gold, 9);
  assert.equal(result.state.dirty, true);
});

test("recruitHero still skips ids the recruiting player owns itself", () => {
  const state = recruitState();
  const first = recruitHero(state, 0, "Scout", "s0", "bubbly");
  assert.equal(first.error, undefined);

  // The settlement hex is now occupied by the freshly recruited h2; move it
  // out of the way so the second recruit can land on s0's tile.
  const movedH2: HeroState = { ...first.state.heroes.h2, q: 6, r: 6 };
  const between = {
    ...first.state,
    heroes: { ...first.state.heroes, h2: movedH2 },
  };

  const second = recruitHero(between, 0, "Squire", "s0", "bubbly");
  assert.equal(second.error, undefined);
  assert.equal(second.hero?.id, "h3", "h2 now exists (player 0's own first recruit), so h3 follows");
  assert.deepEqual(second.state.heroes.h1, state.heroes.h1);
  assert.deepEqual(second.state.players[0].heroIds, ["h0", "h2", "h3"]);
});

test("recruitHero ignores non-h{id} hero ids when scanning for a free index", () => {
  const state = makeState({
    heroes: [makeHero("p0-hero", 0, 5, 5), makeHero("h1", 1, 18, 4)],
    settlements: [makeSettlement("s0", 0, 2, 2, { gold: 10 }), makeSettlement("s1", 1, 18, 4)],
  });

  const result = recruitHero(state, 0, "Scout", "s0", "bubbly");
  assert.equal(result.error, undefined);
  assert.equal(result.hero?.id, "h0", "h0 is free (the named starting hero doesn't collide)");
});
