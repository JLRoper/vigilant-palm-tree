import type { Axial } from "@heroes/contracts";
import { mulberry32 } from "../rng";
import { DEFAULT_GRID_COLS, DEFAULT_GRID_ROWS, DEFAULT_OBSTACLE_COUNT } from "../combatConfig";
import { ARMY_STACK_SLOTS } from "../units";
import type { BattleGrid, BattleHex, BattleSide } from "./types";

export { DEFAULT_GRID_COLS, DEFAULT_GRID_ROWS, DEFAULT_OBSTACLE_COUNT };

// How far row `r`'s axial q-origin is shifted to cancel the half-hex stagger
// that the pointy-top pixel mapping (src/core/hex.ts: x = size·(√3·q + √3/2·r))
// adds to every successive row. This is the standard odd-r offset → axial
// conversion, q = col − ⌊r/2⌋.
//
// Without it, a rectangular (q, r) range renders as a rhombus: each row sits
// half a hex right of the one above, so a 15×15 grid spans √3 × 21 hex-size
// units horizontally instead of √3 × 14.5 — ~45% extra width for zero extra
// playable hexes, with the surplus showing up as two large empty triangles.
function rowShift(r: number): number {
  return Math.floor(r / 2);
}

// The grid column a hex belongs to, inverting rowShift. Callers that reason in
// "which column of the battlefield is this" — obstacle placement, deployment —
// must use this rather than raw `q`, which is now row-relative.
export function columnOf(hex: Axial): number {
  return hex.q + rowShift(hex.r);
}

// A wide HoMM3-style battle grid: the two outer columns are reserved as each
// side's starting positions, obstacles scatter through the open middle.
// Obstacles come from either a seed (rerolled fresh each fight) or a
// previously-scouted `fixedObstacles` layout (see ResolveBattleOptions).
//
// Cells are generated in offset coordinates so the field renders as a true
// rectangle (see rowShift). This changes only *which* axial cells exist — not
// the coordinate system — so hexDistance, the six axial neighbours, movement
// BFS and line-of-sight are all unaffected.
export function makeBattleGrid(
  cols: number,
  rows: number,
  obstacleCount: number,
  seed: number,
  fixedObstacles?: BattleHex[],
): BattleGrid {
  const hexes: BattleHex[] = [];
  for (let r = 0; r < rows; r++) {
    const shift = rowShift(r);
    for (let col = 0; col < cols; col++) {
      hexes.push({ q: col - shift, r, impassable: false });
    }
  }
  if (fixedObstacles) {
    const fixed = new Set(fixedObstacles.filter((h) => h.impassable).map((h) => `${h.q},${h.r}`));
    for (const h of hexes) {
      if (fixed.has(`${h.q},${h.r}`)) h.impassable = true;
    }
    return { cols, rows, hexes };
  }

  const rng = mulberry32(seed);
  // Column-based, not raw q: with offset rows, q alone no longer identifies a
  // column, and the outer columns must stay clear for deployment.
  const candidates = hexes.filter((h) => columnOf(h) > 0 && columnOf(h) < cols - 1);
  const chosen = new Set<string>();
  const maxObstacles = Math.min(obstacleCount, candidates.length);

  // Obstacle pattern types for varied, interesting layouts
  type ObstaclePattern = "single" | "pair" | "line" | "cluster" | "wall";

  // Hex neighbors in axial coordinates (pointy-top)
  const NEIGHBORS: Axial[] = [
    { q: 1, r: 0 }, { q: 0, r: 1 }, { q: -1, r: 1 },
    { q: -1, r: 0 }, { q: 0, r: -1 }, { q: 1, r: -1 }
  ];

  // Get all valid neighbors of a hex that are also in candidates
  function getValidNeighbors(hex: Axial): Axial[] {
    return NEIGHBORS.map(d => ({ q: hex.q + d.q, r: hex.r + d.r }))
      .filter(n => candidates.some(c => c.q === n.q && c.r === n.r && !chosen.has(`${n.q},${n.r}`)));
  }

  // Try to place a pattern starting from a seed hex
  function tryPlacePattern(startHex: Axial, pattern: ObstaclePattern): Axial[] | null {
    const placed: Axial[] = [startHex];
    chosen.add(`${startHex.q},${startHex.r}`);

    switch (pattern) {
      case "single":
        return placed;

      case "pair": {
        const neighbors = getValidNeighbors(startHex);
        if (neighbors.length === 0) return null;
        const partner = neighbors[Math.floor(rng() * neighbors.length)];
        placed.push(partner);
        chosen.add(`${partner.q},${partner.r}`);
        return placed;
      }

      case "line": {
        // Pick a direction and extend 2-4 more hexes
        const dirIdx = Math.floor(rng() * 6);
        const dir = NEIGHBORS[dirIdx];
        const lineLength = 3 + Math.floor(rng() * 3); // 3-5 tiles
        let current = startHex;
        for (let i = 1; i < lineLength; i++) {
          const next = { q: current.q + dir.q, r: current.r + dir.r };
          if (!candidates.some(c => c.q === next.q && c.r === next.r && !chosen.has(`${next.q},${next.r}`))) {
            break;
          }
          placed.push(next);
          chosen.add(`${next.q},${next.r}`);
          current = next;
        }
        return placed.length >= 2 ? placed : null;
      }

      case "cluster": {
        // Grow a blob around the seed (3-6 tiles)
        const clusterSize = 3 + Math.floor(rng() * 4);
        const frontier = [...getValidNeighbors(startHex)];
        while (placed.length < clusterSize && frontier.length > 0) {
          const idx = Math.floor(rng() * frontier.length);
          const next = frontier[idx];
          frontier.splice(idx, 1);
          if (chosen.has(`${next.q},${next.r}`)) continue;
          placed.push(next);
          chosen.add(`${next.q},${next.r}`);
          frontier.push(...getValidNeighbors(next));
        }
        return placed.length >= 2 ? placed : null;
      }

      case "wall": {
        // A short wall: 4-6 tiles in a line, perpendicular to center
        const cx = 0; // center column
        const isLeft = startHex.q < cx;
        // Wall runs roughly vertical (along r axis)
        const dir = isLeft ? { q: 0, r: 1 } : { q: 0, r: 1 };
        const wallLength = 4 + Math.floor(rng() * 3); // 4-6 tiles
        let current = startHex;
        for (let i = 1; i < wallLength; i++) {
          const next = { q: current.q + dir.q, r: current.r + dir.r };
          if (!candidates.some(c => c.q === next.q && c.r === next.r && !chosen.has(`${next.q},${next.r}`))) {
            break;
          }
          placed.push(next);
          chosen.add(`${next.q},${next.r}`);
          current = next;
        }
        return placed.length >= 3 ? placed : null;
      }
    }
    return null;
  }

  // Pattern weights - can be adjusted per biome later
  const patternWeights: { pattern: ObstaclePattern; weight: number }[] = [
    { pattern: "single", weight: 30 },
    { pattern: "pair", weight: 20 },
    { pattern: "line", weight: 20 },
    { pattern: "cluster", weight: 20 },
    { pattern: "wall", weight: 10 },
  ];
  const totalWeight = patternWeights.reduce((sum, p) => sum + p.weight, 0);

  // Place obstacles using patterns until we run out of budget or candidates
  const candidateList = [...candidates];
  let obstaclesPlaced = 0;
  while (obstaclesPlaced < maxObstacles && candidateList.length > 0) {
    // Pick a random unused candidate as seed
    const seedIdx = Math.floor(rng() * candidateList.length);
    const seedHex = candidateList[seedIdx];
    if (chosen.has(`${seedHex.q},${seedHex.r}`)) {
      candidateList.splice(seedIdx, 1);
      continue;
    }

    // Pick a pattern weighted
    let roll = rng() * totalWeight;
    let selectedPattern: ObstaclePattern = "single";
    for (const pw of patternWeights) {
      roll -= pw.weight;
      if (roll <= 0) {
        selectedPattern = pw.pattern;
        break;
      }
    }

    // Try to place it
    const placed = tryPlacePattern(seedHex, selectedPattern);
    if (placed) {
      obstaclesPlaced += placed.length;
    } else {
      // Fallback to single
      chosen.add(`${seedHex.q},${seedHex.r}`);
      obstaclesPlaced += 1;
    }
    candidateList.splice(seedIdx, 1);
  }

  for (const h of hexes) {
    if (chosen.has(`${h.q},${h.r}`)) h.impassable = true;
  }
  return { cols, rows, hexes };
}

