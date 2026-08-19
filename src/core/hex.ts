export type Axial = { q: number; r: number };

export const HEX_SIZE = 32;

const SQRT3 = Math.sqrt(3);

// The six axial neighbour offsets, in edge order: index `i` is the neighbour
// across edge `i`, and edge `i` spans corners `i` and `i+1` from hexCorners
// below. Because those corners sit at 60i-30 degrees, edge i's midpoint sits
// at exactly 60i degrees — which is what lets nearestHexEdge convert a
// pointer angle straight into an index here.
//
// Canonical copy for src/ — src/screens/combat/manualBattleArena.ts walks it
// for edge/direction lookups in the manual battle screen. packages/contracts/
// src/geometry.ts carries its own duplicate for engine-side code (walked by
// packages/engine/src/control.ts, combat/manualBattle.ts, and hero/move.ts),
// since @heroes/contracts may not import from src/ — see dependency-cruiser
// .cjs's contracts-is-a-leaf rule. Keep both arrays edge-aligned if the
// ordering ever changes.
export const HEX_DIRECTIONS: readonly Axial[] = [
  { q: 1, r: 0 },
  { q: 0, r: 1 },
  { q: -1, r: 1 },
  { q: -1, r: 0 },
  { q: 0, r: -1 },
  { q: 1, r: -1 },
];

// Which of a hex's six edges a point lies toward, given the hex's centre.
// Returns 0-5, indexing directly into HEX_DIRECTIONS.
export function nearestHexEdge(cx: number, cy: number, px: number, py: number): number {
  const deg = (Math.atan2(py - cy, px - cx) * 180) / Math.PI;
  return ((Math.round(deg / 60) % 6) + 6) % 6;
}

export function axialToPixel(q: number, r: number, size = HEX_SIZE): { x: number; y: number } {
  const x = size * (SQRT3 * q + (SQRT3 / 2) * r);
  const y = size * (1.5 * r);
  return { x, y };
}

export function pixelToAxial(x: number, y: number, size = HEX_SIZE): Axial {
  const { q, r } = pixelToAxialExact(x, y, size);
  return axialRound(q, r);
}

// Same projection as pixelToAxial but without snapping to the nearest hex.
// Used where the fractional position matters (e.g. camera-viewport corners
// for the minimap FOV frame) — rounding here would make those jitter.
export function pixelToAxialExact(x: number, y: number, size = HEX_SIZE): { q: number; r: number } {
  const q = ((SQRT3 / 3) * x - (1 / 3) * y) / size;
  const r = ((2 / 3) * y) / size;
  return { q, r };
}

export function axialRound(qf: number, rf: number): Axial {
  const sf = -qf - rf;
  let q = Math.round(qf);
  let r = Math.round(rf);
  const s = Math.round(sf);
  const dq = Math.abs(q - qf);
  const dr = Math.abs(r - rf);
  const ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return { q, r };
}

export function hexCorners(cx: number, cy: number, size = HEX_SIZE): { x: number; y: number }[] {
  const corners: { x: number; y: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = Math.PI / 180 * (60 * i - 30);
    corners.push({ x: cx + size * Math.cos(angle), y: cy + size * Math.sin(angle) });
  }
  return corners;
}

export function hexDistance(a: Axial, b: Axial): number {
  return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
}
