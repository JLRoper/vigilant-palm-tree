import { cellToScreen, TILE_W, TILE_D } from "../core/cityGrid";
import type { ResourceType } from "../map/resourceTiles";
import { settings } from "../state/settings";
import { RESOURCE_PAL, BUILDING_PALETTES, type BuildingPalette } from "./palettes";
import type { GenerationStyle } from "./palettes";
import type { SpriteProvider } from "./assets";
import { resourceStyleKey, buildingKey } from "./assetDescriptors";

export type { GenerationStyle };
export type { BuildingPalette } from "./palettes"; // re-exported so consumers get building types from one import (cityBuildingDraw), not two (cityBuildingDraw + palettes)

export type BuildingKind =
  | "townHall"
  | "house"
  | "tower"
  | "mageGuild"
  | "mine"
  | "market"
  | "barracks"
  | "smithy"
  | "apartment"
  | "farmField"
  | "farmhouse"
  | "archeryRange";

export interface BuildingDef {
  gx: number;
  gy: number;
  kind: BuildingKind;
  level: number;
  style: GenerationStyle;
  w?: number;
  h?: number;
}

export interface DrawBuildingContext {
  ctx: CanvasRenderingContext2D;
  gx: number;
  gy: number;
  w: number;
  h: number;
  gridOrigin: { x: number; y: number };
  screenOrigin: { x: number; y: number };
  tileScale: number;
  style: GenerationStyle;
  kind: BuildingKind;
  level: number;
  ownerColor: string;
  cellScreen: { x: number; y: number };
  hw: number;
  hh: number;
}

// ─── Public flat API: draw spot / mine / building per cell ────────────────

export function drawSpot(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, tw: number, td: number,
  resource: ResourceType,
  provider?: SpriteProvider,
): void {
  if (provider) {
    const r = provider.resolve(resourceStyleKey(resource, settings().resourceStyle));
    if (r?.ready) {
      const w = Math.min(tw * 0.5, td * 2.0);
      const h = w / ((r.drawable as HTMLImageElement).naturalWidth ?? (r.drawable as HTMLCanvasElement).width) * ((r.drawable as HTMLImageElement).naturalHeight ?? (r.drawable as HTMLCanvasElement).height) || w;
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(r.drawable, x - w / 2, y - h / 2, w, h);
      ctx.restore();
      return;
    }
  }
  const pal = RESOURCE_PAL[resource];
  if (!pal) return;
  const hw = tw * 0.22;
  const hh = td * 0.22;
  ctx.beginPath();
  ctx.moveTo(x, y - hh);
  ctx.lineTo(x + hw, y);
  ctx.lineTo(x, y + hh);
  ctx.lineTo(x - hw, y);
  ctx.closePath();
  ctx.fillStyle = pal.stone;
  ctx.fill();
  ctx.strokeStyle = pal.outline;
  ctx.lineWidth = 1;
  ctx.stroke();
}

