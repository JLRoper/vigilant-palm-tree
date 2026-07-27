import { cellToScreen, TILE_W, TILE_D } from "../../core/cityGrid";
import { buildingFootprintFromRegistry } from "../../core/buildingRegistry";
import type { BuildingDef, BuildingKind, DrawBuildingContext } from "./types";

export { type BuildingDef, type BuildingKind, type DrawBuildingContext };

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

export function lighten(hex: string, amount: number): string {
  const r = Math.min(255, parseInt(hex.slice(1, 3), 16) + amount);
  const g = Math.min(255, parseInt(hex.slice(3, 5), 16) + amount);
  const b = Math.min(255, parseInt(hex.slice(5, 7), 16) + amount);
  return `rgb(${r},${g},${b})`;
}

export function darken(hex: string, amount: number): string {
  const r = Math.max(0, parseInt(hex.slice(1, 3), 16) - amount);
  const g = Math.max(0, parseInt(hex.slice(3, 5), 16) - amount);
  const b = Math.max(0, parseInt(hex.slice(5, 7), 16) - amount);
  return `rgb(${r},${g},${b})`;
}

export function buildingHeight(kind: BuildingKind, level: number): number {
  const base: Record<BuildingKind, number> = {
    townHall: 48,
    house: 20,
    tower: 56,
    mageGuild: 40,
    mine: 16,
    market: 32,
    barracks: 28,
    smithy: 24,
    apartment: 44,
    farmField: 6,
    farmhouse: 22,
    archeryRange: 28,
    granary: 26,
  };
  return (base[kind] ?? 24) + (level - 1) * 12;
}

export function drawIsoBox(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  hw: number,
  hh: number,
  height: number,
  fillLeft: string,
  fillRight: string,
  fillTop: string,
  inset: number,
): void {
  const i = inset * Math.min(hw, hh);
  const baseTop = { x: cx, y: cy - hh };
  const baseRight = { x: cx + hw, y: cy };
  const baseBottom = { x: cx, y: cy + hh };
  const baseLeft = { x: cx - hw, y: cy };

  const topTop = { x: cx, y: cy - hh - height };
  const topRight = { x: cx + hw - i, y: cy - height };
  const topBottom = { x: cx, y: cy + hh - height };
  const topLeft = { x: cx - hw + i, y: cy - height };

  ctx.beginPath();
  ctx.moveTo(topTop.x, topTop.y);
  ctx.lineTo(topRight.x, topRight.y);
  ctx.lineTo(baseRight.x, baseRight.y);
  ctx.lineTo(baseBottom.x, baseBottom.y);
  ctx.lineTo(topBottom.x, topBottom.y);
  ctx.closePath();
  ctx.fillStyle = fillRight;
  ctx.fill();
  ctx.strokeStyle = darken(fillRight, 40);
  ctx.lineWidth = 0.5;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(topTop.x, topTop.y);
  ctx.lineTo(topLeft.x, topLeft.y);
  ctx.lineTo(baseLeft.x, baseLeft.y);
  ctx.lineTo(baseBottom.x, baseBottom.y);
  ctx.lineTo(topBottom.x, topBottom.y);
  ctx.closePath();
  ctx.fillStyle = fillLeft;
  ctx.fill();
  ctx.strokeStyle = darken(fillLeft, 40);
  ctx.lineWidth = 0.5;
  ctx.stroke();

  if (fillTop) {
    ctx.beginPath();
    ctx.moveTo(topTop.x, topTop.y);
    ctx.lineTo(baseTop.x, baseTop.y);
    ctx.lineTo(baseRight.x, baseRight.y);
    ctx.lineTo(topRight.x, topRight.y);
    ctx.closePath();
    ctx.fillStyle = fillTop;
    ctx.fill();
  }
}

export function getOpts(o: DrawBuildingContext) {
  if (o.gx === 0 && o.gy === 0 && o.gridOrigin.x === 0 && o.gridOrigin.y === 0 && o.screenOrigin.x === 0 && o.screenOrigin.y === 0 && o.tileScale === 1) {
    return { ...o, cx: o.cellScreen.x, cy: o.cellScreen.y, hw: o.hw, hh: o.hh };
  }
  const fp = buildingFootprint(o.gx, o.gy, o.gridOrigin, o.screenOrigin, o.tileScale, o.w, o.h);
  return { ...o, cx: fp.cx, cy: fp.cy, hw: fp.hw, hh: fp.hh };
}
