import { test } from "node:test";
import assert from "node:assert/strict";
import { platoonTroopTotal, RECRUIT_STARTER_UNIT_IDS, recruitHero, starterRecruitPlatoons } from "@heroes/engine";
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
    settlements: [makeSettlement("s0", 0, 2, 2, { gold: 60 }), makeSettlement("s1", 1, 18, 4)],
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
  assert.equal(result.state.settlements.s0.gold, 10);
  assert.equal(result.state.dirty, true);
});

test("recruitHero still skips ids the recruiting player owns itself", () => {
  const state = recruitState();
  const first = recruitHero(state, 0, "Scout", "s0", "bubbly");
  assert.equal(first.error, undefined);

  // The settlement hex is now occupied by the freshly recruited h2; move it
  // out of the way so the second recruit can land on s0's tile. The first
  // recruit spent 50g of the 60g fixture, so refill the treasury for the
  // second 50g recruit.
  const movedH2: HeroState = { ...first.state.heroes.h2, q: 6, r: 6 };
  const between = {
    ...first.state,
    heroes: { ...first.state.heroes, h2: movedH2 },
    settlements: { ...first.state.settlements, s0: { ...first.state.settlements.s0, gold: 60 } },
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
    settlements: [makeSettlement("s0", 0, 2, 2, { gold: 60 }), makeSettlement("s1", 1, 18, 4)],
  });

  const result = recruitHero(state, 0, "Scout", "s0", "bubbly");
  assert.equal(result.error, undefined);
  assert.equal(result.hero?.id, "h0", "h0 is free (the named starting hero doesn't collide)");
});

test("recruitHero draws its starting wagons and carts from the unassigned pools, clamped to what is there", () => {
  // Phase 1: a recruit used to get 5 free wagons because neither the hero
  // field nor the pool was touched (assignWagons(+1) on it then SHRANK its
  // purse cap). The complement now comes out of the pools.
  const state = recruitState();
  state.players = state.players.map((p) =>
    p.id === 0
      ? { ...p, wagonsOwned: 7, wagonsUnassigned: 3, treasuryWagonsOwned: 9, treasuryWagonsUnassigned: 7 }
      : p,
  );

  const result = recruitHero(state, 0, "Scout", "s0", "bubbly");
  assert.equal(result.error, undefined);
  assert.equal(result.hero?.wagons, 3, "the 5-wagon complement clamps to the pool's actual 3");
  assert.equal(result.hero?.treasuryWagons, 5, "the 5-cart complement fits the pool's 7");
  const player = result.state.players[0];
  assert.equal(player.wagonsUnassigned, 0, "cargo pool debited by what the hero took");
  assert.equal(player.treasuryWagonsUnassigned, 2, "treasury pool debited by what the hero took");
  assert.equal(player.wagonsOwned, 7, "owned counters never move on a recruit");
  assert.equal(player.treasuryWagonsOwned, 9);
});

test("recruitHero from empty pools yields explicit 0s, never free out-of-thin-air wagons", () => {
  // makePlayer's cargo pool defaults to 0/0 and the treasury pool to 5/0 --
  // level both to empty so the clamp's floor is exercised per slot.
  const state = recruitState();
  state.players = state.players.map((p) =>
    p.id === 0
      ? { ...p, wagonsOwned: 0, wagonsUnassigned: 0, treasuryWagonsOwned: 0, treasuryWagonsUnassigned: 0 }
      : p,
  );

  const result = recruitHero(state, 0, "Scout", "s0", "bubbly");
  assert.equal(result.error, undefined);
  assert.equal(result.hero?.wagons, 0, "no pool, no wagons -- a real 0-cap cargo slot to buy and assign for");
  assert.equal(result.hero?.treasuryWagons, 0, "no pool, no carts -- a real 0g purse cap, not a free 2,500g one");
  const player = result.state.players[0];
  assert.equal(player.wagonsUnassigned, 0, "the pool invariant holds: unassigned never goes negative");
  assert.equal(player.treasuryWagonsUnassigned, 0);
});

test("recruitHero rejects a settlement that cannot pay the 50g recruit cost", () => {
  const state = makeState({
    heroes: [makeHero("h0", 0, 5, 5)],
    settlements: [makeSettlement("s0", 0, 2, 2, { gold: 49 }), makeSettlement("s1", 1, 18, 4)],
  });

  const result = recruitHero(state, 0, "Scout", "s0", "bubbly");
  assert.equal(result.error, "Not enough gold");
  assert.equal(result.hero, undefined, "a rejected recruit must not produce a hero");
  assert.deepEqual(result.state.players[0].heroIds, ["h0"], "a rejected recruit must not join the roster");
  assert.deepEqual(Object.keys(result.state.heroes), ["h0"], "no hero may enter the global record");
  assert.equal(result.state.settlements.s0.gold, 49, "a rejected recruit must not touch the treasury");
});

