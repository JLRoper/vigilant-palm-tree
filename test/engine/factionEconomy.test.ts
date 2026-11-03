// The faction economy modifier: the ONE optional field on `FactionDef`
// (`economy`) and the ONE seam that reads it (`economy/factionEconomy.ts`),
// threaded through the income and yield path.
//
// This file is written to be RED before the field exists and green after: it
// imports nothing the engine did not already export, so on main it loads, runs,
// and fails on its assertions (`FACTION_REGISTRY.ironmark.economy` is
// undefined, and a faction-tagged seat changes no number anywhere).
//
// The fixture is the architect's measuring stick -- one producer per resource
// axis at a fixed level -- so the four factions can be compared at a build-out
// no faction can change.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { FactionEconomyModifier, FactionId, GameState, SettlementState } from "@heroes/contracts";
import {
  FACTION_REGISTRY,
  applyEndOfTurnDetailed,
  playerIncome,
  produceSettlementResources,
  producerTurnOutput,
  settlementProductionRates,
} from "@heroes/engine";
import { makePlayer, makeSettlement, makeState } from "../charter/_helpers";

const SEED = 20261103;
const LEVEL = 3;

type Kind = SettlementState["buildings"][number]["kind"];
type Axis = "gold" | "iron" | "stone" | "wood" | "arcane" | "food";
type Seat = { factionId?: FactionId } | undefined;

const AXES: readonly Axis[] = ["gold", "iron", "stone", "wood", "arcane", "food"];
const FACTIONS: readonly FactionId[] = ["human", "ironmark", "verdant", "ashen"];

/** One producer per axis, so every modifier has something to act on. */
const BUILD_OUT: readonly Kind[] = ["ironMine", "stoneMine", "woodcutterHut", "arcaneFont", "farmField", "market"];

function building(kind: Kind, gx: number, gy: number, level = LEVEL): SettlementState["buildings"][number] {
  return { gx, gy, kind, level, style: "classic" };
}

function fixture(ownerId: number | null, population = 0): SettlementState {
  return {
    id: "s0",
    name: "s0",
    ownerId,
    q: 3,
    r: 3,
    level: 1,
    population,
    goldTax: 20,
    resourceRates: {},
    foundedOnResource: null,
    gold: 0,
    warehouse: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 },
    citySpots: [],
    cityMines: [],
    morale: 100,
    garrisonUnpaidSinceDay: null,
    garrisonUnpaidTroops: 0,
    garrisonUnpaidGold: 0,
    autoTrade: false,
    castleVariant: 0,
    buildings: BUILD_OUT.map((kind, i) => building(kind, i, 0)),
  };
}

/** One turn's payment for the fixture: the treasury delta and the per-resource store deltas. */
function paid(seat: Seat): Record<Axis, number> {
  const before = fixture(0);
  const after = produceSettlementResources({ s0: before }, SEED, undefined, seat ? [seat] : undefined).s0;
  return {
    gold: after.gold - before.gold,
    iron: (after.warehouse.iron ?? 0) - (before.warehouse.iron ?? 0),
    stone: (after.warehouse.stone ?? 0) - (before.warehouse.stone ?? 0),
    wood: (after.warehouse.wood ?? 0) - (before.warehouse.wood ?? 0),
    arcane: (after.warehouse.arcane ?? 0) - (before.warehouse.arcane ?? 0),
    food: (after.warehouse.food ?? 0) - (before.warehouse.food ?? 0),
  };
}

