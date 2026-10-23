import { test } from "node:test";
import assert from "node:assert/strict";
import { canTradeHeroes, tradeHeroes, tradePartnersFor } from "@heroes/engine";
import type { GameState, Platoon } from "@heroes/contracts";
import { makeHero, makeState } from "../charter/_helpers";

// Field trading between two heroes (docs/heroes.md "Trading in the field").
// The reducer is all-or-nothing: every test below asserts the SWAP applied
// whole, or that the state came back untouched (identity, not just "equal").

function platoons(entriesList: { unitTypeId: string; count: number }[][]): Platoon[] {
  const out = entriesList.map((entries) => ({ entries }));
  while (out.length < 8) out.push({ entries: [] });
  return out;
}

function tradeState(opts: {
  giver?: Parameters<typeof makeHero>[4];
  taker?: Parameters<typeof makeHero>[4];
  giverAt?: { q: number; r: number };
  takerAt?: { q: number; r: number };
  takerOwner?: number;
} = {}): GameState {
  const giverAt = opts.giverAt ?? { q: 5, r: 5 };
  const takerAt = opts.takerAt ?? { q: 6, r: 5 };
  return makeState({
    heroes: [
      makeHero("h0", 0, giverAt.q, giverAt.r, opts.giver ?? {}),
      makeHero("h1", opts.takerOwner ?? 0, takerAt.q, takerAt.r, opts.taker ?? {}),
    ],
    settlements: [],
  });
}

const swap = {
  heroId: "h0",
  partnerId: "h1",
};

test("tradeHeroes: swaps gold, resources and units between two adjacent heroes", () => {
  const state = tradeState({
    giver: { gold: 500, resources: { wood: 40, food: 10 }, stacks: platoons([[{ unitTypeId: "swordsman", count: 4 }]]) },
    taker: { gold: 100, resources: { iron: 7 }, stacks: platoons([[{ unitTypeId: "archer", count: 3 }]]) },
  });

  const result = tradeHeroes(state, {
    ...swap,
    give: { gold: 200, resources: { wood: 40 }, units: [{ unitTypeId: "swordsman", count: 4 }] },
    take: { gold: 100, resources: { iron: 7 }, units: [{ unitTypeId: "archer", count: 3 }] },
  });

  assert.equal(result.ok, true);
  assert.equal(result.reason, "");
  assert.equal(result.state.dirty, true);
  const giver = result.state.heroes.h0;
  const taker = result.state.heroes.h1;
  assert.equal(giver.gold, 500 - 200 + 100);
  assert.equal(taker.gold, 100 - 100 + 200);
  assert.deepEqual(giver.resources, { wood: 0, stone: 0, iron: 7, arcane: 0, food: 10 });
  assert.deepEqual(taker.resources, { wood: 40, stone: 0, iron: 0, arcane: 0, food: 0 });
  assert.deepEqual(giver.stacks[0].entries, [{ unitTypeId: "archer", count: 3 }]);
  assert.deepEqual(taker.stacks[0].entries, [{ unitTypeId: "swordsman", count: 4 }]);
  // The input state is never mutated in place.
  assert.equal(state.heroes.h0.gold, 500);
  assert.deepEqual(state.heroes.h0.stacks[0].entries, [{ unitTypeId: "swordsman", count: 4 }]);
});

test("tradeHeroes: one-sided gifts work (an empty take), and nothing moves on the refusal path", () => {
  const state = tradeState({ giver: { gold: 300 }, taker: { gold: 0 } });
  const gift = tradeHeroes(state, { ...swap, give: { gold: 300 }, take: {} });
  assert.equal(gift.ok, true);
  assert.equal(gift.state.heroes.h0.gold, 0);
  assert.equal(gift.state.heroes.h1.gold, 300);
});

test("tradeHeroes: both offers empty is nothing_offered", () => {
  const state = tradeState();
  const result = tradeHeroes(state, { ...swap, give: {}, take: {} });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "nothing_offered");
  assert.equal(result.state, state);
});

test("tradeHeroes: rejects heroes that are not adjacent, and never touches the state", () => {
  const state = tradeState({ giver: { gold: 100 }, takerAt: { q: 9, r: 5 } });
  const result = tradeHeroes(state, { ...swap, give: { gold: 100 }, take: {} });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "not_adjacent");
  assert.equal(result.state, state);
});

test("tradeHeroes: an adjacent hero of another seat is not_same_owner", () => {
  const state = tradeState({ takerOwner: 1 });
  const result = tradeHeroes(state, { ...swap, give: { gold: 1 }, take: {} });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "not_same_owner");
});

test("tradeHeroes: a hero trading with itself is same_hero, and a missing partner is no_partner_hero", () => {
  const state = tradeState();
  assert.equal(tradeHeroes(state, { ...swap, partnerId: "h0", give: { gold: 1 }, take: {} }).reason, "same_hero");
  assert.equal(tradeHeroes(state, { ...swap, partnerId: "nope", give: { gold: 1 }, take: {} }).reason, "no_partner_hero");
  assert.equal(tradeHeroes(state, { ...swap, heroId: "nope", give: { gold: 1 }, take: {} }).reason, "no_hero");
});

test("tradeHeroes: the parser rejects negative and fractional amounts as invalid_amount", () => {
  const state = tradeState({ giver: { gold: 10 }, taker: { gold: 10 } });
  assert.equal(tradeHeroes(state, { ...swap, give: { gold: -5 }, take: {} }).reason, "invalid_amount");
  assert.equal(tradeHeroes(state, { ...swap, give: { gold: 1.5 }, take: {} }).reason, "invalid_amount");
  assert.equal(
    tradeHeroes(state, { ...swap, give: { units: [{ unitTypeId: "swordsman", count: -1 }] }, take: {} }).reason,
    "invalid_amount",
  );
});

