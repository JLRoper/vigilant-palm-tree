import { test } from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { GameMap, findPath, hexDistance, computePathCost, type Axial } from "@heroes/engine";

function referenceFindPath(map: GameMap, start: Axial, goal: Axial, blockedHexes?: Set<string>): Axial[] {
  if (!map.isPassable(goal.q, goal.r)) return [];
  if (start.q === goal.q && start.r === goal.r) return [];
  if (blockedHexes?.has(`${goal.q},${goal.r}`)) return [];

  const key = (a: Axial) => `${a.q},${a.r}`;
  const open: Axial[] = [start];
  const cameFrom = new Map<string, string>();
  const gScore = new Map<string, number>();
  const fScore = new Map<string, number>();

  gScore.set(key(start), 0);
  fScore.set(key(start), hexDistance(start, goal));

  const dirs: Axial[] = [
    { q: 1, r: 0 },
    { q: 1, r: -1 },
    { q: 0, r: -1 },
    { q: -1, r: 0 },
    { q: -1, r: 1 },
    { q: 0, r: 1 },
  ];

  while (open.length > 0) {
    let bestIdx = 0;
    let bestF = Infinity;
    for (let i = 0; i < open.length; i++) {
      const f = fScore.get(key(open[i])) ?? Infinity;
      if (f < bestF) {
        bestF = f;
        bestIdx = i;
      }
    }
    const current = open.splice(bestIdx, 1)[0];
    if (current.q === goal.q && current.r === goal.r) {
      const path: Axial[] = [current];
      let cur = `${current.q},${current.r}`;
      while (cameFrom.has(cur)) {
        const prev = cameFrom.get(cur)!;
        const [q, r] = prev.split(",").map(Number);
        path.unshift({ q, r });
        cur = prev;
      }
      return path.slice(1);
    }

    for (const dir of dirs) {
      const nq = current.q + dir.q;
      const nr = current.r + dir.r;
      if (!map.isPassable(nq, nr)) continue;
      const nKey = `${nq},${nr}`;
      if (blockedHexes?.has(nKey)) continue;
      const tentative = (gScore.get(key(current)) ?? Infinity) + map.cost(nq, nr);
      if (tentative < (gScore.get(nKey) ?? Infinity)) {
        cameFrom.set(nKey, key(current));
        gScore.set(nKey, tentative);
        fScore.set(nKey, tentative + hexDistance({ q: nq, r: nr }, goal));
        if (!open.some((o) => o.q === nq && o.r === nr)) {
          open.push({ q: nq, r: nr });
        }
      }
    }
  }
  return [];
}

test("findPath returns [] in < 1 ms on an epic (120x90) map when goal is in blockedHexes", () => {
  const map = new GameMap(42, "epic");
  const start = { q: 2, r: 2 };
  const goal = { q: 60, r: 45 };
  map.tiles[goal.r * map.width + goal.q] = "grass";
  const blocked = new Set<string>([`${goal.q},${goal.r}`]);

  // Warmup
  findPath(map, start, goal, blocked);

  const t0 = performance.now();
  const path = findPath(map, start, goal, blocked);
  const elapsedMs = performance.now() - t0;

  assert.deepEqual(path, []);
  assert.ok(elapsedMs < 1, `expected blocked-goal early exit < 1 ms, got ${elapsedMs.toFixed(4)} ms`);
});

test("corner-to-corner findPath on epic (120x90) completes in < 5 ms and returns a continuous passable path excluding start", () => {
  const map = new GameMap(42, "epic");
  const start = { q: 0, r: 0 };
  const goal = { q: map.width - 1, r: map.height - 1 };
  map.tiles[0] = "grass";
  map.tiles[goal.r * map.width + goal.q] = "grass";

  // Warmup
  findPath(map, start, goal);

  const t0 = performance.now();
  const path = findPath(map, start, goal);
  const elapsedMs = performance.now() - t0;

  assert.ok(path.length > 0, "expected a valid corner-to-corner path on seed 42 epic map");
  assert.ok(elapsedMs < 5, `expected epic corner-to-corner findPath < 5 ms, got ${elapsedMs.toFixed(3)} ms`);
  assert.notDeepEqual(path[0], start, "path excludes start");
  assert.deepEqual(path[path.length - 1], goal, "path ends at goal");

  let prev = start;
  for (const step of path) {
    assert.equal(hexDistance(prev, step), 1, "each step is adjacent to previous");
    assert.ok(map.isPassable(step.q, step.r), `step (${step.q},${step.r}) is passable`);
    prev = step;
  }
});

test("findPath matches reference shortest paths and FIFO tie-breaking across uniform, weighted, and blocked terrains", () => {
  const smallMap = new GameMap(7, "small");
  const largeMap = new GameMap(19, "large");

  const cases: Array<{ map: GameMap; start: Axial; goal: Axial; blocked?: Set<string> }> = [
    { map: smallMap, start: { q: 2, r: 2 }, goal: { q: 18, r: 12 } },
    { map: smallMap, start: { q: 2, r: 2 }, goal: { q: 15, r: 10 }, blocked: new Set(["5,4", "6,4", "7,4"]) },
    { map: largeMap, start: { q: 2, r: 2 }, goal: { q: 40, r: 30 }, blocked: new Set(["10,8", "11,8", "12,8"]) },
  ];

  for (const c of cases) {
    c.map.tiles[c.start.r * c.map.width + c.start.q] = "grass";
    c.map.tiles[c.goal.r * c.map.width + c.goal.q] = "grass";
    const actual = findPath(c.map, c.start, c.goal, c.blocked);
    const expected = referenceFindPath(c.map, c.start, c.goal, c.blocked);
    assert.equal(
      computePathCost(c.map, [c.start, ...actual]),
      computePathCost(c.map, [c.start, ...expected]),
    );
    assert.deepEqual(actual, expected);
  }
});