test("starterRecruitPlatoons always yields 2-3 platoons of 2-3 distinct first-tier troops, padded to 8 slots", () => {
  // The pool constant itself is the user-facing spec: the first three tiers.
  assert.deepEqual([...RECRUIT_STARTER_UNIT_IDS], ["peasant", "pikeman", "archer"]);
  const expectedIds = new Set<string>(["peasant", "pikeman", "archer"]);
  for (let seed = 0; seed < 64; seed++) {
    const stacks = starterRecruitPlatoons(seed);
    assert.equal(stacks.length, 8, `seed ${seed}: padded to the 8 army slots`);
    const filled = stacks.filter((p) => p.entries.length > 0);
    assert.ok(filled.length >= 2 && filled.length <= 3, `seed ${seed}: platoon count ${filled.length}`);
    const ids: string[] = [];
    for (const platoon of filled) {
      assert.equal(platoon.entries.length, 1, `seed ${seed}: exactly one entry per platoon`);
      const entry = platoon.entries[0];
      assert.ok(entry.count >= 2 && entry.count <= 3, `seed ${seed}: troops ${entry.count}`);
      assert.ok(expectedIds.has(entry.unitTypeId), `seed ${seed}: unit ${entry.unitTypeId}`);
      ids.push(entry.unitTypeId);
    }
    assert.equal(new Set(ids).size, ids.length, `seed ${seed}: unit ids must be distinct`);
  }
});

test("recruitHero end-to-end: the hero arrives with the seeded starter kit and a denormalized troops total", () => {
  const state = recruitState();
  const result = recruitHero(state, 0, "Scout", "s0", "bubbly");
  assert.equal(result.error, undefined);
  assert.ok(result.hero);
  assert.equal(result.hero.stacks.length, 8);
  const stacks = result.state.heroes[result.hero.id].stacks;
  assert.deepEqual(stacks, result.hero.stacks);
  const filled = stacks.filter((p) => p.entries.length > 0);
  assert.ok(filled.length >= 2 && filled.length <= 3, `platoon count ${filled.length}`);
  const total = platoonTroopTotal(stacks);
  assert.ok(total >= 4 && total <= 9, `starter army total ${total}`);
  assert.equal(result.hero.troops, total, "troops is the denormalized platoon total");
});

test("starterRecruitPlatoons is deterministic, and recruitHero is a pure function of the base state", () => {
  for (const seed of [0, 1, 7, 12345, 987654321]) {
    assert.deepEqual(starterRecruitPlatoons(seed), starterRecruitPlatoons(seed));
  }
  const state = recruitState();
  const first = recruitHero(state, 0, "Scout", "s0", "bubbly");
  const second = recruitHero(state, 0, "Scout", "s0", "bubbly");
  assert.equal(first.error, undefined);
  assert.equal(second.error, undefined);
  assert.equal(first.hero?.id, second.hero?.id, "the id allocation is deterministic too");
  assert.deepEqual(first.hero?.stacks, second.hero?.stacks, "same base state -> same starter army");
  assert.deepEqual(first.state.settlements.s0, second.state.settlements.s0);
});

test("starterRecruitPlatoons varies both platoon counts and troop counts across seeds", () => {
  const platoonCounts = new Set<number>();
  const troopCounts = new Set<number>();
  for (let seed = 0; seed < 128; seed++) {
    const stacks = starterRecruitPlatoons(seed);
    platoonCounts.add(stacks.filter((p) => p.entries.length > 0).length);
    for (const platoon of stacks) for (const entry of platoon.entries) troopCounts.add(entry.count);
  }
  assert.ok(platoonCounts.size >= 2, `distinct platoon counts: ${[...platoonCounts].join(",")}`);
  assert.ok(troopCounts.size >= 2, `distinct troop counts: ${[...troopCounts].join(",")}`);
});

test("starterRecruitPlatoons(12345) regression pin", () => {
  assert.deepEqual(starterRecruitPlatoons(12345), [
    { entries: [{ unitTypeId: "peasant", count: 2 }] },
    { entries: [{ unitTypeId: "archer", count: 3 }] },
    { entries: [{ unitTypeId: "pikeman", count: 2 }] },
    { entries: [] },
    { entries: [] },
    { entries: [] },
    { entries: [] },
    { entries: [] },
  ]);
});
