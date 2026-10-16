import type { GameState, HeroState, SettlementState, TradeRouteState } from "@heroes/contracts";
import {
  formatStoragePercentage,
  getEndpointStorage,
  getRouteProgress,
  getRouteTooltipText,
  getStorageMeterState,
  STORAGE_GAUGE_FRAME_COUNT,
  STORAGE_GAUGE_HEIGHT,
} from "../../../src/screens/logistics/routeVisualization";
import { test } from "node:test";
import assert from "node:assert/strict";

function stateFixture(): Pick<GameState, "heroes" | "settlements"> {
  const hero = {
    id: "h1",
    name: "Courier",
    ownerId: 0,
    q: 6,
    r: 0,
    gold: 250,
    wagons: 3,
    treasuryWagons: 2,
    horseVariant: "hero",
    resources: { wood: 20, stone: 0, iron: 0, arcane: 0, food: 75 },
  } as HeroState;
  const settlement = {
    id: "s1",
    name: "Keep",
    ownerId: 0,
    q: 0,
    r: 0,
    level: 1,
    gold: 750,
    warehouse: { wood: 250, stone: 0, iron: 0, arcane: 0, food: 60 },
    buildings: [],
  } as unknown as SettlementState;
  return {
    heroes: { h1: hero },
    settlements: { s1: settlement },
  };
}

function route(overrides: Partial<TradeRouteState> = {}): TradeRouteState {
  return {
    id: "r1",
    from: { kind: "settlement", id: "s1" },
    to: { kind: "hero", id: "h1" },
    payload: { kind: "resource", resource: "wood" },
    wagons: 1,
    caravan: null,
    ...overrides,
  };
}

test("endpoint storage reads the correct warehouse, larder, purse, and treasure caps", () => {
  const state = stateFixture();

  assert.deepEqual(
    getEndpointStorage(state, { kind: "settlement", id: "s1" }, { kind: "resource", resource: "wood" }),
    { storeName: "Warehouse", resourceName: "wood", amount: 250, capacity: 500 },
  );
  assert.deepEqual(
    getEndpointStorage(state, { kind: "hero", id: "h1" }, { kind: "resource", resource: "food" }),
    { storeName: "Larder", resourceName: "food", amount: 75, capacity: 150 },
  );
  assert.deepEqual(
    getEndpointStorage(state, { kind: "hero", id: "h1" }, { kind: "gold" }),
    { storeName: "Treasure", resourceName: "gold", amount: 250, capacity: 1000 },
  );
  assert.deepEqual(
    getEndpointStorage(state, { kind: "settlement", id: "s1" }, { kind: "gold" }),
    { storeName: "Treasury", resourceName: "gold", amount: 750, capacity: 1500 },
  );
  assert.equal(getEndpointStorage(state, { kind: "hero", id: "missing" }, { kind: "gold" }), null);
});

test("storage meter exposes exact percentage and a bounded one-of-twelve gauge frame", () => {
  assert.deepEqual(getStorageMeterState(50, 200), {
    percentage: 25,
    fillPercentage: 25,
    frameIndex: 2,
    tone: "low",
  });
  assert.equal(STORAGE_GAUGE_FRAME_COUNT, 12);
  assert.equal(STORAGE_GAUGE_HEIGHT, 40);
  assert.equal(getStorageMeterState(50, 100).tone, "medium");
  assert.equal(getStorageMeterState(30, 100).tone, "medium");
  assert.equal(getStorageMeterState(32, 100).tone, "medium");
  assert.equal(getStorageMeterState(68, 100).tone, "medium");
  assert.equal(getStorageMeterState(69, 100).tone, "medium");
  assert.equal(getStorageMeterState(70, 100).tone, "high");
  assert.equal(getStorageMeterState(80, 100).tone, "high");
  assert.deepEqual(getStorageMeterState(125, 100), {
    percentage: 125,
    fillPercentage: 100,
    frameIndex: 11,
    tone: "high",
  });
  assert.equal(getStorageMeterState(1, 0).percentage, null);
  assert.equal(getStorageMeterState(1, 0).frameIndex, 0);
  assert.equal(formatStoragePercentage(50.06), "50.1%");
  assert.equal(formatStoragePercentage(null), "N/A");
});

test("route hover details include endpoint stock, journey status, progress, and cargo", () => {
  const details = getRouteTooltipText(
    stateFixture(),
    route({
      caravan: {
        phase: "toDestination",
        cargo: 21.5,
        path: [{ q: 0, r: 0 }, { q: 1, r: 0 }],
        pathIndex: 1,
      },
    }),
  );

  assert.match(details, /From: Settlement: Keep/);
  assert.match(details, /Source storage: Warehouse wood: 250 \/ 500 \(50% full\)/);
  assert.match(details, /To: Hero: Courier/);
  assert.match(details, /Destination storage: Cargo wood: 20 \/ 150 \(13\.3% full\)/);
  assert.match(details, /Status: To destination/);
  assert.match(details, /Leg progress: 0%/);
  assert.match(details, /Cargo: 21\.5 wood aboard/);
});

test("route travel percentage follows the caravan along outbound and return legs", () => {
  assert.deepEqual(getRouteProgress(route()), {
    direction: "loading",
    legPercentage: 0,
    positionPercentage: 0,
    waitingAtDestination: false,
  });

  const path = Array.from({ length: 10 }, (_, q) => ({ q, r: 0 }));
  assert.deepEqual(
    getRouteProgress(route({ caravan: { phase: "toDestination", cargo: 80, path, pathIndex: 4 } })),
    {
      direction: "outbound",
      legPercentage: 40,
      positionPercentage: 40,
      waitingAtDestination: false,
    },
  );
  assert.equal(
    getRouteProgress(route({ caravan: { phase: "toDestination", cargo: 5, path, pathIndex: 10 } }))
      .waitingAtDestination,
    true,
  );

  const returnPath = Array.from({ length: 6 }, (_, q) => ({ q, r: 0 }));
  assert.deepEqual(
    getRouteProgress(route({ caravan: { phase: "toHome", cargo: 0, path: returnPath, pathIndex: 3 } })),
    {
      direction: "returning",
      legPercentage: 40,
      positionPercentage: 60,
      waitingAtDestination: false,
    },
  );
  assert.deepEqual(
    getRouteProgress(route({ caravan: { phase: "toHome", cargo: 0, path: returnPath, pathIndex: 6 } })),
    {
      direction: "returning",
      legPercentage: 100,
      positionPercentage: 0,
      waitingAtDestination: false,
    },
  );
});

test("hero endpoints keep the marker positioned after a moving-target repath", () => {
  const state = stateFixture();
  const outbound = route({
    caravan: {
      phase: "toDestination",
      cargo: 50,
      path: [{ q: 3, r: 0 }, { q: 4, r: 0 }, { q: 5, r: 0 }, { q: 6, r: 0 }],
      pathIndex: 1,
    },
  });
  assert.equal(getRouteProgress(outbound, state).positionPercentage, 50);

  const returning = route({
    caravan: {
      phase: "toHome",
      cargo: 0,
      path: [{ q: 3, r: 0 }, { q: 2, r: 0 }, { q: 1, r: 0 }, { q: 0, r: 0 }],
      pathIndex: 1,
    },
  });
  assert.equal(getRouteProgress(returning, state).positionPercentage, 50);
});