test("tradeHeroes: each side must hold what it gives, naming the side that cannot pay", () => {
  const state = tradeState({ giver: { gold: 50 }, taker: { gold: 50, resources: { wood: 1 } } });
  const giverShort = tradeHeroes(state, { ...swap, give: { gold: 100 }, take: {} });
  assert.equal(giverShort.reason, "not_enough_gold");
  const partnerShort = tradeHeroes(state, { ...swap, give: {}, take: { resources: { wood: 5 } } });
  assert.equal(partnerShort.reason, "partner_not_enough_resources");
  const noUnits = tradeHeroes(state, { ...swap, give: {}, take: { units: [{ unitTypeId: "archer", count: 1 }] } });
  assert.equal(noUnits.reason, "partner_not_enough_units");
  assert.equal(giverShort.state, state);
});

test("tradeHeroes: a receiver with no cargo headroom refuses the trade", () => {
  // Two cargo wagons = 100 per resource: the taker is already full, so the
  // 10 wood the giver offers has nowhere to go.
  const state = tradeState({
    giver: { resources: { wood: 10 }, wagons: 2 },
    taker: { resources: { wood: 100 }, wagons: 2 },
  });
  const result = tradeHeroes(state, { ...swap, give: { resources: { wood: 10 } }, take: {} });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "partner_not_enough_cargo_space");
});

test("tradeHeroes: a receiver with no purse room (treasury carts) refuses the trade", () => {
  const state = tradeState({
    giver: { gold: 100, treasuryWagons: 1 },
    taker: { gold: 500, treasuryWagons: 1 },
  });
  const result = tradeHeroes(state, { ...swap, give: { gold: 100 }, take: {} });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "partner_not_enough_gold_space");
});

test("tradeHeroes: a full army on the receiving side refuses the trade", () => {
  const full: Platoon[] = Array.from({ length: 8 }, (_, i) => ({
    entries: [
      { unitTypeId: `u${i}a`, count: 1 },
      { unitTypeId: `u${i}b`, count: 1 },
      { unitTypeId: `u${i}c`, count: 1 },
    ],
  }));
  const state = tradeState({
    giver: { stacks: platoons([[{ unitTypeId: "swordsman", count: 2 }]]) },
    taker: { stacks: full },
  });
  const result = tradeHeroes(state, {
    ...swap,
    give: { units: [{ unitTypeId: "swordsman", count: 2 }] },
    take: {},
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "partner_not_enough_unit_space");
});

test("tradeHeroes: a same-type swap both ways is not a false platoon_full", () => {
  // The taker's army is full of distinct types and already carries the
  // swordsmen the giver is sending -- removing the taker's own departing
  // swordsmen first makes room for the incoming ones.
  const takerStacks: Platoon[] = [
    { entries: [{ unitTypeId: "swordsman", count: 3 }, { unitTypeId: "archer", count: 1 }, { unitTypeId: "mage", count: 1 }] },
    ...Array.from({ length: 7 }, (_, i) => ({
      entries: [
        { unitTypeId: `u${i}a`, count: 1 },
        { unitTypeId: `u${i}b`, count: 1 },
        { unitTypeId: `u${i}c`, count: 1 },
      ],
    })),
  ];
  const state = tradeState({
    giver: { stacks: platoons([[{ unitTypeId: "swordsman", count: 5 }]]) },
    taker: { stacks: takerStacks },
  });
  const result = tradeHeroes(state, {
    ...swap,
    give: { units: [{ unitTypeId: "swordsman", count: 5 }] },
    take: { units: [{ unitTypeId: "swordsman", count: 3 }] },
  });
  assert.equal(result.ok, true, result.reason);
  const total = (hero: { stacks?: Platoon[] }): number =>
    (hero.stacks ?? []).flatMap((p) => p.entries).filter((e) => e.unitTypeId === "swordsman").reduce((s, e) => s + e.count, 0);
  assert.equal(total(result.state.heroes.h0), 3);
  assert.equal(total(result.state.heroes.h1), 5);
});

test("tradeHeroes: duplicate unit entries of one type are summed", () => {
  const state = tradeState({
    giver: { stacks: platoons([[{ unitTypeId: "swordsman", count: 2 }, { unitTypeId: "pikeman", count: 4 }]]) },
    taker: {},
  });
  const result = tradeHeroes(state, {
    ...swap,
    give: { units: [{ unitTypeId: "pikeman", count: 2 }, { unitTypeId: "pikeman", count: 2 }] },
    take: {},
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.state.heroes.h1.stacks[0].entries, [{ unitTypeId: "pikeman", count: 4 }]);
  assert.deepEqual(result.state.heroes.h0.stacks[0].entries, [{ unitTypeId: "swordsman", count: 2 }]);
});

test("canTradeHeroes/tradePartnersFor: only adjacent same-seat heroes are partners", () => {
  const state = makeState({
    heroes: [
      makeHero("h0", 0, 5, 5),
      makeHero("h1", 0, 6, 5),
      makeHero("h2", 0, 9, 9),
      makeHero("h3", 1, 4, 5),
      makeHero("h4", 0, 5, 5),
    ],
    settlements: [],
  });
  assert.equal(canTradeHeroes(state.heroes.h0, state.heroes.h1), true);
  assert.equal(canTradeHeroes(state.heroes.h0, state.heroes.h2), false);
  assert.equal(canTradeHeroes(state.heroes.h0, state.heroes.h3), false);
  assert.equal(canTradeHeroes(state.heroes.h0, state.heroes.h4), false);
  assert.equal(canTradeHeroes(state.heroes.h0, undefined), false);
  assert.deepEqual(
    tradePartnersFor(state, "h0").map((h) => h.id),
    ["h1"],
  );
});
