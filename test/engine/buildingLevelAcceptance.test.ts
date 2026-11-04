import { test } from "node:test";
import assert from "node:assert/strict";
import { hexDistance } from "@heroes/contracts";
import type { BuildingKind, CastleLevel, FactionId } from "@heroes/contracts";
import {
  DISTRICT_GRID_SIZE,
  buildingBuildDays,
  buildingLevelAllowed,
  buildingPlacementCost,
  buildingRequiredLevel,
  buildingSettlementEffects,
  cityViewSizeFor,
  controlRange,
  getBuildingEffect,
} from "@heroes/engine";

// The tier gate's ACCEPTANCE RECORD: the measurements the change was judged on.
//
// `buildingLevelGate.test.ts` asserts the rule's BEHAVIOUR (what applyPlaceBuildings
// refuses, at which level, on which path). This file asserts the numbers that
// decided the rule exists at all, because none of them was pinned anywhere:
//
//   * the placement surface a level-1 town had BEFORE the rule (measured on
//     github/main 5df1580, where the only placement gate in the engine was the
//     faction rule -- so every registry entry was placeable in a level-1 town),
//   * the two ends of that surface: an L1 keep's 5x5 grid against 25 faction-legal
//     kinds including the 400-500g / 6-day grand row, and an L3 castle's control
//     reach against its own city grid,
//   * and the thresholds the gate was required to LEAVE ALONE.
//
// The union is a type, not a runtime array, so the 44 entries are recorded here as
// their own decomposition -- the 18 neutral kinds plus each faction's own -- which
// stays honest because every entry is checked back against the registry. The
// sprite coverage map is the other place that enumerates the union.

/** Kinds with no `faction` on their registry entry: every seat may place them. */
const NEUTRAL: BuildingKind[] = [
  "townHall", "house", "tower", "mine", "stoneMine", "ironMine", "market", "smithy",
  "apartment", "farmField", "granary", "warehouse", "bank", "treasury", "goldMine",
  "woodcutterHut", "arcaneFont", "shipyard",
];

/** Each faction's own entries (the registry's `faction` field), including its tier-1 troop building. */
const FACTION_KINDS: Record<Exclude<FactionId, "neutral">, BuildingKind[]> = {
  human: ["mageGuild", "barracks", "farmhouse", "archeryRange", "stables", "huntingLodge", "eyrie"],
  ashen: ["crypt", "ossuary", "wraithBarrows", "spireOfAsh", "blackChapel", "dragonBoneyard"],
  ironmark: ["forgeHall", "gunnersRedoubt", "golemFoundry", "deepAnvil", "delversHall", "hearthTemple", "ramPens"],
  verdant: ["groveSanctum", "warrenLodge", "sylvanStables", "worldrootGrove", "seedlingGrove", "druidCircle"],
};

const FACTIONS = Object.keys(FACTION_KINDS) as Array<Exclude<FactionId, "neutral">>;
const ALL_KINDS: BuildingKind[] = [...NEUTRAL, ...FACTIONS.flatMap((f) => FACTION_KINDS[f])];

/** Gold >= 400 and 6 build days: the "grand" row a player could not tell apart from a house. */
const isGrand = (kind: BuildingKind) => (buildingPlacementCost(kind).gold ?? 0) >= 400 && buildingBuildDays(kind) >= 6;

/** Hexes within `range` of a hex, counted with the engine's own distance. */
function diskSize(range: number): number {
  let n = 0;
  for (let dq = -range; dq <= range; dq++) {
    for (let dr = -range; dr <= range; dr++) {
      if (hexDistance({ q: 0, r: 0 }, { q: dq, r: dr }) <= range) n += 1;
    }
  }
  return n;
}

/** What a seat of this faction may place at `level`, components flagged separately. */
function placeable(level: CastleLevel, factionId: FactionId): BuildingKind[] {
  return ALL_KINDS.filter(
    (k) => buildingLevelAllowed(k, level) && (getBuildingEffect(k).faction === undefined || getBuildingEffect(k).faction === factionId),
  );
}

test("the recorded union is the registry: 44 entries, 18 neutral plus each faction's own", () => {
  assert.equal(ALL_KINDS.length, 44);
  assert.equal(new Set(ALL_KINDS).size, 44, "the decomposition lists each kind once");
  for (const kind of NEUTRAL) {
    assert.equal(getBuildingEffect(kind).faction, undefined, `${kind} is neutral`);
  }
  for (const factionId of FACTIONS) {
    for (const kind of FACTION_KINDS[factionId]) {
      assert.equal(getBuildingEffect(kind).faction, factionId, `${kind} belongs to ${factionId}`);
    }
  }
  assert.equal(NEUTRAL.length, 18);
  assert.deepEqual(
    FACTIONS.map((f) => FACTION_KINDS[f].length),
    [7, 6, 7, 6],
    "human/ashen/ironmark/verdant",
  );
});

