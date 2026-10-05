import type { BuildingDef } from "@heroes/contracts";
import type { CityViewSize } from "@heroes/engine";
import { buildingFootprintFromRegistry } from "@heroes/engine";

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

// Vertical pad added below the grid so tall isometric buildings at the south
// edge have room; a fraction of the grid's full depth.
export const BUILDING_PAD_RATIO = 0.18;

export interface CityLayout {
  tileScale: number;
  tw: number;
  td: number;
  gridOrigin: { x: number; y: number };
  screenOrigin: { x: number; y: number };
}

// Same pure-context note as computeCityScale: importable from contexts
// without a bundler asset pipeline (e.g. plain node:test).
export function cityLayout(
  size: CityViewSize,
  viewportW: number,
  viewportH: number,
): CityLayout {
  const tileScale = computeCityScale(size, viewportW, viewportH);
  const tw = TILE_W * tileScale;
  const td = TILE_D * tileScale;
  const gridOrigin = cellOrigin(size);
  const gridVCenter = (size - 1) * TILE_D / 2;
  const buildingPad = size * TILE_D * BUILDING_PAD_RATIO;
  const screenOriginY = viewportH / 2 - (gridVCenter + buildingPad) * tileScale;
  return {
    tileScale,
    tw,
    td,
    gridOrigin,
    screenOrigin: { x: viewportW / 2, y: screenOriginY },
  };
}

export function screenToGridCell(
  layout: CityLayout,
  size: CityViewSize,
  viewportW: number,
  canvasX: number,
  canvasY: number,
): CityCell | null {
  const wdx = canvasX - viewportW / 2 - layout.gridOrigin.x * layout.tileScale;
  const wdy = canvasY - layout.screenOrigin.y - layout.gridOrigin.y * layout.tileScale;
  const gxf = wdx / layout.tw + wdy / layout.td;
  const gyf = wdy / layout.td - wdx / layout.tw;
  // Integer coords are the drawn diamonds' CENTERS, so each cell's pick region
  // is the half-cell around it. Without the +0.5 shift the whole mapping is off
  // by half a cell (24 px down at tileScale 1): only the bottom of a diamond
  // selected its own cell and most of it selected a neighbour.
  const gx = Math.floor(gxf + 0.5);
  const gy = Math.floor(gyf + 0.5);
  if (gx < 0 || gx >= size || gy < 0 || gy >= size) return null;
  return { gx, gy };
}

export function coversCell(b: BuildingDef, gx: number, gy: number): boolean {
  const fp = buildingFootprintFromRegistry(b.kind, b.level);
  const w = b.w ?? fp.w;
  const h = b.h ?? fp.h;
  return gx >= b.gx && gx < b.gx + w && gy >= b.gy && gy < b.gy + h;
}

export function buildingFootprint(
  gx: number,
  gy: number,
  gridOrigin: { x: number; y: number },
  screenOrigin: { x: number; y: number },
  tileScale: number,
  w = 1,
  h = 1,
): { cx: number; cy: number; hw: number; hh: number } {
  const c = cellToScreen(gx, gy, gridOrigin);
  const rootCx = screenOrigin.x + c.x * tileScale;
  const rootCy = screenOrigin.y + c.y * tileScale;
  const cx = rootCx + (w - h) * (TILE_W / 4) * tileScale;
  const cy = rootCy + (w + h - 2) * (TILE_D / 4) * tileScale;
  return {
    cx,
    cy,
    hw: (w + h) * (TILE_W / 4) * tileScale,
    hh: (w + h) * (TILE_D / 4) * tileScale,
  };
}
