import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TRADE_GOLD_KEY,
  adjustStaged,
  compactOffer,
  emptyStaging,
  holdingFor,
  holdingsOf,
  requestFromStaging,
  resourceKey,
  sideIsEmpty,
  stageAll,
  stageAmount,
  stagedAmount,
  stagedEntries,
  stagingIsEmpty,
  tradeCaps,
  tradeFailureText,
  tradePartnerOf,
  tradeStep,
  unstage,
  unitKey,
} from "../../../src/screens/heroes/heroTradeModel";
import { makeHero, makeState } from "../../charter/_helpers";
import type { Platoon } from "@heroes/contracts";

function platoons(entriesList: { unitTypeId: string; count: number }[][]): Platoon[] {
  const out = entriesList.map((entries) => ({ entries }));
  while (out.length < 8) out.push({ entries: [] });
  return out;
}

const hero = makeHero("h0", 0, 5, 5, {
  gold: 1000,
  treasuryWagons: 4,
  wagons: 3,
  resources: { wood: 120, stone: 0, iron: 5, arcane: 0, food: 30 },
  stacks: platoons([
    [{ unitTypeId: "archer", count: 3 }, { unitTypeId: "swordsman", count: 1 }],
    [{ unitTypeId: "archer", count: 2 }],
  ]),
});

test("holdingsOf: purse, then the five resources in order, then aggregated unit types in stack order", () => {
  const holdings = holdingsOf(hero);
  assert.deepEqual(
    holdings.map((h) => h.key),
    [TRADE_GOLD_KEY, "res:wood", "res:stone", "res:iron", "res:arcane", "res:food", "unit:archer", "unit:swordsman"],
  );
  assert.equal(holdings[0].amount, 1000);
  assert.equal(holdingFor(hero, "res:wood")?.amount, 120);
  // Two platoons of archers aggregate into one row (3 + 2).
  assert.equal(holdingFor(hero, unitKey("archer"))?.amount, 5);
  assert.equal(holdingFor(hero, unitKey("swordsman"))?.amount, 1);
  assert.deepEqual(holdingsOf(undefined), []);
});

test("stageAmount/stageAll/stagedAmount/unstage: staged amounts are clamped to what the hero holds", () => {
  let staging = emptyStaging();
  assert.equal(stagingIsEmpty(staging), true);
  assert.equal(stagedAmount(staging, "give", TRADE_GOLD_KEY), 0);

  staging = stageAll(staging, "give", TRADE_GOLD_KEY, 1000);
  assert.equal(stagedAmount(staging, "give", TRADE_GOLD_KEY), 1000);
  assert.equal(stagingIsEmpty(staging), false);

  // Over-staging clamps to the available amount; staging 0 unstages.
  staging = stageAmount(staging, "give", TRADE_GOLD_KEY, 99999, 1000);
  assert.equal(stagedAmount(staging, "give", TRADE_GOLD_KEY), 1000);
  staging = stageAmount(staging, "give", TRADE_GOLD_KEY, 0, 1000);
  assert.equal(stagedAmount(staging, "give", TRADE_GOLD_KEY), 0);
  assert.equal(stagingIsEmpty(staging), true);

  const staged = stageAll(stageAll(emptyStaging(), "take", resourceKey("iron"), 5), "take", unitKey("archer"), 5);
  assert.equal(stagedAmount(staged, "take", resourceKey("iron")), 5);
  assert.equal(stagedAmount(staged, "take", unitKey("archer")), 5);
  // The other side is untouched, and unstaging is per key.
  assert.equal(stagedAmount(staged, "give", resourceKey("iron")), 0);
  assert.equal(stagedAmount(unstage(staged, "take", resourceKey("iron")), "take", resourceKey("iron")), 0);
});

test("tradeStep: a tenth of the holding (floor 1) for gold and resources, one for units", () => {
  assert.equal(tradeStep(1000, "gold"), 100);
  assert.equal(tradeStep(9, "resource"), 1);
  assert.equal(tradeStep(0, "gold"), 1);
  assert.equal(tradeStep(120, "unit"), 1);
});