test("before the rule a level-1 keep could place its whole faction-legal set, grand row included", () => {
  // The pre-rule surface: the faction rule only, which is why these counts are the
  // measurement and not a tautology -- 18 neutral + the seat's own entries.
  const before = (f: Exclude<FactionId, "neutral">): number => 18 + FACTION_KINDS[f].length;
  assert.deepEqual(FACTIONS.map(before), [25, 24, 25, 24]);

  // After the gate, a level-1 keep keeps the 12 neutral economy/starter kinds it
  // needs plus its own tier-1 troop building -- 13 for every faction.
  for (const f of FACTIONS) {
    assert.equal(placeable(1, f).length, 13, `${f} at level 1`);
  }

  // NAME the rows the gate closes for a level-1 keep, per faction: the money and
  // storage kinds, the naval and arcane sources, the middle troop buildings, and
  // the whole grand row.
  const neutralClosed: BuildingKind[] = ["apartment", "warehouse", "bank", "treasury", "arcaneFont", "shipyard"];
  assert.deepEqual(
    ALL_KINDS.filter((k) => !buildingLevelAllowed(k, 1) && getBuildingEffect(k).faction === undefined),
    neutralClosed,
    "the neutral rows a level-1 keep loses",
  );
  assert.deepEqual(
    FACTION_KINDS.human.filter((k) => !buildingLevelAllowed(k, 1)),
    ["mageGuild", "barracks", "archeryRange", "stables", "huntingLodge", "eyrie"],
  );
  assert.deepEqual(
    FACTION_KINDS.ashen.filter((k) => !buildingLevelAllowed(k, 1)),
    ["ossuary", "wraithBarrows", "spireOfAsh", "blackChapel", "dragonBoneyard"],
  );
  assert.deepEqual(
    FACTION_KINDS.ironmark.filter((k) => !buildingLevelAllowed(k, 1)),
    ["forgeHall", "gunnersRedoubt", "golemFoundry", "deepAnvil", "hearthTemple", "ramPens"],
  );
  assert.deepEqual(
    FACTION_KINDS.verdant.filter((k) => !buildingLevelAllowed(k, 1)),
    ["groveSanctum", "warrenLodge", "sylvanStables", "worldrootGrove", "druidCircle"],
  );

  // The small end of the absurdity, in one line: a 25-cell level-1 grid against 25
  // faction-legal kinds -- the strongest of them 500g for 6 days, no different from
  // a house to the player looking at the palette.
  assert.equal(cityViewSizeFor(1) ** 2, 25, "an L1 keep's city grid is 5x5");
  for (const f of FACTIONS) {
    const closed = ALL_KINDS.filter(
      (k) => !buildingLevelAllowed(k, 1) && (getBuildingEffect(k).faction === undefined || getBuildingEffect(k).faction === f),
    );
    assert.equal(
      placeable(1, f).length + closed.length,
      before(f),
      `${f}: the level-1 rows plus the closed rows are the pre-rule faction-legal set`,
    );
  }
  assert.deepEqual(
    ALL_KINDS.filter((k) => isGrand(k) && FACTION_KINDS.human.includes(k)),
    ["mageGuild", "eyrie"],
    "the grand rows a level-1 human keep was offered",
  );
});

test("the grand row IS the castle tier: every 400-500g / 6-day kind waits for level 3", () => {
  const grand = ALL_KINDS.filter(isGrand);
  assert.equal(grand.length, 10);
  assert.deepEqual(
    grand.filter((k) => buildingRequiredLevel(k) !== 3),
    [],
    "no grand building is reachable before the castle tier",
  );
  for (const kind of grand) {
    assert.equal(buildingLevelAllowed(kind, 1), false, `${kind} in a level-1 keep`);
    assert.equal(buildingLevelAllowed(kind, 2), false, `${kind} in a level-2 town`);
    assert.equal(buildingLevelAllowed(kind, 3), true, `${kind} in a level-3 castle`);
  }
});

test("the absurd end: an L3 castle addresses 3,375 city cells against an L1 keep's 475", () => {
  // controlRange is the engine's own reach (level + the town hall's per-level bonus),
  // and the count below walks it with the engine's own hexDistance rather than a
  // closed-form formula.
  assert.equal(controlRange(3, [{ gx: 0, gy: 0, kind: "townHall", level: 3 }]), 6);
  assert.deepEqual([1, 2, 3].map((l) => controlRange(l as CastleLevel, [{ gx: 0, gy: 0, kind: "townHall", level: l }])), [2, 4, 6]);

  const districtCells = DISTRICT_GRID_SIZE ** 2;
  assert.equal(districtCells, 25, "a district is always a 5x5 grid");

  const measured = ([1, 2, 3] as CastleLevel[]).map((level) => {
    const range = controlRange(level, [{ gx: 0, gy: 0, kind: "townHall", level }]);
    const hexes = diskSize(range);
    const districtHexes = hexes - 1; // the settlement's own hex carries the city grid
    const cityCells = cityViewSizeFor(level) ** 2;
    return { level, range, hexes, districtCells: districtHexes * districtCells, cityCells, total: districtHexes * districtCells + cityCells };
  });

  assert.deepEqual(
    measured.map((m) => [m.range, m.hexes, m.districtCells, m.cityCells, m.total]),
    [
      [2, 19, 450, 25, 475],
      [4, 61, 1500, 100, 1600],
      [6, 127, 3150, 225, 3375],
    ],
  );
  // The line the acceptance states: 3,150 district city-grid cells beside a 225-cell
  // main grid -- from turn 0, before the gate, every one of them able to take a grand
  // building. A win button, not a decision.
  assert.equal(measured[2].districtCells, 3150);
  assert.equal(measured[2].cityCells, 225);
});

test("the tiers' own thresholds are untouched: house 300/1000/1500, grid 5x5/10x10/15x15", () => {
  // The gate buys BUILDINGS with a level; it was required not to move what a level
  // itself is worth. These are the two constants a reader checks that claim against.
  assert.deepEqual(
    ([1, 2, 3] as CastleLevel[]).map((l) => buildingSettlementEffects("house", l).populationBonus),
    [300, 1000, 1500],
  );
  assert.deepEqual(([1, 2, 3] as CastleLevel[]).map((l) => cityViewSizeFor(l)), [5, 10, 15]);
});
