import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GameMap,
  NEIGHBOR_DIRS,
  RIVER_BODY_TERRAINS,
  RIVER_BLOCKED_TERRAINS,
  RIVER_BRIDGE_CROSS_COST,
  RIVER_SMALL_CROSS_COST,
  generateCastles,
  minRiverLength,
  riverCountForMap,
  type RiverTile,
} from "@heroes/engine";
import { MOVEMENT_PER_TURN } from "@heroes/contracts";

function adjacentToBody(map: GameMap, q: number, r: number): boolean {
  for (const d of NEIGHBOR_DIRS) {
    const t = map.get(q + d.q, r + d.r);
    if (t && RIVER_BODY_TERRAINS.has(t)) return true;
  }
  return false;
}

/** Split the flat placedRivers list into systems (consecutive runs of one kind). */
function systems(map: GameMap): RiverTile[][] {
  const out: RiverTile[][] = [];
  let cur: RiverTile[] = [];
  let curKind: string | null = null;
  for (const t of map.placedRivers) {
    if (curKind !== null && t.kind !== curKind) {
      out.push(cur);
      cur = [];
    }
    curKind = t.kind;
    cur.push(t);
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

test("small crossing costs a full day and a bridge costs a normal step", () => {
  assert.equal(RIVER_SMALL_CROSS_COST, MOVEMENT_PER_TURN);
  assert.equal(MOVEMENT_PER_TURN, 7);
  assert.equal(RIVER_BRIDGE_CROSS_COST, 1);
});

test("river counts scale with map size, never below two", () => {
  assert.equal(riverCountForMap(24, 18), 2);
  assert.equal(minRiverLength(24, 18), 8);
  const big = riverCountForMap(120, 90);
  assert.ok(big > 2, `epic map should grow past 2 systems, got ${big}`);
  assert.ok(riverCountForMap(300, 225) <= 10, "cap at 10 systems");
});

test("rivers exist only from v5, and v5 leaves the v4 terrain byte-identical", () => {
  for (let seed = 1; seed <= 8; seed++) {
    const v4 = new GameMap(seed, "small", 4);
    assert.equal(v4.placedRivers.length, 0, "v4 carries no rivers");
    const v5 = new GameMap(seed, "small", 5);
    assert.ok(v5.placedRivers.length > 0, `v5 seed ${seed} generated no rivers`);
    assert.deepEqual(v5.tiles, v4.tiles, "v5 must not re-roll the terrain grid");
  }
});

test("every river starts and ends on a body of water (or swamp)", () => {
  for (let seed = 1; seed <= 8; seed++) {
    const map = new GameMap(seed, "large", 5);
    for (const sys of systems(map)) {
      const head = sys[0];
      const tail = sys[sys.length - 1];
      assert.ok(adjacentToBody(map, head.q, head.r), `seed ${seed} head not on water`);
      assert.ok(adjacentToBody(map, tail.q, tail.r), `seed ${seed} tail not on water`);
    }
  }
});

test("rivers never sit on water, mountain or dense forest", () => {
  for (let seed = 1; seed <= 10; seed++) {
    const map = new GameMap(seed, "large", 5);
    for (const tile of map.placedRivers) {
      const terrain = map.get(tile.q, tile.r)!;
      assert.ok(!RIVER_BLOCKED_TERRAINS.has(terrain), `seed ${seed} river on ${terrain}`);
    }
  }
});

test("wide and small both appear, bridges only on wide rivers", () => {
  const kinds = new Set<string>();
  let bridges = 0;
  let wideSystems = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const map = new GameMap(seed, "small", 5);
    for (const sys of systems(map)) {
      kinds.add(sys[0].kind);
      if (sys[0].kind === "wide") {
        wideSystems++;
        assert.ok(
          sys.some((t) => t.bridge),
          `seed ${seed} wide river has no bridge`,
        );
      } else {
        assert.ok(sys.every((t) => !t.bridge), `seed ${seed} small river has a bridge`);
      }
      for (const t of sys) if (t.bridge) bridges++;
    }
  }
  assert.ok(kinds.has("small") && kinds.has("wide"), "both river kinds must appear");
  assert.ok(wideSystems > 0 && bridges > 0, "bridges must exist");
});

test("movement rules: small costs a day, wide is impassable except at bridges", () => {
  const map = new GameMap(7, "small", 5);
  const small = map.placedRivers.find((t) => t.kind === "small")!;
  const widePlain = map.placedRivers.find((t) => t.kind === "wide" && !t.bridge)!;
  const wideBridge = map.placedRivers.find((t) => t.bridge)!;

  assert.equal(map.cost(small.q, small.r), MOVEMENT_PER_TURN);
  assert.equal(map.isPassable(small.q, small.r), true);
  assert.equal(map.cost(widePlain.q, widePlain.r), Infinity);
  assert.equal(map.isPassable(widePlain.q, widePlain.r), false);
  assert.equal(map.cost(wideBridge.q, wideBridge.r), RIVER_BRIDGE_CROSS_COST);
  assert.equal(map.isPassable(wideBridge.q, wideBridge.r), true);
});

test("no two river systems share a cell, and no cell touches more than two river cells", () => {
  for (let seed = 1; seed <= 10; seed++) {
    const map = new GameMap(seed, "large", 5);
    const seen = new Map<string, number>();
    for (const t of map.placedRivers) {
      const key = `${t.q},${t.r}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    for (const [key, n] of seen) {
      assert.equal(n, 1, `cell ${key} shared by rivers`);
    }
    for (const t of map.placedRivers) {
      let riverNeighbours = 0;
      for (const d of NEIGHBOR_DIRS) {
        if (map.riverAt(t.q + d.q, t.r + d.r)) riverNeighbours++;
      }
      assert.ok(riverNeighbours <= 2, `river cell ${t.q},${t.r} has a 3+ way junction`);
    }
  }
});

test("rivers never carry a resource deposit", () => {
  for (let seed = 1; seed <= 6; seed++) {
    const map = new GameMap(seed, "large", 5);
    for (const tile of map.placedResourceTiles) {
      assert.equal(map.riverAt(tile.q, tile.r), undefined, "resource on a river cell");
    }
  }
});

test("castles never land on a river cell", () => {
  for (let seed = 1; seed <= 6; seed++) {
    const map = new GameMap(seed, "small", 5);
    const castles = generateCastles(map, { castleSeed: seed, playerCount: 1, castleCount: 3 });
    for (const c of castles) {
      assert.equal(map.riverAt(c.tile.q, c.tile.r), undefined, "castle on a river cell");
    }
  }
});

test("hero spawn stays passable even if a river ran through it", () => {
  for (let seed = 1; seed <= 10; seed++) {
    const map = new GameMap(seed, "small", 5);
    assert.equal(map.isPassable(2, 2), true, "spawn blocked");
  }
});

test("generation is deterministic per seed", () => {
  const a = new GameMap(42, "large", 5);
  const b = new GameMap(42, "large", 5);
  assert.deepEqual(a.placedRivers, b.placedRivers);
  assert.deepEqual(a.tiles, b.tiles);
});