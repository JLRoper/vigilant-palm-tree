// Regression tests for the logistics fix plan (folded into the test:unit glob).
// Run: npx tsx --test test/logistics-bugs/logistics.caravanAdvance.test.ts
//
// BUG L7 (FIXED): after a destination-side hero chase the return leg used to be only the
//   REVERSED CHASE LEG — the caravan walked back to the chase-START tile, then teleported
//   home to reload. The fix rebuilds the return leg on every toDestination->toHome flip as
//   a fresh path from the caravan's REAL tile to the origin endpoint's CURRENT tile
//   (logistics.ts returnLegCaravan), so the caravan physically walks home and deposits
//   where it stands. This test now PINS THE FIXED BEHAVIOR.
// Evidence refs: packages/engine/src/logistics.ts returnLegCaravan + the three flip sites
//   in advanceTradeRoutes; docs/wagons-stockpiles-trade-routes-plan.md §5.2.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  advanceTradeRoutes,
  CARAVAN_TILES_PER_DAY,
  createTradeRoute,
  findPath,
  GameMap,
  hexDistance,
  NEIGHBOR_DIRS,
  type GameState,
} from "@heroes/engine";
import type { TradeRouteEndpoint, TradeRoutePayload } from "@heroes/contracts";
import { emptyWarehouse, makeHero, makeSettlement, makeState } from "../charter/_helpers";

const settlementEndpoint = (id: string): TradeRouteEndpoint => ({ kind: "settlement", id });
const heroEndpoint = (id: string): TradeRouteEndpoint => ({ kind: "hero", id });
const GOLD: TradeRoutePayload = { kind: "gold" };

function grantWagons(state: GameState, unassigned: number): GameState {
  return {
    ...state,
    players: state.players.map((p) =>
      p.id === 0 ? { ...p, wagonsOwned: unassigned, wagonsUnassigned: unassigned } : p,
    ),
  };
}

function reachableDistantPair(map: GameMap, minDist = 5): Array<{ q: number; r: number }> {
  const passable: Array<{ q: number; r: number }> = [];
  for (let r = 0; r < map.height; r++) {
    for (let q = 0; q < map.width; q++) {
      if (map.isPassable(q, r)) passable.push({ q, r });
    }
  }
  for (const a of passable) {
    for (const b of passable) {
      if (hexDistance(a, b) >= minDist && findPath(map, a, b).length > 0) return [a, b];
    }
  }
  throw new Error(`no reachable passable pair at distance >= ${minDist} on this map`);
}

test("after a destination-side chase the return leg is a real path from the delivery tile back to the origin's current tile", () => {
  const map = new GameMap(73, "small");
  const [a, b] = reachableDistantPair(map);
  const hero = { ...makeHero("h0", 0, b.q, b.r), resources: emptyWarehouse() };
  const origin = makeSettlement("s0", 0, a.q, a.r, { gold: 2500 });
  const state = grantWagons(
    makeState({ heroes: [hero], settlements: [origin], activePlayerId: 0 }),
    1,
  );
  const created = createTradeRoute(state, 0, settlementEndpoint("s0"), heroEndpoint("h0"), GOLD, 1);
  assert.equal(created.ok, true, created.reason);

  const departed = advanceTradeRoutes(created.state, map);
  assert.ok(departed.tradeRoutes[0].caravan, "wrap 1 departed with 500 gold (precondition)");

  // The hero moves one tile off the caravan's path end; the caravan must chase and deliver there.
  const neighbor = NEIGHBOR_DIRS.map((d) => ({ q: b.q + d.q, r: b.r + d.r })).find((t) =>
    map.isPassable(t.q, t.r),
  );
  assert.ok(neighbor, "fixture: b has a passable neighbor tile");
  let current: GameState = {
    ...departed,
    heroes: {
      ...departed.heroes,
      h0: { ...departed.heroes.h0, q: neighbor!.q, r: neighbor!.r },
    },
  };

  let delivered = false;
  for (let i = 0; i < 30 && !delivered; i++) {
    current = advanceTradeRoutes(current, map);
    delivered = current.heroes.h0.gold >= 500;
  }
  assert.ok(delivered, "precondition: the chase caught up and delivered");

  const returnCaravan = current.tradeRoutes[0].caravan!;
  assert.equal(returnCaravan.phase, "toHome", "the delivery flipped the caravan homeward (precondition)");
  assert.notEqual(
    `${a.q},${a.r}`,
    `${b.q},${b.r}`,
    "fixture sanity: origin and chase-start tile are distinct",
  );
  // The return leg starts at the caravan's REAL tile -- the chased hero's
  // tile, not the stale outbound path end.
  assert.equal(
    `${returnCaravan.path[0].q},${returnCaravan.path[0].r}`,
    `${neighbor!.q},${neighbor!.r}`,
    "the return leg starts at the delivery tile the caravan physically occupies",
  );
  assert.equal(
    returnCaravan.pathIndex,
    1,
    "pathIndex is 1 from the flip onward, so caravanTile reports the real departure tile (no origin-ward marker jump)",
  );
  const returnEnd = returnCaravan.path[returnCaravan.path.length - 1];
  assert.equal(
    `${returnEnd.q},${returnEnd.r}`,
    `${a.q},${a.r}`,
    "the return path ends at the ORIGIN's current tile -- arrival deposits where the caravan physically stands",
  );
  const legHome = findPath(map, { q: neighbor!.q, r: neighbor!.r }, { q: a.q, r: a.r });
  assert.ok(legHome.length > 0, "fixture: a path home exists");
  assert.equal(
    returnCaravan.path.length,
    1 + legHome.length,
    "the return path is the walked route home, not the truncated chase leg",
  );

  // The caravan walks the whole leg home before it may reload: exactly
  // ceil(leg / 4) wraps, vanishing only at the end -- the instant vanish and
  // the teleport reload are gone.
  let wraps = 0;
  while (current.tradeRoutes[0].caravan !== null && wraps < 30) {
    current = advanceTradeRoutes(current, map);
    wraps += 1;
  }
  assert.equal(current.tradeRoutes[0].caravan, null, "the caravan eventually arrives home");
  assert.equal(
    wraps,
    Math.ceil(legHome.length / CARAVAN_TILES_PER_DAY),
    "it walked one wrap per 4 tiles of the real leg home",
  );

  // And the cycle resumes normally: the next wrap reloads at the origin --
  // AFTER the physical walk, not instead of it.
  current = advanceTradeRoutes(current, map);
  const reloaded = current.tradeRoutes[0].caravan;
  assert.ok(reloaded, "the caravan reloads at the origin the wrap after arriving home");
  assert.equal(reloaded?.cargo, 500, "the reload carries the full 500 gold again");
  assert.equal(reloaded?.phase, "toDestination");
});
