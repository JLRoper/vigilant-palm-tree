import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyPlaceBuildings,
  autoStaffedCount,
  autoStaffedSlots,
  buildingMaxWorkers,
  buildStarterLayout,
  effortFraction,
  newPlacementsAutoCrew,
  seedStartupDistricts,
  settlementPopulationCap,
  WORKFORCE_PER_POPULATION,
  workforcePool,
} from "@heroes/engine";
import type { BuildingDef, BuildingKind, DistrictState, SettlementState } from "@heroes/contracts";
import { makeSettlement, makeState, emptyWarehouse } from "../charter/_helpers";

// THE WORKFORCE NEVER BINDS (high-end-city architect report, section 1, pick #2).
//
// On github/main at 0.40.0 `WORKFORCE_PER_POPULATION` was 100, so a fully
// built-out level-3 castle -- whose 15x15 grid and both seeded districts are
// filled with housing, at the 80,000 population that housing grants -- asked for
// 275 worker-slots and could staff 800: 291% of demand. The pool could not bind,
// and the legacy `undefined = auto-staffed at full crew` default was free to
// follow the player all the way there. These cases measure the rebalance.

function building(kind: BuildingKind, gx: number, gy: number, level = 1, extra: Partial<BuildingDef> = {}): BuildingDef {
  return { gx, gy, kind, level, style: "classic", ...extra };
}

function fillGrid(size: number, kind: BuildingKind, level = 1): BuildingDef[] {
  const out: BuildingDef[] = [];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) out.push(building(kind, x, y, level));
  return out;
}

/** Two districts of 25 level-3 houses each -- the housing that lifts an L3
 * castle's population cap to 80,000 (5,000 base + 50 x 1,500). */
function houseDistricts(count: number, q: number, r: number): Record<string, DistrictState> {
  const hexes = [{ q: q + 1, r }, { q: q + 2, r }, { q, r: r + 1 }, { q: q + 1, r: r + 1 }, { q, r: r + 2 }, { q: q + 2, r: r + 1 }];
  const out: Record<string, DistrictState> = {};
  for (let i = 0; i < count; i++) {
    const h = hexes[i];
    out[`${h.q},${h.r}`] = { q: h.q, r: h.r, citySpots: [], buildings: fillGrid(5, "house", 3) };
  }
  return out;
}

function workerDemand(s: SettlementState): number {
  let total = s.buildings.reduce((n, b) => n + buildingMaxWorkers(b.kind), 0);
  for (const d of Object.values(s.districts ?? {})) {
    total += d.buildings.reduce((n, b) => n + buildingMaxWorkers(b.kind), 0);
  }
  return total;
}

/** The architect's fixture: a house-filled level-3 castle + its two seeded districts, at cap. */
function houseFilledL3(): SettlementState {
  return {
    ...makeSettlement("s0", 0, 5, 5, { level: 3, population: 80000, buildings: fillGrid(15, "house") }),
    districts: houseDistricts(2, 5, 5),
  } as SettlementState;
}

const GRASS = { width: 32, height: 32, get: () => "grass" as const, resourceTileAt: () => undefined };

/** A fresh level-2 town: the free starter layout plus its one seeded district, at the level's default population. */
function freshL2(): SettlementState {
  const districts = seedStartupDistricts(GRASS, { id: "s0", q: 5, r: 5, level: 2 }, { castleSeed: 12345, count: 1 });
  return {
    ...makeSettlement("s0", 0, 5, 5, {
      level: 2,
      population: 1500,
      buildings: buildStarterLayout({ size: 10, style: "classic", factionId: "human" }),
    }),
    districts,
  } as SettlementState;
}

const L3_DEMAND = 275;

test("the divisor is 300 and a fully built-out L3 castle's pool sits AT its supply, not at 291% of it", () => {
  assert.equal(WORKFORCE_PER_POPULATION, 300, "the rebalanced divisor");

  const s = houseFilledL3();
  assert.equal(s.population, settlementPopulationCap(s), "the fixture is at its cap");
  assert.equal(settlementPopulationCap(s), 80000);
  assert.equal(workerDemand(s), L3_DEMAND, "the fixture's demand, measured through buildingMaxWorkers");

  const pool = workforcePool(s);
  assert.equal(pool, 266, "floor(80000 / 300)");
  assert.ok(pool < L3_DEMAND, `the pool (${pool}) must fall SHORT of the demand (${L3_DEMAND}) so staffing binds`);
  assert.ok(pool / L3_DEMAND >= 0.9, `and land at or near it, not far below: ${((pool / L3_DEMAND) * 100).toFixed(0)}%`);
});

