import { test } from "node:test";
import assert from "node:assert/strict";
import type { BuildingDef, BuildingKind, CastleLevel, FactionId, SettlementState } from "@heroes/contracts";
import {
  DISTRICT_BUILDING_POOL,
  SETTLEMENT_LEVEL_TOO_LOW,
  STARTER_BUILDING_KINDS,
  applyPlaceBuildings,
  buildingLevelAllowed,
  buildingRequiredLevel,
} from "@heroes/engine";
import { makePlayer, makeSettlement, makeState } from "../charter/_helpers";

// Every kind in the union (packages/contracts/src/buildings.ts). Kept as a
// literal list because the union is a type, not a runtime array -- the sprite
// coverage map is the other place that enumerates it.
const ALL_KINDS: BuildingKind[] = [
  "townHall", "house", "tower", "mageGuild", "mine", "stoneMine", "ironMine", "market",
  "barracks", "smithy", "apartment", "farmField", "farmhouse", "archeryRange", "granary",
  "warehouse", "bank", "treasury", "goldMine", "woodcutterHut", "arcaneFont", "shipyard",
  "stables", "huntingLodge", "eyrie", "crypt", "ossuary", "wraithBarrows", "spireOfAsh",
  "forgeHall", "gunnersRedoubt", "golemFoundry", "deepAnvil", "groveSanctum", "warrenLodge",
  "sylvanStables", "worldrootGrove", "blackChapel", "dragonBoneyard", "delversHall",
  "hearthTemple", "ramPens", "seedlingGrove", "druidCircle",
];

/** The tier-1 keep: the starter set, the district seed pool and the basic economy. */
const LEVEL_ONE: BuildingKind[] = [
  "townHall", "house", "tower", "farmField", "farmhouse", "granary", "market", "smithy",
  "mine", "stoneMine", "ironMine", "goldMine", "woodcutterHut",
  "crypt", "delversHall", "seedlingGrove",
];

/** The town tier: second-tier housing/storage/money, the arcane and naval sources, and each faction's middle troop buildings. */
const LEVEL_TWO: BuildingKind[] = [
  "apartment", "warehouse", "bank", "treasury", "arcaneFont", "shipyard",
  "barracks", "archeryRange", "stables", "huntingLodge",
  "ossuary", "wraithBarrows",
  "forgeHall", "gunnersRedoubt", "ramPens",
  "groveSanctum", "warrenLodge", "sylvanStables",
];

/** The castle tier: every kind whose own build day/gold row is the top of its faction's ladder. */
const LEVEL_THREE: BuildingKind[] = [
  "mageGuild", "eyrie",
  "spireOfAsh", "blackChapel", "dragonBoneyard",
  "golemFoundry", "deepAnvil", "hearthTemple",
  "worldrootGrove", "druidCircle",
];

const RICH = { wood: 999, stone: 999, iron: 999, arcane: 999, food: 0 };

function withFaction(factionId?: FactionId) {
  const player = makePlayer(0, "player", ["h0"], ["s0"]);
  return [{ ...player, ...(factionId ? { factionId } : {}) }];
}

function richSettlement(
  level: CastleLevel,
  buildings: BuildingDef[] = [],
  extras: Partial<SettlementState> = {},
): SettlementState {
  return makeSettlement("s0", 0, 2, 2, { level, gold: 99999, warehouse: RICH, buildings, ...extras });
}

function place(
  level: CastleLevel,
  kinds: BuildingKind[],
  opts: { factionId?: FactionId; initialLayout?: boolean; buildings?: BuildingDef[]; incoming?: BuildingDef[] } = {},
) {
  const settlement = richSettlement(level, opts.buildings ?? []);
  const state = makeState({ settlements: [settlement], players: withFaction(opts.factionId) });
  const incoming: BuildingDef[] =
    opts.incoming ?? kinds.map((kind, i) => ({ gx: i, gy: 0, kind, level: 1, style: "classic" }));
  const result = applyPlaceBuildings(state, "s0", 0, incoming, opts.initialLayout ?? false);
  return { result, before: settlement, after: result.state.settlements.s0 };
}

test("a level-1 settlement cannot place a building declared for a higher tier", () => {
  for (const kind of ["bank", "arcaneFont", "warehouse", "mageGuild", "eyrie", "dragonBoneyard"] as BuildingKind[]) {
    const factionId: FactionId | undefined = kind === "eyrie" || kind === "mageGuild" ? "human" : kind === "dragonBoneyard" ? "ashen" : undefined;
    const { result, after } = place(1, [kind], { factionId });
    assert.equal(result.ok, false, `${kind} must be refused in a level-1 settlement`);
    assert.equal(result.reason, SETTLEMENT_LEVEL_TOO_LOW, kind);
    assert.equal(after.buildings.length, 0, `${kind}: nothing is placed`);
    assert.equal(after.gold, 99999, `${kind}: nothing is charged`);
  }
});

test("the same building places at the level that unlocks it", () => {
  const bank = place(2, ["bank"]);
  assert.equal(bank.result.ok, true, `bank at a level-2 town: ${bank.result.reason}`);
  assert.equal(bank.after.buildings.length, 1);
  assert.equal(bank.after.buildings[0].kind, "bank");
  assert.equal(bank.after.buildings[0].construction?.daysRemaining, 5, "buildDays are stamped server-side");
  assert.equal(bank.after.gold, 99999 - 400, "the town pays the placement cost");

  const mageGuild = place(3, ["mageGuild"], { factionId: "human" });
  assert.equal(mageGuild.result.ok, true, `mage guild at a level-3 castle: ${mageGuild.result.reason}`);
  assert.equal(mageGuild.after.buildings.map((b) => b.kind).join(), "mageGuild");

  // A higher tier may still place a lower tier's buildings -- the gate is a
  // floor, not an equality.
  const both = place(3, ["bank", "house"]);
  assert.equal(both.result.ok, true, both.result.reason);
  assert.equal(both.after.buildings.length, 2);
});

