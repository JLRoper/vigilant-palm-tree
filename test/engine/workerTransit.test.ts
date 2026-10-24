import { test } from "node:test";
import assert from "node:assert/strict";
import type { Platoon } from "@heroes/contracts";
import {
  GameMap,
  ROAD_BUILD_GOLD_COST_PER_TILE,
  WORKER_TRANSIT_TILES_PER_DAY,
  advanceWorkerTransit,
  advanceWorkerTransits,
  resolveWorkerTransitAmbush,
  settlementStacks,
  startWorkerTransit,
  workerTransitArrived,
  workerTransitIsVulnerable,
  workerTransitTile,
  workerTransitsOf,
} from "@heroes/engine";
import { makeSettlement, makeState } from "../charter/_helpers";

const ORIGIN = { q: 2, r: 2 }; // the guaranteed-passable hero spawn tile
const DEST = { q: 6, r: 2 };

function workerPlatoons(factionId: "human" | "ashen" = "human"): Platoon[] {
  return [{ entries: [{ unitTypeId: `construction_worker_${factionId}`, count: 1 }] }];
}

function transitFixture(opts: { stacks?: Platoon[]; destGold?: number; originGold?: number } = {}) {
  const origin = {
    ...makeSettlement("s0", 0, ORIGIN.q, ORIGIN.r, { gold: opts.originGold ?? 10000 }),
    ...(opts.stacks ? { stacks: opts.stacks } : {}),
  };
  const destination = makeSettlement("s1", 0, DEST.q, DEST.r, { gold: opts.destGold ?? 0 });
  return makeState({ settlements: [origin, destination] });
}

const map = new GameMap(3, "small");

test("startWorkerTransit refuses without a construction worker present", () => {
  const state = transitFixture();
  const result = startWorkerTransit(state, 0, "s0", "s1", map);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "no_construction_worker_present");
  assert.equal(result.state, state, "an untouched state on refusal");
});

test("startWorkerTransit refuses for a non-owner, a missing settlement, or the same settlement twice", () => {
  const state = transitFixture({ stacks: workerPlatoons("human") });
  assert.equal(startWorkerTransit(state, 1, "s0", "s1", map).reason, "forbidden_not_your_settlement");
  assert.equal(startWorkerTransit(state, 0, "nope", "s1", map).reason, "no_settlement");
  assert.equal(startWorkerTransit(state, 0, "s0", "nope", map).reason, "no_destination");
  assert.equal(startWorkerTransit(state, 0, "s0", "s0", map).reason, "same_settlement");
});

test("startWorkerTransit removes exactly one worker from the origin garrison and computes a path", () => {
  const state = transitFixture({ stacks: workerPlatoons("human") });
  const result = startWorkerTransit(state, 0, "s0", "s1", map);
  assert.equal(result.ok, true);
  assert.ok(result.transit && result.transit.path.length > 0);
  assert.equal(result.transit?.pathIndex, 0);
  assert.equal(result.transit?.buildRoads, false);
  assert.equal(result.transit?.unitTypeId, "construction_worker_human");
  const remaining = settlementStacks(result.state.settlements.s0).flatMap((p) => p.entries);
  assert.deepEqual(remaining.filter((e) => e.unitTypeId === "construction_worker_human"), []);
  assert.deepEqual(workerTransitsOf(result.state), [result.transit]);
  assert.equal(result.state.nextWorkerTransitId, 1);
  // The input state is untouched (pure function).
  assert.deepEqual(settlementStacks(state.settlements.s0)[0].entries, workerPlatoons("human")[0].entries);
});

test("startWorkerTransit with buildRoads charges the gold toll from the origin's treasury up front", () => {
  const funded = transitFixture({ stacks: workerPlatoons("human"), originGold: 10000 });
  const started = startWorkerTransit(funded, 0, "s0", "s1", map, { buildRoads: true });
  assert.equal(started.ok, true);
  assert.equal(started.transit?.buildRoads, true);
  const toll = ROAD_BUILD_GOLD_COST_PER_TILE * (started.transit?.path.length ?? 0);
  assert.ok(toll > 0);
  assert.equal(started.state.settlements.s0.gold, 10000 - toll);

  const broke = transitFixture({ stacks: workerPlatoons("human"), originGold: 0 });
  const refused = startWorkerTransit(broke, 0, "s0", "s1", map, { buildRoads: true });
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, "not_enough_gold");
});