test("adjustStaged: steps by tradeStep and clamps at both ends", () => {
  const holdings = holdingsOf(hero);
  const wood = holdingFor(hero, resourceKey("wood"));
  let staging = emptyStaging();
  staging = adjustStaged(staging, "give", resourceKey("wood"), 1, wood);
  assert.equal(stagedAmount(staging, "give", resourceKey("wood")), tradeStep(120, "resource"));
  // Down from the step lands back on zero rather than going negative.
  staging = adjustStaged(staging, "give", resourceKey("wood"), -1, wood);
  assert.equal(stagedAmount(staging, "give", resourceKey("wood")), 0);
  staging = adjustStaged(staging, "give", resourceKey("wood"), -1, wood);
  assert.equal(stagedAmount(staging, "give", resourceKey("wood")), 0);
  // A missing holding cannot be stepped.
  assert.equal(
    stagedAmount(adjustStaged(staging, "give", resourceKey("stone"), 1, undefined), "give", resourceKey("stone")),
    0,
  );
  const iron = holdings.find((h) => h.key === resourceKey("iron"));
  assert.equal(stagedAmount(adjustStaged(staging, "give", resourceKey("iron"), 1, iron), "give", resourceKey("iron")), 1);
});

test("stagedEntries: only staged keys render, carrying the staged amount", () => {
  const holdings = holdingsOf(hero);
  const staging = stageAll(emptyStaging(), "give", unitKey("archer"), 5);
  const rows = stagedEntries(staging, "give", holdings);
  assert.deepEqual(rows.map((r) => [r.key, r.amount]), [[unitKey("archer"), 5]]);
  assert.deepEqual(stagedEntries(staging, "take", holdings), []);
  // A key the hero no longer holds (spent under us) is dropped, not rendered.
  assert.deepEqual(stagedEntries(staging, "give", holdingsOf(undefined)), []);
});

test("requestFromStaging/compactOffer: empty keys and zero amounts are stripped", () => {
  const staging = stageAmount(
    stageAmount(emptyStaging(), "give", "res:wood", 10, 120),
    "take",
    TRADE_GOLD_KEY,
    250,
    250,
  );
  const request = requestFromStaging(staging, "h0", "h1");
  assert.equal(request.heroId, "h0");
  assert.equal(request.partnerId, "h1");
  assert.deepEqual(request.give, { resources: { wood: 10 } });
  assert.deepEqual(request.take, { gold: 250 });
  assert.deepEqual(compactOffer({}), {});
  assert.deepEqual(compactOffer({ gold: 0, resources: { wood: 0 }, units: [{ unitTypeId: "a", count: 0 }] }), {});
  assert.equal(sideIsEmpty({ give: request.give, take: {} }, "take"), true);
  assert.equal(sideIsEmpty({ give: request.give, take: {} }, "give"), false);
});

test("tradeFailureText: names the hero the reason belongs to", () => {
  const names = { hero: "Anna", partner: "Boris" };
  assert.equal(tradeFailureText("not_adjacent", names), "Heroes must be on adjacent hexes to trade.");
  assert.equal(tradeFailureText("not_enough_gold", names), "Anna does not have that much gold.");
  assert.equal(tradeFailureText("partner_not_enough_gold", names), "Boris does not have that much gold.");
  assert.equal(
    tradeFailureText("partner_not_enough_unit_space", names),
    "Boris has no room in the army (every slot is full).",
  );
  assert.equal(tradeFailureText("weird_new_reason", names), "Trade refused: weird_new_reason.");
});

test("tradeCaps: the purse and cargo caps come from the hero's carts and wagons", () => {
  const caps = tradeCaps(hero);
  assert.equal(caps.gold, 4 * 500);
  assert.equal(caps.resources.wood, 3 * 50);
  assert.equal(tradeCaps(undefined).gold, 0);
});

test("tradePartnerOf: the first adjacent same-seat hero, null when there is none", () => {
  const state = makeState({
    heroes: [
      makeHero("h0", 0, 5, 5),
      makeHero("h2", 1, 6, 5),
      makeHero("h1", 0, 5, 6),
    ],
    settlements: [],
  });
  assert.equal(tradePartnerOf(state, "h0")?.id, "h1");
  assert.equal(tradePartnerOf(state, "h1")?.id, "h0");
  assert.equal(tradePartnerOf(state, "nope"), null);
  assert.equal(tradePartnerOf(undefined, "h0"), null);
  assert.equal(tradePartnerOf(state, null), null);
});
