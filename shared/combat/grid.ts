import type { Axial } from "@heroes/contracts";
import { mulberry32 } from "../rng";
import { DEFAULT_GRID_COLS, DEFAULT_GRID_ROWS, DEFAULT_OBSTACLE_COUNT } from "../combatConfig";
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
// Each side occupies one outer column (attacker on the left, defender on
// the right — see sideChoice); one platoon per row, but rows are spaced
// by 2 (rows 0, 2, 4, ...) so there's always one empty hex between
// adjacent deployed platoons. Without the gap the back column was a
// solid wall of overlapping tokens; with it each platoon has a clear
// "personal space" hex and movement from the back row isn't blocked by
// the slot next to it.
//
// Attacker is always on the left column (q=0) and defender always on
// the right column (q=cols-1) for this arena — sideChoice just picks
// which outer column the *attacker* starts on so the convention stays
// attacker-left / defender-right regardless.
export function deploymentPosition(
  side: BattleSide,
  slotIndex: number,
  grid: BattleGrid,
  sideChoice: BattleSide = "attacker",
): Axial {
  const r = Math.min(slotIndex * 2, grid.rows - 1);
  const onLeft = side === sideChoice;
  const col = onLeft ? 0 : grid.cols - 1;
  // Column → axial, matching the offset rows makeBattleGrid generates.
  return { q: col - rowShift(r), r };
}