// Deployment position for the platoon in ARMY_STACK_SLOTS slot `slotIndex`.
// Each side occupies one outer column (whichever role sideChoice names on the
// left, the other on the right — see below); one platoon per row, spread evenly across
// however many rows the grid has via `slotIndex * (rows-1)/(SLOTS-1)`,
// rounded to the nearest row. At the original 15-row grid this lands
// exactly on rows 0, 2, 4, ..., 14 (spacing 2) — the gap so there's always
// an empty hex between adjacent platoons, which stops the back column
// being a solid wall of overlapping tokens and keeps movement from the
// back row from being blocked by the slot next to it. On a shorter grid
// the same formula keeps every slot on a distinct row (no two platoons
// ever collide) but the spacing drops toward 1, so some adjacent platoons
// lose that gap.
//
// `sideChoice` names the role that takes the LEFT column (q=0); the other
// role takes the right column (q=cols-1). Renderers whose sprite facing
// assumes the fixed attacker-left / defender-right arrangement (defender
// art mirrored to face left) pass sideChoice "attacker", the default —
// passing the human's role instead deploys both armies on the wrong edges
// and leaves them facing away from each other.
export function deploymentPosition(
  side: BattleSide,
  slotIndex: number,
  grid: BattleGrid,
  sideChoice: BattleSide = "attacker",
): Axial {
  const r = Math.round((slotIndex * (grid.rows - 1)) / (ARMY_STACK_SLOTS - 1));
  const onLeft = side === sideChoice;
  const col = onLeft ? 0 : grid.cols - 1;
  // Column → axial, matching the offset rows makeBattleGrid generates.
  return { q: col - rowShift(r), r };
}
