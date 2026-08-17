import type { CityViewSize } from "@heroes/engine";

export type CityCell = { gx: number; gy: number };

export const TILE_W = 96;
export const TILE_D = TILE_W * 0.5;

export function cellOrigin(size: CityViewSize): { x: number; y: number } {
  const c = (size - 1) / 2;
  return { x: c, y: c };
}

export function cellToScreen(
  gx: number,
  gy: number,
  origin: { x: number; y: number },
): { x: number; y: number } {
  return {
    x: origin.x + (gx - gy) * TILE_W / 2,
    y: origin.y + (gx + gy) * TILE_D / 2,
  };
}

export function screenToCell(
  sx: number,
  sy: number,
  origin: { x: number; y: number },
): { gx: number; gy: number } {
  const wx = sx - origin.x;
  const wy = sy - origin.y;
  return {
    gx: wx / TILE_W + wy / TILE_D,
    gy: wy / TILE_D - wx / TILE_W,
  };
}

export function cellAt(
  sx: number,
  sy: number,
  origin: { x: number; y: number },
  size: CityViewSize,
): CityCell | null {
  const { gx, gy } = screenToCell(sx, sy, origin);
  const gxI = Math.floor(gx);
  const gyI = Math.floor(gy);
  if (gxI < 0 || gxI >= size || gyI < 0 || gyI >= size) return null;
  return { gx: gxI, gy: gyI };
}

export function cellCorners(
  gx: number,
  gy: number,
  origin: { x: number; y: number },
): Array<{ x: number; y: number }> {
  const c = cellToScreen(gx, gy, origin);
  const hw = TILE_W / 2;
  const hh = TILE_D / 2;
  return [
    { x: c.x, y: c.y - hh },
    { x: c.x + hw, y: c.y },
    { x: c.x, y: c.y + hh },
    { x: c.x - hw, y: c.y },
  ];
}

// Pure -- lives here (not cityRenderer.ts) so it stays importable from
// contexts without a bundler asset pipeline (e.g. plain node:test), since
// cityRenderer.ts also pulls in Vite `?url` PNG imports at module scope.
export function computeCityScale(
  size: CityViewSize,
  viewportW: number,
  viewportH: number,
): number {
  if (size <= 10) return 1.0;
  const limitW = viewportW * 0.85;
  const limitH = viewportH * 0.85;
  const maxW = limitW / (size * TILE_W);
  const maxH = limitH / (size * TILE_D);
  return Math.min(1, maxW, maxH);
}

export function cellsInDrawOrder(size: CityViewSize): CityCell[] {
  const out: CityCell[] = [];
  for (let s = 0; s <= 2 * (size - 1); s++) {
    const gxMax = Math.min(s, size - 1);
    const gxMin = Math.max(0, s - (size - 1));
    for (let gx = gxMin; gx <= gxMax; gx++) {
      out.push({ gx, gy: s - gx });
    }
  }
  return out;
}