test("the binding curve: 100 was 291% of demand, 291 is the last binding divisor, 300 is where we land", () => {
  const s = houseFilledL3();
  const ratio = (divisor: number): number => Math.floor(s.population / divisor) / L3_DEMAND;

  assert.ok(ratio(100) > 2.5, `the old divisor left the pool at ${(ratio(100) * 100).toFixed(0)}% of demand — a no-op`);
  assert.equal(Math.floor(s.population / 290), 275, "divisor 290 -> pool 275, the last value that still covers demand exactly");
  assert.equal(Math.floor(s.population / 291), 274, "divisor 291 -> pool 274, one slot short: the first binding value");
  assert.ok(ratio(290) >= 1 && ratio(291) < 1, "290 still covers demand; 291 is the crossing point where the pool starts to bind");
  assert.ok(ratio(300) < 1 && ratio(300) >= 0.9, `300 -> ${(ratio(300) * 100).toFixed(0)}%: binding, three slots short`);
});

test("a fresh L2 town is NOT starved: its pool is small, and its whole stock runs on the auto crew at full effort", () => {
  const s = freshL2();
  const demand = workerDemand(s);
  const pool = workforcePool(s);

  assert.equal(s.population, 1500, "the level-2 default population");
  assert.equal(pool, 5, "floor(1500 / 300)");
  assert.ok(pool < demand, `the pool genuinely cannot cover a fresh town's demand (${pool} < ${demand})`);

  // ...which is exactly why the auto crew is load-bearing: every starter and
  // seeded building is auto-staffed, so the town runs at full effort anyway.
  assert.equal(autoStaffedCount(s), s.buildings.length + (s.districts ? Object.values(s.districts).reduce((n, d) => n + d.buildings.length, 0) : 0));
  assert.ok(autoStaffedSlots(s) >= demand, `the auto crew covers the demand: ${autoStaffedSlots(s)} slots >= ${demand}`);
  const all = [...s.buildings, ...Object.values(s.districts ?? {}).flatMap((d) => d.buildings)];
  assert.ok(all.every((b) => b.workers === undefined), "the bootstrap is entirely auto");
  assert.ok(all.every((b) => effortFraction(b) === 1), "and it produces at full effort");
});

test("the auto crew cannot be extended past the bootstrap: a new placement into a district-bearing town starts at explicit 0", () => {
  // Bootstrap: no explicit count, no districts -> new placements stay auto.
  const bootstrap = makeSettlement("s0", 0, 5, 5, { gold: 1000, population: 1500, warehouse: emptyWarehouse({ wood: 200, stone: 200 }), buildings: [building("farmField", 0, 0)] });
  assert.equal(newPlacementsAutoCrew(bootstrap), true, "a pure bootstrap still auto-crews");
  const bootPlaced = applyPlaceBuildings(makeState({ settlements: [bootstrap] }), "s0", 0, [building("farmField", 0, 0), building("house", 2, 2)]);
  assert.equal(bootPlaced.ok, true);
  assert.equal("workers" in bootPlaced.state.settlements.s0.buildings[1], false, "bootstrap placements stay legacy");

  // Grown: one LEGACY district (no explicit counts anywhere) is enough to make
  // every later placement explicit 0 -> the pool must be spent on it.
  const grown = {
    ...makeSettlement("s0", 0, 5, 5, { gold: 1000, population: 1500, warehouse: emptyWarehouse({ wood: 200, stone: 200 }), buildings: [building("farmField", 0, 0)] }),
    districts: { "6,5": { q: 6, r: 5, citySpots: [], buildings: [building("farmField", 0, 0)] } },
  } as SettlementState;
  assert.equal(newPlacementsAutoCrew(grown), false, "a district-bearing town is no longer a bootstrap");
  const grownPlaced = applyPlaceBuildings(makeState({ settlements: [grown] }), "s0", 0, [building("farmField", 0, 0), building("house", 2, 2)]);
  assert.equal(grownPlaced.ok, true);
  assert.equal(
    grownPlaced.state.settlements.s0.buildings[1].workers,
    0,
    "a new building in a grown town is staffed from the pool, not auto-crewed for free",
  );
});