test("a level-1 kind still places in a level-1 settlement", () => {
  const { result, after } = place(1, ["house", "farmField", "woodcutterHut", "goldMine"]);
  assert.equal(result.ok, true, result.reason);
  assert.equal(after.buildings.length, 4, "the gate is not a blanket refusal");
});

test("one tier short is refused, the unlocking tier is allowed", () => {
  const late = place(2, ["worldrootGrove"], { factionId: "verdant" });
  assert.equal(late.result.ok, false, "a level-3 kind may not be placed by a level-2 town");
  assert.equal(late.result.reason, SETTLEMENT_LEVEL_TOO_LOW);

  const atThree = place(3, ["worldrootGrove"], { factionId: "verdant" });
  assert.equal(atThree.result.ok, true, atThree.result.reason);
});

test("the free starter layout is gated too, so a forged initialLayout cannot hand a keep a castle-tier building", () => {
  const forged = place(1, ["townHall", "bank"], { initialLayout: true });
  assert.equal(forged.result.ok, false, "the free path must not bypass the tier gate");
  assert.equal(forged.result.reason, SETTLEMENT_LEVEL_TOO_LOW);

  const honest = place(1, ["townHall", "house", "farmField"], { initialLayout: true });
  assert.equal(honest.result.ok, true, `the real starter set still commits free: ${honest.result.reason}`);
  assert.equal(honest.after.gold, 99999, "the starter set stays free");
});

test("an existing higher-tier building round-trips through its own settlement's commit", () => {
  // A save written before the gate landed (or by a seeded fixture) holds a bank
  // in a level-1 settlement. The cart re-sends the whole set on every commit, so
  // refusing the building it already holds would make the settlement unbuildable.
  const legacy: BuildingDef = { gx: 1, gy: 1, kind: "bank", level: 1, style: "classic" };
  const kept = place(1, [], { buildings: [legacy], incoming: [{ ...legacy }] });
  assert.equal(kept.result.ok, true, `an existing bank may be re-committed: ${kept.result.reason}`);

  // ...but it buys no NEW ones while it is still level 1.
  const added = place(1, [], {
    buildings: [legacy],
    incoming: [{ ...legacy }, { gx: 2, gy: 2, kind: "bank", level: 1, style: "classic" }],
  });
  assert.equal(added.result.ok, false);
  assert.equal(added.result.reason, SETTLEMENT_LEVEL_TOO_LOW);
});

test("a district is gated by the level of the settlement that owns it", () => {
  const district = { q: 3, r: 2, citySpots: [] };
  const atOne = makeState({
    settlements: [
      makeSettlement("s0", 0, 2, 2, { level: 1, gold: 99999, warehouse: RICH, buildings: [] }),
    ],
    players: withFaction(),
  });
  const refused = applyPlaceBuildings(
    atOne,
    "s0",
    0,
    [{ gx: 0, gy: 0, kind: "bank", level: 1, style: "classic" }],
    false,
    district,
  );
  assert.equal(refused.ok, false, "a level-1 keep's district may not hold a level-2 building");
  assert.equal(refused.reason, SETTLEMENT_LEVEL_TOO_LOW);

  const atTwo = makeState({
    settlements: [
      makeSettlement("s0", 0, 2, 2, { level: 2, gold: 99999, warehouse: RICH, buildings: [] }),
    ],
    players: withFaction(),
  });
  const allowed = applyPlaceBuildings(
    atTwo,
    "s0",
    0,
    [{ gx: 0, gy: 0, kind: "bank", level: 1, style: "classic" }],
    false,
    district,
  );
  assert.equal(allowed.ok, true, allowed.reason);
  assert.equal(allowed.state.settlements.s0.districts?.["3,2"].buildings[0].kind, "bank");
});

test("every kind the engine itself places at tier 1 declares no tier gate", () => {
  for (const kind of new Set([...STARTER_BUILDING_KINDS, ...DISTRICT_BUILDING_POOL])) {
    assert.equal(buildingRequiredLevel(kind), 1, `${kind} is placed by the engine at tier 1`);
    assert.equal(buildingLevelAllowed(kind, 1), true, kind);
  }
});

test("the tier bands are exact, so a new registry entry has to make the choice", () => {
  const band = (level: CastleLevel) => ALL_KINDS.filter((k) => buildingRequiredLevel(k) === level);
  const sorted = (list: readonly BuildingKind[]) => [...list].sort().join();
  assert.equal(sorted(band(1)), sorted(LEVEL_ONE));
  assert.equal(sorted(band(2)), sorted(LEVEL_TWO));
  assert.equal(sorted(band(3)), sorted(LEVEL_THREE));
  assert.equal(band(1).length + band(2).length + band(3).length, ALL_KINDS.length, "every kind is in a band");
  assert.equal(band(1).length, 16);
  assert.equal(band(2).length, 18);
  assert.equal(band(3).length, 10);
});

test("buildingLevelAllowed reads the declared level, not the settlement's own", () => {
  assert.equal(buildingRequiredLevel("house"), 1);
  assert.equal(buildingRequiredLevel("bank"), 2);
  assert.equal(buildingRequiredLevel("druidCircle"), 3);
  assert.equal(buildingLevelAllowed("bank", 1), false);
  assert.equal(buildingLevelAllowed("bank", 2), true);
  assert.equal(buildingLevelAllowed("bank", 3), true);
});
