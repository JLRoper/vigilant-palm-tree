// Regression tests for the logistics fix plan (folded into the test:unit glob).
// Run: npx tsx --test test/logistics-bugs/logistics.wagonPools.test.ts
//
// BUG L6: AssignWagons(slot "treasury") on a pre-migration-023 hero (heroes.treasury_wagons
//   absent/NULL) materializes the field from `hero.treasuryWagons ?? 0`:
//   (a) a +1 materializes 1 cart and SHRINKS the hero's purse cap 2500g -> 500g (the soft
//       default 5-cart cap read is bypassed the moment the field is materialized);
//   (b) a -1 is rejected not_enough_wagons even though the absent field soft-defaults to
//       5 carts (capacity.ts heroTreasuryWagons) — the hero effectively owns 5 carts.
// Evidence refs: packages/engine/src/logistics.ts:125-135 (current = hero.treasuryWagons ?? 0,
// materialization), packages/engine/src/settlement/capacity.ts:19-40 (DEFAULT_TREASURY_WAGONS 5,
// heroGoldCap = carts x 500), server/migrations/023_treasury_wagons.sql (no DEFAULT/backfill),
// docs/resource-gathering.md §6.7 purse-cap rules.
//
// FIXED 2026-10-04 (plan §5.6): assignWagons seeds the slot from
// DEFAULT_TREASURY_WAGONS (the engine belt) and migration
// 028_treasury_wagons_backfill.sql rewrites NULL rows to 5, so the
// evidence pins below assert the fixed behavior (seed-from-5) instead of
// the old buggy shape.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assignWagons,
  DEFAULT_TREASURY_WAGONS,
  heroGoldCap,
  type GameState,
} from "@heroes/engine";
import { makeHero, makePlayer, makeSettlement, makeState } from "../charter/_helpers";

const SOFT_DEFAULT_CAP = DEFAULT_TREASURY_WAGONS * 500;

// A hero whose treasuryWagons key is ABSENT (the pre-023 persisted shape: NULL column
// means the hydrate never wrote the field), not explicit-zero and not explicit-five.
function absentTreasuryWagonsHero() {
  const { treasuryWagons: _pre023Absent, ...hero } = makeHero("h0", 0, 2, 2);
  return hero;
}

function pre023State(): GameState {
  return makeState({
    players: [
      makePlayer(0, "player", ["h0"], ["s0"], { treasuryWagonsUnassigned: 2 }),
      makePlayer(1, "ai", ["h1"], ["s1"]),
    ],
    heroes: [absentTreasuryWagonsHero(), makeHero("h1", 1, 18, 4)],
    settlements: [makeSettlement("s0", 0, 2, 2), makeSettlement("s1", 1, 18, 4)],
    activePlayerId: 0,
  });
}

test("AssignWagons(+1, treasury) on a pre-023 hero seeds from the 5-cart default (6 carts, no cap shrink)", () => {
  const state = pre023State();
  assert.equal(
    "treasuryWagons" in state.heroes.h0,
    false,
    "fixture: the field is absent (the NULL column shape), not zero and not five",
  );
  assert.equal(
    heroGoldCap(state.heroes.h0),
    SOFT_DEFAULT_CAP,
    "before the assign, the soft default reads 5 carts = 2500g purse cap",
  );

  const result = assignWagons(state, 0, "h0", 1, "treasury");
  assert.equal(result.ok, true, result.reason);
  const after = result.state.heroes.h0;
  assert.equal(
    after.treasuryWagons,
    DEFAULT_TREASURY_WAGONS + 1,
    "fixed: the assign seeds from the 5-cart soft default (5 + 1 = 6), never from 0",
  );
  assert.ok(
    heroGoldCap(after) >= SOFT_DEFAULT_CAP,
    `intended: the purse cap must not shrink below the soft default (${SOFT_DEFAULT_CAP}g) — seed the assign from the 5-cart default (5+delta semantics) or backfill before mutating; actual: ${heroGoldCap(after)}g (the 1 materialized cart caps the hero at 500g)`,
  );
});

test("AssignWagons(-1, treasury) on a pre-023 hero succeeds against the soft default 5", () => {
  const state = pre023State();
  const back = assignWagons(state, 0, "h0", -1, "treasury");
  assert.equal(
    back.ok,
    true,
    `intended: -1 succeeds — the absent field soft-defaults to 5 carts (heroTreasuryWagons), so the hero effectively owns 5 and an explicit lower count is a legal landing state; actual reason: ${back.reason}`,
  );
  if (back.ok) {
    assert.equal(
      back.state.heroes.h0.treasuryWagons,
      4,
      "the -1 lands on an explicit 4 carts (no longer soft-defaulted), purse cap 2000g",
    );
  }
});