test("advanceWorkerTransits walks every in-flight transit and delivers the worker on arrival", () => {
  let state = transitFixture({ stacks: workerPlatoons("human") });
  const started = startWorkerTransit(state, 0, "s0", "s1", map);
  assert.ok(started.ok);
  state = started.state;
  const pathLen = started.transit!.path.length;

  let days = 0;
  while (workerTransitsOf(state).length > 0 && days < 50) {
    state = advanceWorkerTransits(state);
    days += 1;
  }
  assert.ok(days <= Math.ceil(pathLen / WORKER_TRANSIT_TILES_PER_DAY) + 1, "arrives within the expected number of days");
  assert.equal(workerTransitsOf(state).length, 0, "the transit is removed on arrival");
  const destStacks = settlementStacks(state.settlements.s1).flatMap((p) => p.entries);
  assert.deepEqual(destStacks.filter((e) => e.unitTypeId === "construction_worker_human"), [
    { unitTypeId: "construction_worker_human", count: 1 },
  ]);
});

test("advanceWorkerTransits is a no-op when there is nothing in flight", () => {
  const state = transitFixture();
  assert.equal(advanceWorkerTransits(state), state);
});

test("advanceWorkerTransit walks WORKER_TRANSIT_TILES_PER_DAY tiles per day when not building roads", () => {
  const state = transitFixture({ stacks: workerPlatoons("human") });
  const started = startWorkerTransit(state, 0, "s0", "s1", map);
  assert.ok(started.ok && started.transit);
  const transit = started.transit!;
  const stepped = advanceWorkerTransit(transit);
  assert.equal(stepped.transit.pathIndex, Math.min(WORKER_TRANSIT_TILES_PER_DAY, transit.path.length));
  assert.deepEqual(stepped.newlyRoadedTiles, []);
});

test("advanceWorkerTransit with buildRoads walks half speed and reports the newly roaded tiles", () => {
  const state = transitFixture({ stacks: workerPlatoons("human"), originGold: 10000 });
  const started = startWorkerTransit(state, 0, "s0", "s1", map, { buildRoads: true });
  assert.ok(started.ok && started.transit);
  const transit = started.transit!;
  const stepped = advanceWorkerTransit(transit);
  const expectedSteps = Math.min(Math.floor(WORKER_TRANSIT_TILES_PER_DAY * 0.5), transit.path.length);
  assert.equal(stepped.transit.pathIndex, expectedSteps);
  assert.equal(stepped.newlyRoadedTiles.length, expectedSteps);
});

test("advanceWorkerTransit is a no-op once arrived", () => {
  const state = transitFixture({ stacks: workerPlatoons("human") });
  const started = startWorkerTransit(state, 0, "s0", "s1", map);
  assert.ok(started.ok && started.transit);
  let transit = started.transit!;
  for (let i = 0; i < 50 && !workerTransitArrived(transit); i++) {
    transit = advanceWorkerTransit(transit).transit;
  }
  assert.ok(workerTransitArrived(transit));
  const again = advanceWorkerTransit(transit);
  assert.equal(again.arrived, true);
  assert.deepEqual(again.transit, transit);
});

test("workerTransitTile reports the origin before any step, and the path's consumed tile after", () => {
  const state = transitFixture({ stacks: workerPlatoons("human") });
  const started = startWorkerTransit(state, 0, "s0", "s1", map);
  assert.ok(started.ok && started.transit);
  const transit = started.transit!;
  assert.deepEqual(workerTransitTile(transit, ORIGIN), ORIGIN);
  const stepped = advanceWorkerTransit(transit).transit;
  assert.deepEqual(workerTransitTile(stepped, ORIGIN), stepped.path[stepped.pathIndex - 1]);
});

test("a transit is vulnerable (ambush-eligible) exactly until it arrives", () => {
  const state = transitFixture({ stacks: workerPlatoons("human") });
  const started = startWorkerTransit(state, 0, "s0", "s1", map);
  assert.ok(started.ok && started.transit);
  let transit = started.transit!;
  assert.equal(workerTransitIsVulnerable(transit), true);
  for (let i = 0; i < 50 && !workerTransitArrived(transit); i++) {
    transit = advanceWorkerTransit(transit).transit;
  }
  assert.equal(workerTransitIsVulnerable(transit), false);
});

test("resolveWorkerTransitAmbush always loses the worker (non-combat stats, auto-resolved)", () => {
  assert.deepEqual(resolveWorkerTransitAmbush(), { workerLost: true });
});