export function drawMine(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, tw: number, td: number,
  resource: ResourceType, level: number,
  provider?: SpriteProvider,
): void {
  // Mines are resource‑styled (rune‑stone palette), not faction‑styled.
  // Unlike buildings which read BUILDING_PALETTES, mines read RESOURCE_PAL.
  const pal = RESOURCE_PAL[resource];
  if (!pal) return;

  // spot icon behind the mine
  drawSpot(ctx, x, y, tw, td, resource, provider);

  const hw = tw * 0.28;
  const hh = td * 0.28;
  const wallH = tw * 0.12;
  const topY = y - hh;
  const botY = y + hh;
  const botWallY = botY + wallH;

  ctx.save();

  // mine walls
  ctx.fillStyle = pal.stoneDk;
  ctx.beginPath();
  ctx.moveTo(x - hw, y);
  ctx.lineTo(x, botY);
  ctx.lineTo(x + hw, y);
  ctx.lineTo(x, topY);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = pal.stoneDk;
  ctx.fillRect(x - hw, y, hw * 2, wallH);

  // left wall face
  ctx.fillStyle = pal.stone;
  ctx.beginPath();
  ctx.moveTo(x - hw, y);
  ctx.lineTo(x - hw, botWallY);
  ctx.lineTo(x, botWallY + wallH * 0.6);
  ctx.lineTo(x, botY);
  ctx.closePath();
  ctx.fill();

  // right wall face
  ctx.fillStyle = pal.stoneDk;
  ctx.beginPath();
  ctx.moveTo(x, botY);
  ctx.lineTo(x + hw, y);
  ctx.lineTo(x + hw, botWallY);
  ctx.lineTo(x, botWallY + wallH * 0.6);
  ctx.closePath();
  ctx.fill();

  // roof
  ctx.fillStyle = pal.stoneHi;
  ctx.beginPath();
  ctx.moveTo(x, topY - wallH * 0.3);
  ctx.lineTo(x + hw, topY);
  ctx.lineTo(x, topY + hh * 0.3);
  ctx.lineTo(x - hw, topY);
  ctx.closePath();
  ctx.fill();

  // level label
  ctx.fillStyle = pal.glow;
  ctx.font = `${Math.max(8, td * 0.2)}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(level), x, y - tw * 0.06);

  ctx.restore();
}

export function drawTownHall(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, tw: number, td: number,
  ownerColor: string,
  style: GenerationStyle,
  provider: SpriteProvider | null = null,
): void {
  drawBuilding(ctx, x, y, tw, td, "townHall", 1, ownerColor, style, provider);
}

export function drawBuilding(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, tw: number, td: number,
  kind: BuildingKind, level: number, ownerColor: string, style: GenerationStyle,
  provider: SpriteProvider | null = null,
): void {
  if (provider) {
    const r = provider.resolve(buildingKey(style, kind, level));
    if (r?.ready) {
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      const dw = (r.drawable as HTMLImageElement).naturalWidth ?? (r.drawable as HTMLCanvasElement).width;
      const dh = (r.drawable as HTMLImageElement).naturalHeight ?? (r.drawable as HTMLCanvasElement).height;
      const scale = tw * 0.85 / dw;
      const w = dw * scale;
      const h = dh * scale;
      ctx.drawImage(r.drawable, x - w / 2, y - h / 2, w, h);
      ctx.restore();
      return;
    }
  }

  drawBuildingFromContext({
    ctx, gx: 0, gy: 0, w: 1, h: 1,
    gridOrigin: { x: 0, y: 0 }, screenOrigin: { x: 0, y: 0 }, tileScale: 1,
    style, kind, level, ownerColor,
    cellScreen: { x, y }, hw: tw / 2, hh: td / 2,
  });
}

export function coversCell(b: BuildingDef, gx: number, gy: number): boolean {
  const w = b.w ?? 1;
  const h = b.h ?? 1;
  return gx >= b.gx && gx < b.gx + w && gy >= b.gy && gy < b.gy + h;
}

// ─── Internal dispatch ─────────────────────────────────────────────────────

function drawBuildingFromContext(opts: DrawBuildingContext): void {
  switch (opts.style) {
    case "classic":
      drawClassic(opts);
      break;
    case "blocky":
      drawBlocky(opts);
      break;
    case "crystalline":
      drawCrystalline(opts);
      break;
    case "organic":
      drawOrganic(opts);
      break;
    case "industrial":
      drawIndustrial(opts);
      break;
  }
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

function lighten(hex: string, amount: number): string {
  const r = Math.min(255, parseInt(hex.slice(1, 3), 16) + amount);
  const g = Math.min(255, parseInt(hex.slice(3, 5), 16) + amount);
  const b = Math.min(255, parseInt(hex.slice(5, 7), 16) + amount);
  return `rgb(${r},${g},${b})`;
}

function darken(hex: string, amount: number): string {
  const r = Math.max(0, parseInt(hex.slice(1, 3), 16) - amount);
  const g = Math.max(0, parseInt(hex.slice(3, 5), 16) - amount);
  const b = Math.max(0, parseInt(hex.slice(5, 7), 16) - amount);
  return `rgb(${r},${g},${b})`;
}

function buildingHeight(kind: BuildingKind, level: number): number {
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
  };
  return (base[kind] ?? 24) + (level - 1) * 12;
}

function drawIsoBox(
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

// ─── Style 1: Classic Fantasy ───────────────────────────────────────────────

function drawClassic(opts: DrawBuildingContext): void {
  const { ctx, cx, cy, hw, hh, kind, level, ownerColor } = getOpts(opts);
  const H = buildingHeight(kind, level);
  const bodyLight = lighten(ownerColor, 30);
  const bodyDark = darken(ownerColor, 20);
  const roofColor = darken(ownerColor, 50);

  drawIsoBox(ctx, cx, cy, hw * 0.8, hh * 0.8, H * 0.7, bodyDark, bodyLight, "", 0);

  const roofH = H * 0.4;
  const roofTop = cy - hh * 0.8 - H * 0.7 - roofH;
  const roofTopX = cx;
  const roofRightX = cx + hw * 0.6;
  const roofLeftX = cx - hw * 0.6;
  const roofBaseY = cy - H * 0.7;
  const roofRightY = cy - H * 0.7 + roofH * 0.3;
  const roofLeftY = cy - H * 0.7 + roofH * 0.3;

  ctx.beginPath();
  ctx.moveTo(roofTopX, roofTop);
  ctx.lineTo(roofRightX, roofRightY);
  ctx.lineTo(cx + hw * 0.8, roofBaseY);
  ctx.lineTo(roofLeftX, roofLeftY);
  ctx.closePath();
  ctx.fillStyle = roofColor;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(roofTopX, roofTop);
  ctx.lineTo(roofRightX, roofRightY);
  ctx.lineTo(cx, roofBaseY);
  ctx.lineTo(roofLeftX, roofLeftY);
  ctx.closePath();
  ctx.fillStyle = lighten(roofColor, 20);
  ctx.fill();

  if (kind === "house" || kind === "market") {
    const doorX = cx;
    const doorY = cy + hh * 0.1;
    const doorW = hw * 0.12;
    const doorH = H * 0.25;
    ctx.fillStyle = darken(ownerColor, 60);
    ctx.fillRect(doorX - doorW / 2, doorY, doorW, doorH);
    ctx.strokeStyle = lighten(ownerColor, 40);
    ctx.lineWidth = 1;
    ctx.strokeRect(doorX - doorW / 2, doorY, doorW, doorH);

    const winW = hw * 0.1;
    const winH = H * 0.12;
    ctx.fillStyle = lighten(ownerColor, 60);
    ctx.fillRect(cx - hw * 0.3, doorY + doorH * 0.3, winW, winH);
    ctx.fillRect(cx + hw * 0.1, doorY + doorH * 0.3, winW, winH);
  }

  if (kind === "townHall") {
    const w = hw * 0.2;
    const h = H * 0.2;
    ctx.fillStyle = lighten(ownerColor, 60);
    ctx.fillRect(cx - w / 2, cy + hh * 0.1, w, h);
    ctx.strokeStyle = roofColor;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(cx - w / 2, cy + hh * 0.1, w, h);
  }
}

// ─── Style 2: Blocky Pixel ──────────────────────────────────────────────────

function drawBlocky(opts: DrawBuildingContext): void {
  const { ctx, cx, cy, hw, hh, kind, level, ownerColor } = getOpts(opts);
  const H = buildingHeight(kind, level);
  const pal = BUILDING_PALETTES["blocky"];

  if (kind === "archeryRange") {
    drawBlockyArcheryRange(ctx, cx, cy, hw, hh, H, level, ownerColor, pal);
    return;
  }
  if (kind === "farmhouse") {
    drawBlockyFarmhouse(ctx, cx, cy, hw, hh, H, ownerColor, pal);
    return;
  }
  if (kind === "apartment") {
    drawBlockyHighrise(ctx, cx, cy, hw, hh, H, level, ownerColor, pal);
    return;
  }

  const base = lighten(ownerColor, 20);
  const shade = darken(ownerColor, 10);

  const levels = level + 1;
  let currentTop = cy;
  for (let l = 0; l < levels; l++) {
    const stepH = H / levels;
    const shrink = l * (hw * 0.15);
    const stepHw = hw - shrink;
    const stepHh = hh - shrink;

    ctx.beginPath();
    ctx.moveTo(cx, currentTop - stepHh);
    ctx.lineTo(cx + stepHw, currentTop);
    ctx.lineTo(cx, currentTop + stepHh);
    ctx.lineTo(cx - stepHw, currentTop);
    ctx.closePath();
    ctx.fillStyle = l % 2 === 0 ? base : shade;
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.lineWidth = 1;
    ctx.stroke();

    drawIsoBox(ctx, cx, currentTop, stepHw, stepHh, stepH, shade, base, "", 0.1);

    currentTop -= stepHh * 0.6 + stepH;
  }

  if (kind === "tower") {
    const flagX = cx;
    const flagY = cy - hh - H * 1.1;
    ctx.strokeStyle = lighten(ownerColor, 70);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(flagX, flagY);
    ctx.lineTo(flagX, flagY + H * 0.3);
    ctx.stroke();
    ctx.fillStyle = "#ff4444";
    ctx.fillRect(flagX, flagY, hw * 0.25, H * 0.15);
  }

  if (kind === "house" || kind === "market") {
    const doorX = cx;
    const doorY = cy + hh * 0.15;
    ctx.fillStyle = "#111";
    ctx.fillRect(doorX - hw * 0.1, doorY, hw * 0.2, H * 0.2);
    ctx.fillStyle = lighten(ownerColor, 80);
    ctx.fillRect(cx - hw * 0.35, doorY + H * 0.05, hw * 0.12, H * 0.1);
    ctx.fillRect(cx + hw * 0.15, doorY + H * 0.05, hw * 0.12, H * 0.1);
  }
}

// ─── Style 3: Crystalline Elven ─────────────────────────────────────────────

function drawCrystalline(opts: DrawBuildingContext): void {
  const { ctx, cx, cy, hw, hh, kind, level, ownerColor } = getOpts(opts);
  const H = buildingHeight(kind, level);
  const alpha = 0.7;

  const crystalBase = lighten(ownerColor, 80);
  const crystalMid = lighten(ownerColor, 40);
  const crystalDark = ownerColor;

  for (let s = 0; s < 3 + level; s++) {
    const spread = (Math.sin(s * 1.2) * hw * 0.3);
    const spireH = H * (0.5 + s * 0.15);
    const spireX = cx + spread;
    const spTopX = spireX + (s % 3 - 1) * hw * 0.15;
    const spTopY = cy - hh - spireH;

    const facetColors = [crystalBase, crystalMid, crystalDark];
    const fAlpha = alpha - s * 0.1;

    ctx.globalAlpha = Math.max(0.2, fAlpha);
    drawCrystalSpire(ctx, spireX, cy + hh * 0.2, spTopX, spTopY, hw * 0.18, spireH, facetColors[s % 3]);
    ctx.globalAlpha = 1;
  }

  if (kind === "mageGuild" || kind === "townHall") {
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = lighten(ownerColor, 120);
    ctx.beginPath();
    ctx.arc(cx, cy - hh * 0.3, hw * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function drawCrystalSpire(
  ctx: CanvasRenderingContext2D,
  bx: number, by: number,
  tx: number, ty: number,
  halfW: number, _height: number,
  color: string,
): void {
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.lineTo(bx + halfW, by);
  ctx.lineTo(bx, by + halfW * 0.6);
  ctx.lineTo(bx - halfW, by);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = lighten(color, 80);
  ctx.lineWidth = 0.8;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.lineTo(bx, by + halfW * 0.6);
  ctx.lineTo(bx - halfW * 0.5, by);
  ctx.lineTo(bx - halfW, by);
  ctx.closePath();
  ctx.fillStyle = darken(color, 30);
  ctx.fill();
}

// ─── Style 4: Organic Wooden ────────────────────────────────────────────────

function drawOrganic(opts: DrawBuildingContext): void {
  const { ctx, cx, cy, hw, hh, kind, level, ownerColor } = getOpts(opts);
  const H = buildingHeight(kind, level);
  const pal = BUILDING_PALETTES["organic"];

  if (kind === "apartment") {
    drawOrganicApartment(ctx, cx, cy, hw, hh, H, level, ownerColor, pal);
    return;
  }
  if (kind === "farmField") {
    drawOrganicFarmField(ctx, cx, cy, hw, hh, ownerColor, pal);
    return;
  }
  if (kind === "farmhouse") {
    drawOrganicFarmhouse(ctx, cx, cy, hw, hh, H, ownerColor, pal);
    return;
  }
  if (kind === "archeryRange") {
    drawOrganicArcheryRange(ctx, cx, cy, hw, hh, H, level, ownerColor, pal);
    return;
  }

  const woodBase = pal.wood!;
  const woodLight = pal.woodLt!;
  const woodRoof = darken(ownerColor, 40);

  drawIsoBox(ctx, cx, cy, hw * 0.7, hh * 0.7, H * 0.65, woodBase, woodLight, "", 0.05);

  const roofPeakY = cy - hh * 0.7 - H * 0.65 - H * 0.25;
  const roofEaveY = cy - H * 0.65;
  // Rounded thatched roof — front face
  ctx.beginPath();
  ctx.moveTo(cx - hw * 0.05, roofPeakY + hh * 0.05);
  ctx.quadraticCurveTo(cx, roofPeakY - hh * 0.08, cx + hw * 0.05, roofPeakY + hh * 0.05);
  ctx.quadraticCurveTo(cx + hw * 0.35, roofPeakY + hh * 0.35, cx + hw * 0.85, roofEaveY);
  ctx.quadraticCurveTo(cx, roofEaveY + hh * 0.7, cx - hw * 0.85, roofEaveY);
  ctx.quadraticCurveTo(cx - hw * 0.35, roofPeakY + hh * 0.35, cx - hw * 0.05, roofPeakY + hh * 0.05);
  ctx.fillStyle = woodRoof;
  ctx.fill();
  // Rounded thatched roof — side face
  ctx.beginPath();
  ctx.moveTo(cx - hw * 0.05, roofPeakY + hh * 0.05);
  ctx.quadraticCurveTo(cx, roofPeakY - hh * 0.08, cx + hw * 0.05, roofPeakY + hh * 0.05);
  ctx.quadraticCurveTo(cx + hw * 0.3, roofPeakY + hh * 0.2, cx + hw * 0.55, roofEaveY - hh * 0.15);
  ctx.quadraticCurveTo(cx, roofEaveY + hh * 0.15, cx - hw * 0.55, roofEaveY - hh * 0.15);
  ctx.quadraticCurveTo(cx - hw * 0.3, roofPeakY + hh * 0.2, cx - hw * 0.05, roofPeakY + hh * 0.05);
  ctx.fillStyle = lighten(woodRoof, 20);
  ctx.fill();
  // Thatch texture strokes
  ctx.strokeStyle = darken(woodRoof, 15);
  ctx.lineWidth = 0.6;
  for (let t = 0; t < 4; t++) {
    const ty = roofEaveY - H * 0.06 - t * (H * 0.07);
    ctx.beginPath();
    ctx.moveTo(cx - hw * 0.6, ty);
    ctx.quadraticCurveTo(cx, ty + hh * 0.04, cx + hw * 0.6, ty);
    ctx.stroke();
  }

  if (kind === "house" || kind === "market") {
    const dX = cx;
    const dY = cy + hh * 0.1;
    ctx.fillStyle = darken(woodBase, 40);
    ctx.beginPath();
    ctx.ellipse(dX, dY, hw * 0.12, H * 0.15, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.strokeStyle = darken(woodBase, 20);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - hw * 0.2, cy - H * 0.3);
  ctx.quadraticCurveTo(cx - hw * 0.5, cy, cx - hw * 0.2, cy + H * 0.2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + hw * 0.2, cy - H * 0.3);
  ctx.quadraticCurveTo(cx + hw * 0.5, cy, cx + hw * 0.2, cy + H * 0.2);
  ctx.stroke();
}

// ─── Style 5: Industrial Dwarven ────────────────────────────────────────────

function drawIndustrial(opts: DrawBuildingContext): void {
  const { ctx, cx, cy, hw, hh, kind, level, ownerColor: _oc } = getOpts(opts);
  const H = buildingHeight(kind, level);
  const pal = BUILDING_PALETTES["industrial"];

  const stoneDark = pal.stoneDk!;
  const stoneMid = pal.stoneMd!;
  const metalAccent = pal.accent!;

  drawIsoBox(ctx, cx, cy, hw * 0.85, hh * 0.85, H * 0.6, stoneDark, stoneMid, "", 0);

  const topY = cy - hh * 0.85 - H * 0.6;

  ctx.beginPath();
  ctx.moveTo(cx, topY - hh * 0.15);
  ctx.lineTo(cx + hw * 0.85, topY);
  ctx.lineTo(cx, topY + hh * 0.15);
  ctx.lineTo(cx - hw * 0.85, topY);
  ctx.closePath();
  ctx.fillStyle = stoneMid;
  ctx.fill();
  ctx.strokeStyle = metalAccent;
  ctx.lineWidth = 1;
  ctx.stroke();

  if (kind === "smithy" || kind === "mine") {
    const chimneyX = cx + hw * 0.4;
    const chimneyW = hw * 0.12;
    const chimneyH = H * 0.4;
    ctx.fillStyle = "#222";
    ctx.fillRect(chimneyX, cy - hh * 0.5 - chimneyH, chimneyW, chimneyH);
    ctx.fillStyle = "#666";
    ctx.fillRect(chimneyX - 1, cy - hh * 0.5 - chimneyH, chimneyW + 2, 3);

    for (let p = 0; p < 2; p++) {
      const smokeX = chimneyX + chimneyW / 2 + p * 4;
      const smokeY = cy - hh * 0.5 - chimneyH - p * 6;
      ctx.globalAlpha = 0.15;
      ctx.fillStyle = "#aaa";
      ctx.beginPath();
      ctx.arc(smokeX, smokeY, hw * 0.06, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  if (kind === "townHall" || kind === "barracks") {
    const bw = hw * 0.12;
    const bh = H * 0.12;
    for (let bx = -1; bx <= 1; bx += 2) {
      ctx.fillStyle = metalAccent;
      ctx.fillRect(cx + bx * hw * 0.3, cy + hh * 0.1, bw, bh);
      ctx.strokeStyle = darken(metalAccent, 40);
      ctx.lineWidth = 1;
      ctx.strokeRect(cx + bx * hw * 0.3, cy + hh * 0.1, bw, bh);
    }
  }

  if (kind === "tower") {
    const bw = hw * 0.15;
    const bh = H * 0.15;
    ctx.fillStyle = "#111";
    ctx.fillRect(cx - bw / 2, cy - H * 0.5, bw, bh);
  }
}

function getOpts(o: DrawBuildingContext) {
  if (o.gx === 0 && o.gy === 0 && o.gridOrigin.x === 0 && o.gridOrigin.y === 0 && o.screenOrigin.x === 0 && o.screenOrigin.y === 0 && o.tileScale === 1) {
    return { ...o, cx: o.cellScreen.x, cy: o.cellScreen.y, hw: o.hw, hh: o.hh };
  }
  const fp = buildingFootprint(o.gx, o.gy, o.gridOrigin, o.screenOrigin, o.tileScale, o.w, o.h);
  return { ...o, cx: fp.cx, cy: fp.cy, hw: fp.hw, hh: fp.hh };
}

// ── Organic: apartment (multi-level living unit) ───────────────────────────

function drawOrganicApartment(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, hw: number, hh: number, H: number, level: number, ownerColor: string,
  pal: BuildingPalette,
): void {
  const woodBase = pal.wood!;
  const woodLight = pal.woodLt!;
  const woodDark = pal.woodDk!;
  const roofColor = darken(ownerColor, 40);
  const floors = 1 + level; // 2..4 stacked living levels
  const floorH = H / floors;

  // Stack floors, each slightly narrower (stepped terrace look)
  for (let f = 0; f < floors; f++) {
    const shrink = f * (hw * 0.08);
    const fHw = hw * 0.78 - shrink;
    const fHh = hh * 0.78 - shrink;
    const baseCy = cy - f * floorH;
    const leftC = f % 2 === 0 ? woodBase : woodLight;
    const rightC = f % 2 === 0 ? woodLight : woodBase;
    drawIsoBox(ctx, cx, baseCy, fHw, fHh, floorH, leftC, rightC, "", 0.05);

    // Window band across the front faces of this floor
    const bandY = baseCy - floorH * 0.55;
    for (let wi = -1; wi <= 1; wi++) {
      const wx = cx + wi * fHw * 0.28;
      ctx.fillStyle = "#ffe08a";
      ctx.fillRect(wx - fHw * 0.06, bandY, fHw * 0.12, floorH * 0.22);
      ctx.strokeStyle = woodDark;
      ctx.lineWidth = 0.6;
      ctx.strokeRect(wx - fHw * 0.06, bandY, fHw * 0.12, floorH * 0.22);
      // mullion
      ctx.beginPath();
      ctx.moveTo(wx, bandY);
      ctx.lineTo(wx, bandY + floorH * 0.22);
      ctx.stroke();
    }

    // balcony railing accent every other floor
    if (f % 2 === 1 && f < floors - 1) {
      ctx.strokeStyle = woodDark;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx - fHw * 0.5, baseCy - floorH);
      ctx.lineTo(cx + fHw * 0.5, baseCy - floorH);
      ctx.stroke();
    }
  }

  // Top rounded thatched roof
  const topFloorShrink = (floors - 1) * (hw * 0.08);
  const topHw = hw * 0.78 - topFloorShrink;
  const topCy = cy - (floors - 1) * floorH;
  const roofBaseY = topCy - floorH;
  const roofPeakY = roofBaseY - floorH * 1.4;
  // Front face
  ctx.beginPath();
  ctx.moveTo(cx - topHw * 0.05, roofPeakY + hh * 0.05);
  ctx.quadraticCurveTo(cx, roofPeakY - hh * 0.08, cx + topHw * 0.05, roofPeakY + hh * 0.05);
  ctx.quadraticCurveTo(cx + topHw * 0.35, roofPeakY + hh * 0.35, cx + topHw * 0.85, roofBaseY);
  ctx.quadraticCurveTo(cx, roofBaseY + hh * 0.7, cx - topHw * 0.85, roofBaseY);
  ctx.quadraticCurveTo(cx - topHw * 0.35, roofPeakY + hh * 0.35, cx - topHw * 0.05, roofPeakY + hh * 0.05);
  ctx.fillStyle = roofColor;
  ctx.fill();
  // Side face
  ctx.beginPath();
  ctx.moveTo(cx - topHw * 0.05, roofPeakY + hh * 0.05);
  ctx.quadraticCurveTo(cx, roofPeakY - hh * 0.08, cx + topHw * 0.05, roofPeakY + hh * 0.05);
  ctx.quadraticCurveTo(cx + topHw * 0.3, roofPeakY + hh * 0.2, cx + topHw * 0.55, roofBaseY - hh * 0.15);
  ctx.quadraticCurveTo(cx, roofBaseY + hh * 0.15, cx - topHw * 0.55, roofBaseY - hh * 0.15);
  ctx.quadraticCurveTo(cx - topHw * 0.3, roofPeakY + hh * 0.2, cx - topHw * 0.05, roofPeakY + hh * 0.05);
  ctx.fillStyle = lighten(roofColor, 20);
  ctx.fill();

  // Small rooftop vent
  ctx.fillStyle = woodDark;
  ctx.fillRect(cx - topHw * 0.06, roofPeakY + floorH * 0.2, topHw * 0.12, floorH * 0.25);
}

// ── Organic: farm field (flat 2x2 plot, 3 rows of crops) ─────────────────────

function drawOrganicFarmField(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, hw: number, hh: number, ownerColor: string,
  pal: BuildingPalette,
): void {
  const soil = pal.soil!;
  const soilDark = pal.soilDk!;
  const furrow = pal.furrow!;
  const cropGreen = pal.crop!;
  const cropDark = pal.cropDk!;
  const fence = pal.fence!;

  // Soil bed (the 2x2 diamond at ground level), slightly raised lip
  ctx.beginPath();
  ctx.moveTo(cx, cy - hh);
  ctx.lineTo(cx + hw, cy);
  ctx.lineTo(cx, cy + hh);
  ctx.lineTo(cx - hw, cy);
  ctx.closePath();
  ctx.fillStyle = soil;
  ctx.fill();
  ctx.strokeStyle = soilDark;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Three furrow/crop rows running across the field.
  // A horizontal slice at y = cy + k spans x in [cx - hw*(1-|k|/hh), cx + hw*(1-|k|/hh)].
  const rowKs = [-hh * 0.42, 0, hh * 0.42];
  for (let i = 0; i < rowKs.length; i++) {
    const k = rowKs[i];
    const half = hw * (1 - Math.abs(k) / hh);
    const ry = cy + k;
    const lx = cx - half;
    const rx = cx + half;

    // furrow (tilled soil line) -- iso-skewed band
    ctx.strokeStyle = furrow;
    ctx.lineWidth = Math.max(2, hh * 0.06);
    ctx.beginPath();
    ctx.moveTo(lx, ry);
    ctx.lineTo(rx, ry);
    ctx.stroke();

    // crop tufts along the row
    const tufts = Math.max(6, Math.floor((rx - lx) / (hw * 0.12)));
    for (let t = 0; t <= tufts; t++) {
      const tx = lx + (rx - lx) * (t / tufts);
      ctx.fillStyle = i % 2 === 0 ? cropGreen : cropDark;
      ctx.beginPath();
      ctx.ellipse(tx, ry - hh * 0.05, hw * 0.025, hh * 0.06, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // small owner-color row marker at row ends (stakes)
    ctx.fillStyle = ownerColor;
    ctx.fillRect(lx - 1, ry - hh * 0.1, 2, hh * 0.12);
    ctx.fillRect(rx - 1, ry - hh * 0.1, 2, hh * 0.12);
  }

  // Low wooden fence around the 2x2 perimeter, with corner posts at the 4 diamond corners
  const corners = [
    { x: cx, y: cy - hh },
    { x: cx + hw, y: cy },
    { x: cx, y: cy + hh },
    { x: cx - hw, y: cy },
  ];
  ctx.strokeStyle = fence;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
  ctx.closePath();
  ctx.stroke();
  for (const c of corners) {
    ctx.fillStyle = fence;
    ctx.fillRect(c.x - 1.5, c.y - 3, 3, 6);
  }
}

// ── Organic: farmhouse (small house + haybale out front) ─────────────────────

function drawOrganicFarmhouse(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, hw: number, hh: number, H: number, ownerColor: string,
  pal: BuildingPalette,
): void {
  const woodBase = pal.wood!;
  const woodLight = pal.woodLt!;
  const woodRoof = darken(ownerColor, 40);

  // Small house body, offset slightly back (up on screen) so the haybale sits "out front"
  const houseCx = cx;
  const houseCy = cy - hh * 0.12;
  const bodyHw = hw * 0.62;
  const bodyHh = hh * 0.62;
  const bodyH = H * 0.7;
  drawIsoBox(ctx, houseCx, houseCy, bodyHw, bodyHh, bodyH, woodBase, woodLight, "", 0.05);

  // Rounded thatched gable roof
  const roofBaseY = houseCy - bodyH;
  const roofPeakY = roofBaseY - H * 0.32;
  // Front face
  ctx.beginPath();
  ctx.moveTo(houseCx - bodyHw * 0.05, roofPeakY + bodyHh * 0.05);
  ctx.quadraticCurveTo(houseCx, roofPeakY - bodyHh * 0.08, houseCx + bodyHw * 0.05, roofPeakY + bodyHh * 0.05);
  ctx.quadraticCurveTo(houseCx + bodyHw * 0.35, roofPeakY + bodyHh * 0.35, houseCx + bodyHw * 0.85, roofBaseY);
  ctx.quadraticCurveTo(houseCx, roofBaseY + bodyHh * 0.7, houseCx - bodyHw * 0.85, roofBaseY);
  ctx.quadraticCurveTo(houseCx - bodyHw * 0.35, roofPeakY + bodyHh * 0.35, houseCx - bodyHw * 0.05, roofPeakY + bodyHh * 0.05);
  ctx.fillStyle = woodRoof;
  ctx.fill();
  // Side face
  ctx.beginPath();
  ctx.moveTo(houseCx - bodyHw * 0.05, roofPeakY + bodyHh * 0.05);
  ctx.quadraticCurveTo(houseCx, roofPeakY - bodyHh * 0.08, houseCx + bodyHw * 0.05, roofPeakY + bodyHh * 0.05);
  ctx.quadraticCurveTo(houseCx + bodyHw * 0.3, roofPeakY + bodyHh * 0.2, houseCx + bodyHw * 0.55, roofBaseY - bodyHh * 0.15);
  ctx.quadraticCurveTo(houseCx, roofBaseY + bodyHh * 0.15, houseCx - bodyHw * 0.55, roofBaseY - bodyHh * 0.15);
  ctx.quadraticCurveTo(houseCx - bodyHw * 0.3, roofPeakY + bodyHh * 0.2, houseCx - bodyHw * 0.05, roofPeakY + bodyHh * 0.05);
  ctx.fillStyle = lighten(woodRoof, 20);
  ctx.fill();

  // Door + a single window on the house
  ctx.fillStyle = darken(woodBase, 40);
  ctx.beginPath();
  ctx.ellipse(houseCx, houseCy + bodyHh * 0.12, bodyHw * 0.12, bodyH * 0.18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffe08a";
  ctx.fillRect(houseCx + bodyHw * 0.22, houseCy - bodyH * 0.35, bodyHw * 0.12, bodyH * 0.16);
  ctx.strokeStyle = darken(woodBase, 40);
  ctx.lineWidth = 0.8;
  ctx.strokeRect(houseCx + bodyHw * 0.22, houseCy - bodyH * 0.35, bodyHw * 0.12, bodyH * 0.16);

  // Haybale out front (south, toward the viewer), slightly to the front-right
  const baleCx = cx + hw * 0.18;
  const baleCy = cy + hh * 0.42;
  const baleW = hw * 0.26;
  const baleH = hh * 0.42;
  // shadow
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(baleCx, baleCy + baleH * 0.18, baleW * 1.05, baleH * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();
  // bale body (rounded, flattened to read as an iso haystack)
  ctx.fillStyle = "#d9a521";
  ctx.beginPath();
  ctx.ellipse(baleCx, baleCy, baleW, baleH, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#a9790f";
  ctx.lineWidth = 1;
  ctx.stroke();
  // horizontal straw banding lines
  ctx.strokeStyle = "#a9790f";
  ctx.lineWidth = 0.8;
  for (let b = -2; b <= 2; b++) {
    const by = baleCy + b * (baleH * 0.3);
    const span = baleW * Math.sqrt(Math.max(0, 1 - Math.pow((by - baleCy) / baleH, 2)));
    ctx.beginPath();
    ctx.moveTo(baleCx - span, by);
    ctx.lineTo(baleCx + span, by);
    ctx.stroke();
  }
  // twine knots down the middle
  ctx.strokeStyle = "#7a5a08";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(baleCx, baleCy - baleH);
  ctx.lineTo(baleCx, baleCy + baleH);
  ctx.stroke();
}

// ── Organic: archery range (covered shelter + outdoor range with targets) ──

function drawOrganicArcheryRange(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, hw: number, hh: number, H: number, level: number, ownerColor: string,
  pal: BuildingPalette,
): void {
  const woodBase = pal.wood!;
  const woodLight = pal.woodLt!;
  const woodDark = pal.woodDk!;
  const roofColor = darken(ownerColor, 40);
  const groundColor = "#d4c49c";

  // ── Covered shelter (left side of the cell) ─────────────────────────
  const shelterCx = cx - hw * 0.22;
  const shelterCy = cy;
  const shelterHw = hw * 0.38;
  const shelterHh = hh * 0.38;
  const shelterH = H * 0.6;
  drawIsoBox(ctx, shelterCx, shelterCy, shelterHw, shelterHh, shelterH, woodBase, woodLight, "", 0.05);

  // Rounded thatch roof on shelter
  const roofBaseY = shelterCy - shelterH;
  const roofPeakY = roofBaseY - H * 0.2;
  ctx.beginPath();
  ctx.moveTo(shelterCx - shelterHw * 0.05, roofPeakY + shelterHh * 0.05);
  ctx.quadraticCurveTo(shelterCx, roofPeakY - shelterHh * 0.08, shelterCx + shelterHw * 0.05, roofPeakY + shelterHh * 0.05);
  ctx.quadraticCurveTo(shelterCx + shelterHw * 0.35, roofPeakY + shelterHh * 0.35, shelterCx + shelterHw * 0.85, roofBaseY);
  ctx.quadraticCurveTo(shelterCx, roofBaseY + shelterHh * 0.7, shelterCx - shelterHw * 0.85, roofBaseY);
  ctx.quadraticCurveTo(shelterCx - shelterHw * 0.35, roofPeakY + shelterHh * 0.35, shelterCx - shelterHw * 0.05, roofPeakY + shelterHh * 0.05);
  ctx.fillStyle = roofColor;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(shelterCx - shelterHw * 0.05, roofPeakY + shelterHh * 0.05);
  ctx.quadraticCurveTo(shelterCx, roofPeakY - shelterHh * 0.08, shelterCx + shelterHw * 0.05, roofPeakY + shelterHh * 0.05);
  ctx.quadraticCurveTo(shelterCx + shelterHw * 0.3, roofPeakY + shelterHh * 0.2, shelterCx + shelterHw * 0.55, roofBaseY - shelterHh * 0.15);
  ctx.quadraticCurveTo(shelterCx, roofBaseY + shelterHh * 0.15, shelterCx - shelterHw * 0.55, roofBaseY - shelterHh * 0.15);
  ctx.quadraticCurveTo(shelterCx - shelterHw * 0.3, roofPeakY + shelterHh * 0.2, shelterCx - shelterHw * 0.05, roofPeakY + shelterHh * 0.05);
  ctx.fillStyle = lighten(roofColor, 20);
  ctx.fill();

  // Equipment rack inside shelter
  ctx.strokeStyle = woodDark;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(shelterCx - shelterHw * 0.2, shelterCy - shelterH * 0.35);
  ctx.lineTo(shelterCx + shelterHw * 0.3, shelterCy - shelterH * 0.35);
  ctx.stroke();
  for (let b = -1; b <= 1; b += 2) {
    ctx.beginPath();
    ctx.moveTo(shelterCx + b * shelterHw * 0.25, shelterCy - shelterH * 0.35);
    ctx.quadraticCurveTo(shelterCx + b * shelterHw * 0.2, shelterCy - shelterH * 0.55, shelterCx + b * shelterHw * 0.15, shelterCy - shelterH * 0.45);
    ctx.stroke();
  }

  // ── Outdoor range (right side with targets) ─────────────────────────
  const rangeLeftX = cx + hw * 0.05;
  const rangeRightX = cx + hw * 0.7;
  const rangeTopY = cy - hh * 0.5;
  const rangeBotY = cy + hh * 0.5;

  ctx.fillStyle = groundColor;
  ctx.beginPath();
  ctx.moveTo(rangeLeftX, rangeTopY);
  ctx.lineTo(rangeRightX, cy - hh * 0.15);
  ctx.lineTo(rangeRightX, cy + hh * 0.15);
  ctx.lineTo(rangeLeftX, rangeBotY);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = darken(groundColor, 30);
  ctx.lineWidth = 0.8;
  ctx.stroke();

  // Shooting line
  ctx.strokeStyle = woodBase;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(rangeLeftX, rangeBotY + hh * 0.05);
  ctx.lineTo(rangeLeftX - hw * 0.05, rangeBotY);
  ctx.stroke();

  // Target stands — up to level+1 targets
  const targetCount = 1 + level;
  for (let t = 0; t < targetCount; t++) {
    const tFraction = (t + 0.5) / targetCount;
    const tX = rangeLeftX + (rangeRightX - rangeLeftX) * 0.5 + (t - (targetCount - 1) / 2) * (hw * 0.18);
    const tY = rangeTopY + (rangeBotY - rangeTopY) * tFraction;

    // Post
    ctx.strokeStyle = woodDark;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(tX, tY);
    ctx.lineTo(tX, tY - H * 0.35);
    ctx.stroke();

    const targetCY = tY - H * 0.4;
    const targetR = Math.min(hw * 0.08, hh * 0.16);

    ctx.fillStyle = "#d9a521";
    ctx.beginPath();
    ctx.ellipse(tX, targetCY, targetR, targetR * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = woodDark;
    ctx.lineWidth = 0.6;
    ctx.stroke();

    ctx.fillStyle = "#f8f8f0";
    ctx.beginPath();
    ctx.ellipse(tX, targetCY, targetR * 0.55, targetR * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#cc3333";
    ctx.beginPath();
    ctx.ellipse(tX, targetCY, targetR * 0.2, targetR * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();

    const arrowLen = targetR * 1.2;
    const arrowAngle = cx + t * 0.4;
    const arrowTipX = tX + Math.cos(arrowAngle) * targetR * 0.25;
    const arrowTipY = targetCY + Math.sin(arrowAngle) * targetR * 0.15;
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(arrowTipX, arrowTipY);
    ctx.lineTo(arrowTipX - arrowLen * 0.7, arrowTipY - arrowLen * 0.25);
    ctx.stroke();
    ctx.strokeStyle = "#884422";
    ctx.lineWidth = 0.4;
    ctx.beginPath();
    ctx.moveTo(arrowTipX - arrowLen * 0.5, arrowTipY - arrowLen * 0.18);
    ctx.lineTo(arrowTipX - arrowLen * 0.8, arrowTipY - arrowLen * 0.28);
    ctx.stroke();
  }
}

// ── Blocky: archery range (stepped shelter + square target stands) ─────────

function drawBlockyArcheryRange(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, hw: number, hh: number, H: number, level: number, ownerColor: string,
  pal: BuildingPalette,
): void {
  const base = lighten(ownerColor, 20);
  const shade = darken(ownerColor, 10);
  const ground = pal.accent ?? "#9090a0";

  // ── Stepped shelter (left portion) ──────────────────────────────────
  const shelterCx = cx - hw * 0.22;
  const shelterCy = cy;
  const shelterHw = hw * 0.38;
  const shelterHh = hh * 0.38;
  const shelterH = H * 0.55;
  const tiers = 1 + level;
  let topY = shelterCy;
  for (let t = 0; t < tiers; t++) {
    const stepH = shelterH / tiers;
    const shrink = t * (shelterHw * 0.18);
    const tHw = shelterHw - shrink;
    const tHh = shelterHh - shrink;
    ctx.beginPath();
    ctx.moveTo(shelterCx, topY - tHh);
    ctx.lineTo(shelterCx + tHw, topY);
    ctx.lineTo(shelterCx, topY + tHh);
    ctx.lineTo(shelterCx - tHw, topY);
    ctx.closePath();
    ctx.fillStyle = t % 2 === 0 ? base : shade;
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.lineWidth = 1;
    ctx.stroke();
    drawIsoBox(ctx, shelterCx, topY, tHw, tHh, stepH, shade, base, "", 0.08);
    topY -= tHh * 0.5 + stepH;
  }

  // ── Range floor (right portion) ─────────────────────────────────────
  const rangeLeftX = cx + hw * 0.05;
  const rangeRightX = cx + hw * 0.7;
  const rangeTopY = cy - hh * 0.48;
  const rangeBotY = cy + hh * 0.48;

  ctx.fillStyle = ground;
  ctx.fillRect(rangeLeftX, rangeTopY, rangeRightX - rangeLeftX + 1, rangeBotY - rangeTopY);
  ctx.strokeStyle = darken(ground, 20);
  ctx.lineWidth = 1;
  ctx.strokeRect(rangeLeftX, rangeTopY, rangeRightX - rangeLeftX + 1, rangeBotY - rangeTopY);

  // Shooting line
  ctx.strokeStyle = "rgba(0,0,0,0.6)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(rangeLeftX, rangeBotY + hh * 0.04);
  ctx.lineTo(rangeLeftX - hw * 0.04, rangeBotY);
  ctx.stroke();

  // Square target stands
  const tgtCount = 1 + level;
  for (let t = 0; t < tgtCount; t++) {
    const tFrac = (t + 0.5) / tgtCount;
    const tX = rangeLeftX + (rangeRightX - rangeLeftX) * 0.55 + (t - (tgtCount - 1) / 2) * (hw * 0.16);
    const tY = rangeTopY + (rangeBotY - rangeTopY) * tFrac;

    // Post
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(tX, tY);
    ctx.lineTo(tX, tY - H * 0.3);
    ctx.stroke();

    // Square target board
    const brdCY = tY - H * 0.35;
    const brdSize = Math.min(hw * 0.13, hh * 0.22);
    ctx.fillStyle = "#ccbb66";
    ctx.fillRect(tX - brdSize / 2, brdCY - brdSize / 2, brdSize, brdSize);
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 1;
    ctx.strokeRect(tX - brdSize / 2, brdCY - brdSize / 2, brdSize, brdSize);

    // Inner square
    const inner = brdSize * 0.5;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(tX - inner / 2, brdCY - inner / 2, inner, inner);

    // Bullseye square
    const bull = brdSize * 0.2;
    ctx.fillStyle = "#cc2222";
    ctx.fillRect(tX - bull / 2, brdCY - bull / 2, bull, bull);
  }
}

// ── Blocky: farmhouse (stepped block + chunky haybale) ────────────────────

function drawBlockyFarmhouse(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, hw: number, hh: number, H: number,   ownerColor: string,
  _pal: BuildingPalette,
): void {
  const base = lighten(ownerColor, 20);
  const shade = darken(ownerColor, 10);

  // ── Crop field (left portion of the cell) ──────────────────────────
  const fieldLeftX = cx - hw * 0.82;
  const fieldRightX = cx - hw * 0.05;
  const fieldTopY = cy - hh * 0.55;
  const fieldBotY = cy + hh * 0.55;

  // Soil bed
  ctx.fillStyle = "#665522";
  ctx.fillRect(fieldLeftX, fieldTopY, fieldRightX - fieldLeftX + 1, fieldBotY - fieldTopY);
  ctx.strokeStyle = "rgba(0,0,0,0.4)";
  ctx.lineWidth = 1;
  ctx.strokeRect(fieldLeftX, fieldTopY, fieldRightX - fieldLeftX + 1, fieldBotY - fieldTopY);

  // Crop rows (3 furrow lines + square crop markers)
  for (let r = 0; r < 3; r++) {
    const ry = fieldTopY + (fieldBotY - fieldTopY) * (0.2 + r * 0.28);
    // Furrow line
    ctx.strokeStyle = "#3a2a10";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(fieldLeftX + 2, ry);
    ctx.lineTo(fieldRightX - 2, ry);
    ctx.stroke();
    // Crop squares along the row
    const count = Math.floor((fieldRightX - fieldLeftX) / (hw * 0.1));
    for (let c = 0; c < count; c++) {
      const fx = fieldLeftX + (fieldRightX - fieldLeftX) * ((c + 0.5) / count);
      ctx.fillStyle = r % 2 === 0 ? "#448822" : "#337711";
      ctx.fillRect(fx - 2, ry - 3, 4, 4);
      ctx.strokeStyle = "rgba(0,0,0,0.3)";
      ctx.lineWidth = 0.5;
      ctx.strokeRect(fx - 2, ry - 3, 4, 4);
    }
  }

  // Fence border on field
  ctx.strokeStyle = "rgba(0,0,0,0.5)";
  ctx.lineWidth = 1.2;
  ctx.strokeRect(fieldLeftX, fieldTopY, fieldRightX - fieldLeftX + 1, fieldBotY - fieldTopY);

  // ── Blocky house (right portion, shifted right) ────────────────────
  const houseX = cx + hw * 0.22;
  const houseCy = cy - hh * 0.06;
  const bodyHw = hw * 0.34;
  const bodyHh = hh * 0.38;
  const bodyH = H * 0.42;
  const tiers = 2;
  let topY = houseCy;
  for (let t = 0; t < tiers; t++) {
    const stepH = bodyH / tiers;
    const shrink = t * (bodyHw * 0.2);
    const tHw = bodyHw - shrink;
    const tHh = bodyHh - shrink;
    ctx.beginPath();
    ctx.moveTo(houseX, topY - tHh);
    ctx.lineTo(houseX + tHw, topY);
    ctx.lineTo(houseX, topY + tHh);
    ctx.lineTo(houseX - tHw, topY);
    ctx.closePath();
    ctx.fillStyle = t % 2 === 0 ? base : shade;
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.lineWidth = 1;
    ctx.stroke();
    drawIsoBox(ctx, houseX, topY, tHw, tHh, stepH, shade, base, "", 0.08);
    topY -= tHh * 0.5 + stepH;
  }

  // Door + window on house
  ctx.fillStyle = "#111";
  ctx.fillRect(houseX - bodyHw * 0.06, cy + bodyHh * 0.08, bodyHw * 0.13, bodyH * 0.16);
  ctx.strokeStyle = lighten(ownerColor, 40);
  ctx.lineWidth = 0.8;
  ctx.strokeRect(houseX - bodyHw * 0.06, cy + bodyHh * 0.08, bodyHw * 0.13, bodyH * 0.16);
  ctx.fillStyle = lighten(ownerColor, 80);
  ctx.fillRect(houseX + bodyHw * 0.18, cy - bodyH * 0.2, bodyHw * 0.08, bodyH * 0.1);

  // Blocky haybale (below the house)
  const baleX = houseX + hw * 0.04;
  const baleY = cy + hh * 0.38;
  const baleW = hw * 0.16;
  const baleH = hh * 0.24;
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fillRect(baleX - baleW / 2 - 1, baleY + baleH * 0.1, baleW + 2, baleH * 0.12);
  ctx.fillStyle = "#cc9911";
  ctx.fillRect(baleX - baleW / 2, baleY - baleH / 2, baleW, baleH);
  ctx.strokeStyle = "rgba(0,0,0,0.4)";
  ctx.lineWidth = 1;
  ctx.strokeRect(baleX - baleW / 2, baleY - baleH / 2, baleW, baleH);
  ctx.strokeStyle = "#886600";
  ctx.lineWidth = 0.6;
  for (let i = -2; i <= 2; i++) {
    const by = baleY + i * (baleH / 5);
    ctx.beginPath();
    ctx.moveTo(baleX - baleW * 0.4, by);
    ctx.lineTo(baleX + baleW * 0.4, by);
    ctx.stroke();
  }
  for (let i = -1; i <= 1; i += 2) {
    ctx.beginPath();
    ctx.moveTo(baleX + i * baleW * 0.18, baleY - baleH * 0.42);
    ctx.lineTo(baleX + i * baleW * 0.18, baleY + baleH * 0.42);
    ctx.stroke();
  }
}

// ── Blocky: high-rise complex (many stepped tiers + windows + antenna) ────

function drawBlockyHighrise(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, hw: number, hh: number, H: number, level: number,   ownerColor: string,
  _pal: BuildingPalette,
): void {
  const base = lighten(ownerColor, 20);
  const shade = darken(ownerColor, 10);

  // Many tiers — taller than the default blocky building
  const tiers = 2 + level;
  let topY = cy;
  for (let t = 0; t < tiers; t++) {
    const stepH = H / tiers;
    const shrink = t * (hw * 0.1);
    const tHw = hw * 0.82 - shrink;
    const tHh = hh * 0.82 - shrink;

    // Floor diamond
    ctx.beginPath();
    ctx.moveTo(cx, topY - tHh);
    ctx.lineTo(cx + tHw, topY);
    ctx.lineTo(cx, topY + tHh);
    ctx.lineTo(cx - tHw, topY);
    ctx.closePath();
    ctx.fillStyle = t % 2 === 0 ? base : shade;
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.lineWidth = 1;
    ctx.stroke();

    // Wall box
    drawIsoBox(ctx, cx, topY, tHw, tHh, stepH, shade, base, "", 0.08);

    // Windows on the visible wall faces (follow iso edges, not straight-across)
    const winBandFrac = 0.55; // height fraction on this tier's wall
    const bandY = topY - stepH * winBandFrac;
    // At this Y, the left face horizontally spans from leftEdgeX → cx
    // and the right face spans from cx → rightEdgeX
    const inset = tHw * 0.08;
    const leftEdgeX = cx - tHw + inset * (1 - winBandFrac);
    const rightEdgeX = cx + tHw - inset * (1 - winBandFrac);
    const winW = tHw * 0.06;
    const winH = stepH * 0.2;
    for (let wi = 0; wi < 2; wi++) {
      const frac = (wi + 0.5) / 2; // 0.25, 0.75
      // Left face window
      const lx = leftEdgeX + (cx - leftEdgeX) * frac;
      ctx.fillStyle = lighten(ownerColor, 80);
      ctx.fillRect(lx - winW / 2, bandY, winW, winH);
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.lineWidth = 0.5;
      ctx.strokeRect(lx - winW / 2, bandY, winW, winH);
      // Right face window
      const rx = cx + (rightEdgeX - cx) * frac;
      ctx.fillStyle = lighten(ownerColor, 80);
      ctx.fillRect(rx - winW / 2, bandY, winW, winH);
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.lineWidth = 0.5;
      ctx.strokeRect(rx - winW / 2, bandY, winW, winH);
    }

    topY -= tHh * 0.5 + stepH;
  }

  // Antenna mast on top
  const mastBaseY = topY;
  const mastTopY = mastBaseY - H * 0.25;
  ctx.strokeStyle = "rgba(0,0,0,0.6)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx, mastBaseY);
  ctx.lineTo(cx, mastTopY);
  ctx.stroke();
  // Crossbar
  ctx.strokeStyle = "rgba(0,0,0,0.5)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - hw * 0.08, mastTopY + H * 0.08);
  ctx.lineTo(cx + hw * 0.08, mastTopY + H * 0.08);
  ctx.stroke();
}