/** The per-faction table this file measures everything else against. */
function table(): Record<string, Record<Axis, number>> {
  const out: Record<string, Record<Axis, number>> = { "(no seat)": paid(undefined) };
  for (const factionId of FACTIONS) out[factionId] = paid({ factionId });
  return out;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

test("FACTION_REGISTRY carries one optional economy field, and only the three rosters set it", () => {
  // The Crownlands are the control: no key at all, so "absent = neutral" is the
  // shape every legacy save and every faction-less fixture already has.
  assert.equal(FACTION_REGISTRY.human.economy, undefined, "human stays the neutral baseline");
  assert.equal(FACTION_REGISTRY.neutral.economy, undefined, "neutral wild creatures run no economy");

  assert.deepEqual(FACTION_REGISTRY.ironmark.economy, { ironPct: 25, stonePct: 15, goldPct: 10, foodPct: -10 });
  assert.deepEqual(FACTION_REGISTRY.verdant.economy, { foodPct: 25, woodPct: 15, goldPct: -10 });
  assert.deepEqual(FACTION_REGISTRY.ashen.economy, { goldPct: 10, arcanePct: 25, foodPct: -15 });

  // The field is a percentage table and nothing else: a modifier can only ever
  // scale an output, never a cost, a build time, an upkeep or a combat stat.
  const allowed = new Set(["goldPct", "foodPct", "woodPct", "stonePct", "ironPct", "arcanePct"]);
  for (const factionId of FACTIONS) {
    const economy: FactionEconomyModifier = FACTION_REGISTRY[factionId].economy ?? {};
    for (const key of Object.keys(economy)) {
      assert.ok(allowed.has(key), `${factionId}'s economy key "${key}" must be an output percentage`);
    }
  }

  // Re-measured for this card: the definition still has exactly the six
  // presentation fields the architect found, plus this one optional seventh.
  assert.deepEqual(
    Object.keys(FACTION_REGISTRY.human).sort(),
    ["description", "id", "label", "motto", "palette", "roster"],
    "FactionDef carries no other gameplay field",
  );
});

test("an Ironmark seat pays its mine's iron at exactly 1.25x, at the same build-out", () => {
  const s = fixture(0);
  const mine = s.buildings[0]!;
  const base = producerTurnOutput(mine, s, SEED);
  const scaled = producerTurnOutput(mine, s, SEED, { factionId: "ironmark" });
  assert.ok(base && scaled, "the iron mine is a producer");
  assert.equal(scaled.resource, "iron");
  assert.ok(base.amount > 0);

  // The seam scales the BASE the building pays, before the cell multiplier and
  // the staffing effort, so the existing single rounding step is untouched.
  assert.equal(scaled.amount, round2(base.basePerTurn * 1.25 * base.multiplier * base.effort));
  assert.ok(scaled.amount > base.amount, "an Ironmark mine out-yields a Crownlands one");

  const totals = table();
  assert.ok(totals.ironmark!.iron! > totals.human!.iron!, "the iron delta a turn pays is larger for Ironmark");
  assert.ok(totals.ironmark!.stone! > totals.human!.stone!, "stone rides the same +15%");
  assert.ok(totals.ironmark!.gold! > totals.human!.gold!, "the hold's markets and mines pay +10%");
  assert.ok(totals.ironmark!.food! <= totals.human!.food!, "and its farms pay less: the slow wall feeds itself last");
});

test("a Verdant seat leads food and wood, and is the only faction that pays less gold", () => {
  const totals = table();
  for (const axis of AXES) {
    if (axis === "food" || axis === "wood") {
      assert.ok(totals.verdant![axis]! > totals.human![axis]!, `Verdant leads ${axis}`);
    } else if (axis === "gold") {
      assert.ok(totals.verdant!.gold! < totals.human!.gold!, "the forest pays in growth, not coin");
    } else {
      assert.equal(totals.verdant![axis]!, totals.human![axis]!, `Verdant has no ${axis} modifier`);
    }
  }
  for (const other of ["ironmark", "ashen", "human"] as const) {
    assert.ok(totals.verdant!.gold! <= totals[other]!.gold!, `only Verdant trades gold away`);
    assert.ok(totals.verdant!.food! >= totals[other]!.food!, "nobody out-feeds Verdant");
  }
});

test("an Ashen seat leads gold and arcane and pays the least food of the four", () => {
  const totals = table();
  assert.ok(totals.ashen!.gold! > totals.human!.gold!, "the Court taxes better");
  assert.ok(totals.ashen!.arcane! > totals.human!.arcane!, "and raises more arcane");
  assert.equal(totals.ashen!.iron!, totals.human!.iron!);
  assert.equal(totals.ashen!.stone!, totals.human!.stone!);
  assert.equal(totals.ashen!.wood!, totals.human!.wood!);
  for (const other of FACTIONS) {
    assert.ok(totals.ashen!.food! <= totals[other]!.food!, "Ashen's -15% food is the largest penalty in the set");
  }
});

test("no faction is strictly best: every faction trails another on at least one axis", () => {
  const totals = table();
  for (const factionId of FACTIONS) {
    const trailsSomewhere = AXES.some((axis) => FACTIONS.some((other) => totals[other]![axis]! > totals[factionId]![axis]!));
    assert.ok(trailsSomewhere, `${factionId} must give something up`);
  }
  // The literal reading of "strictly best at income": the gold axis has no
  // unique maximum -- Ironmark and Ashen tie at +10%, so neither is strictly
  // best, and Verdant is the one faction that pays less than the baseline.
  const gold = FACTIONS.map((f) => [f, totals[f]!.gold!] as const);
  const top = Math.max(...gold.map(([, v]) => v));
  assert.ok(
    gold.filter(([, v]) => v === top).length > 1,
    `no faction may be uniquely top of the gold axis (leaders: ${gold.filter(([, v]) => v === top).map(([f]) => f).join(", ")})`,
  );
  assert.equal(gold.filter(([, v]) => v < totals.human!.gold!).length, 1, "exactly one faction trails the baseline on gold");
  // And each faction leads something, so no modifier is dead weight.
  for (const factionId of ["ironmark", "verdant", "ashen"] as const) {
    assert.ok(
      AXES.some((axis) => totals[factionId]![axis]! > totals.human![axis]!),
      `${factionId}'s modifier must be perceptible somewhere`,
    );
  }
});

test("the modifier is neutral by default: absent seat, human seat and an unwired faction are byte-identical", () => {
  const s = fixture(0, 1000);
  const noSeat = produceSettlementResources({ s0: s }, SEED, undefined);
  const humanSeat = produceSettlementResources({ s0: s }, SEED, undefined, [{ factionId: "human" }]);
  const legacySeat = produceSettlementResources({ s0: s }, SEED, undefined, [{}]);
  assert.deepEqual(humanSeat, noSeat, "a human seat pays exactly what the faction-less path paid");
  assert.deepEqual(legacySeat, noSeat, "a legacy seat with no factionId pays exactly what it always paid");

  // The same for the figures a player reads, not just the store.
  const state = makeState({
    players: [
      { ...makePlayer(0, "player", ["h0"], ["s0"]), factionId: "human" },
      { ...makePlayer(1, "ai", ["h1"], ["s1"]), factionId: "human" },
    ],
    settlements: [
      makeSettlement("s0", 0, 3, 3, { population: 1000, goldTax: 20, buildings: [building("market", 0, 0)] }),
      makeSettlement("s1", 1, 3, 3, { population: 1000, goldTax: 20, buildings: [building("market", 0, 0)] }),
    ],
  });
  const withoutFactions: GameState = { ...state, players: state.players.map((p) => ({ ...p, factionId: undefined })) };
  assert.equal(playerIncome(state, 0), playerIncome(withoutFactions, 0), "the HUD's next-turn gold is unchanged for a human seat");
  assert.equal(playerIncome(state, 1), playerIncome(withoutFactions, 1), "and unchanged for an AI seat left on human");

  const rates = settlementProductionRates(fixture(0), SEED, undefined, { factionId: "human" });
  assert.deepEqual(rates, settlementProductionRates(fixture(0), SEED), "the panel's rates are unchanged too");
});

test("the panel's rates ARE the turn's payment, at every faction (the display/payout guard)", () => {
  for (const seat of [undefined, ...FACTIONS.map((factionId) => ({ factionId }))] as Seat[]) {
    const settlement = fixture(0);
    const after = produceSettlementResources({ s0: settlement }, SEED, undefined, seat ? [seat] : undefined).s0;
    const rates = settlementProductionRates(settlement, SEED, undefined, seat);
    const label = seat?.factionId ?? "(no seat)";
    assert.equal(rates.goldPerTurn, after.gold - settlement.gold, `${label}: the gold the panel shows is the gold the turn pays`);
    for (const { resource, perTurn } of rates.rates) {
      assert.equal(
        perTurn,
        (after.warehouse[resource] ?? 0) - (settlement.warehouse[resource] ?? 0),
        `${label}: the ${resource} rate the panel shows is the ${resource} the turn pays`,
      );
    }
  }
});

test("only the building half of the economy moves: the population tax is not a building output", () => {
  const tax = 20000; // population 1000 x goldTax 20
  const totals = table();
  for (const factionId of FACTIONS) {
    const state = makeState({
      players: [
        { ...makePlayer(0, "player", ["h0"], ["s0"]), factionId },
        { ...makePlayer(1, "ai", ["h1"], ["s1"]), factionId: "human" },
      ],
      settlements: [
        makeSettlement("s0", 0, 3, 3, {
          population: 1000,
          goldTax: 20,
          buildings: BUILD_OUT.map((kind, i) => building(kind, i, 0)),
        }),
      ],
    });
    const buildingGold = totals[factionId]!.gold!;
    assert.ok(buildingGold > 0, `${factionId} has measured building gold`);
    assert.equal(
      playerIncome(state, 0),
      tax + buildingGold,
      `${factionId}: the tax half is untouched, only the ${buildingGold}g building half moved`,
    );
  }
});

test("an AI seat is produced at its own faction's economy, never the acting seat's", () => {
  const twoSeats = (f0: FactionId, f1: FactionId): GameState =>
    makeState({
      activePlayerId: 0,
      players: [
        { ...makePlayer(0, "player", ["h0"], ["s0"]), factionId: f0 },
        { ...makePlayer(1, "ai", ["h1"], ["s1"]), factionId: f1 },
      ],
      settlements: [
        // Same coordinates on both sides, so both settlements sit on the same
        // cells and the two seats differ only by their faction.
        makeSettlement("s0", 0, 3, 3, { buildings: [building("market", 0, 0)], autoTrade: false }),
        makeSettlement("s1", 1, 3, 3, { buildings: [building("market", 0, 0)], autoTrade: false }),
      ],
    });

  const totals = table();
  // The end-of-turn production loop runs for EVERY seat's settlements, so the
  // AI's own faction modifier is what its economy is built on -- deliberately,
  // not silently: AI seats are dealt a roster faction by the seed (seatFactions),
  // and this is what that deal now means for the map layer.
  const after = applyEndOfTurnDetailed(twoSeats("verdant", "ashen")).state;
  assert.equal(after.settlements.s1!.gold, totals.ashen!.gold!, "the Ashen AI seat is paid Ashen's gold");
  assert.notEqual(totals.ashen!.gold!, totals.verdant!.gold!, "and that is not the acting seat's number");

  // Reversed: the same AI seat's economy does not follow the actor.
  const reversed = applyEndOfTurnDetailed(twoSeats("ashen", "verdant")).state;
  assert.equal(reversed.settlements.s1!.gold, totals.verdant!.gold!, "a Verdant AI seat is paid Verdant's gold");
});
