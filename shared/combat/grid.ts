import type { Axial } from "../../src/core/hex";
import { mulberry32 } from "../../src/core/rng";
import { DEFAULT_GRID_COLS, DEFAULT_GRID_ROWS, DEFAULT_OBSTACLE_COUNT } from "../combatConfig";
import type { BattleGrid, BattleHex, BattleSide } from "./types";

export { DEFAULT_GRID_COLS, DEFAULT_GRID_ROWS, DEFAULT_OBSTACLE_COUNT };

// A wide HoMM3-style battle grid: the two outer columns are reserved as each
// side's starting positions, obstacles scatter through the open middle.
// Obstacles come from either a seed (rerolled fresh each fight) or a
// previously-scouted `fixedObstacles` layout (see ResolveBattleOptions).
export function makeBattleGrid(
  cols: number,
  rows: number,
  obstacleCount: number,
  seed: number,
  fixedObstacles?: BattleHex[],
): BattleGrid {
  const hexes: BattleHex[] = [];
  for (let q = 0; q < cols; q++) {
    for (let r = 0; r < rows; r++) {
      hexes.push({ q, r, impassable: false });
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
  const candidates = hexes.filter((h) => h.q > 0 && h.q < cols - 1);
  const chosen = new Set<string>();
  const maxObstacles = Math.min(obstacleCount, candidates.length);
  while (chosen.size < maxObstacles) {
    const idx = Math.floor(rng() * candidates.length);
    chosen.add(`${candidates[idx].q},${candidates[idx].r}`);
  }
  for (const h of hexes) {
    if (chosen.has(`${h.q},${h.r}`)) h.impassable = true;
  }
  return { cols, rows, hexes };
}

// Deployment position for the platoon in ARMY_STACK_SLOTS slot `slotIndex`.
// Each side occupies one outer column, one platoon per row; `sideChoice`
// lets a scouting party pick which outer column (left/right) they start on.
export function deploymentPosition(
  side: BattleSide,
  slotIndex: number,
  grid: BattleGrid,
  sideChoice: BattleSide = "attacker",
): Axial {
  const r = Math.min(slotIndex, grid.rows - 1);
  const onLeft = side === sideChoice;
  return { q: onLeft ? 0 : grid.cols - 1, r };
}
