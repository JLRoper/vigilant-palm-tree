// Regression tests for the logistics fix plan (folded into the test:unit glob).
// Run: npx tsx --test test/logistics-bugs/logistics.tradeNeeds.test.ts
//
// BUG L9: evaluateTradeNeeds' hero-destination pushes pass excludeId=null, so the best
//   food/gold source can be the settlement the hero STANDS ON — accepting such a
//   recommendation creates a same-tile route that can never load (the L1 stall) while
//   burning weekly maintenance.
// Evidence refs: packages/engine/src/economy/tradeNeeds.ts:234-254 (hero pushes, excludeId
//   null; the settlement loop above passes s.id), :102-129 (source pickers), docs/
//   resource-gathering.md §6.6 (recommender contract).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateTradeNeeds,
  heroTradeNeeds,
  type UnitType,
} from "@heroes/engine";
import type { Platoon } from "@heroes/contracts";
import { emptyWarehouse, makeHero, makePlayer, makeSettlement, makeState } from "../charter/_helpers";

const peasant: UnitType = {
  id: "peasant",
  name: "peasant",
  attack: 1,
  defence: 1,
  health: 1,
  speed: 1,
  description: "",
  advantageType: "infantry",
  specialty: "",
  specialtyPriority: 0,
  upkeepGold: 1,
  upkeepFood: 1,
};

function stack(unitTypeId: string, count: number): Platoon[] {
  return [{ entries: [{ unitTypeId, count }] }];
}

test("the recommender never emits a same-tile hero recommendation (source = the settlement the hero stands on)", () => {
  const hero = makeHero("h0", 0, 2, 2, {
    troops: 5,
    stacks: stack("peasant", 5),
    gold: 2,
    resources: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 3 },
  });
  const keep = makeSettlement("s0", 0, 2, 2, { gold: 1000, warehouse: emptyWarehouse({ food: 500 }) });
  // A second seat-0 settlement RICHER than the hero's own tile: after the
  // fix routes the hero's supply from here, proving the same-tile source
  // was EXCLUDED (not merely that the evaluator broke and returned nothing).
  const farKeep = makeSettlement("s2", 0, 20, 20, { gold: 800, warehouse: emptyWarehouse({ food: 600 }) });
  const state = makeState({
    players: [
      makePlayer(0, "player", ["h0"], ["s0", "s2"], { wagonsOwned: 4, wagonsUnassigned: 4 }),
      makePlayer(1, "ai", ["h1"], ["s1"]),
    ],
    heroes: [hero, makeHero("h1", 1, 18, 4)],
    settlements: [keep, farKeep, makeSettlement("s1", 1, 18, 4)],
    activePlayerId: 0,
  });

  const needs = heroTradeNeeds(state.heroes.h0, { peasant });
  assert.ok(
    needs.gold !== null || needs.food !== null,
    "fixture: the hero is genuinely short on gold/food (precondition)",
  );

  const recs = evaluateTradeNeeds(state, 0, { peasant });
  assert.ok(recs.length > 0, "precondition: the evaluator produced recommendations");

  const offender = recs.find((rec) => {
    if (rec.to.kind !== "hero" || rec.to.id !== "h0") return false;
    if (rec.from.kind !== "settlement") return false;
    const from = state.settlements[rec.from.id];
    return !!from && from.q === hero.q && from.r === hero.r;
  });
  assert.equal(
    offender,
    undefined,
    `intended: no recommendation whose source is the tile the hero stands on (a same-tile route can never load — the L1 stall — and burns weekly maintenance); actual: ${offender ? JSON.stringify({ from: offender.from, to: offender.to, payload: offender.payload }) : "none"}`,
  );
  assert.ok(
    recs.some(
      (rec) =>
        rec.to.kind === "hero" && rec.to.id === "h0" && rec.from.kind === "settlement" && rec.from.id === "s2",
    ),
    "the hero's supply is recommended from the legal source (s2) instead of being dropped wholesale",
  );
});
