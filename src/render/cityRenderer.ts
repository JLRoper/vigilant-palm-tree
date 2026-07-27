import {
  cellOrigin,
  cellToScreen,
  cellsInDrawOrder,
  TILE_W,
  TILE_D,
  type CityCell,
  type CityViewSize,
} from "../core/cityGrid";
import type { ResourceType } from "../map/resourceTiles";
import type { SpriteProvider } from "./assets";
import {
  drawSpot,
  drawMine,
  drawBuilding,
  buildingFootprint,
  BUILDING_STYLE_REGISTRY,
  type BuildingDef,
  type GenerationStyle,
} from "./cityBuildingDraw";
import { buildingFootprintFromRegistry } from "../core/buildingRegistry";
import { pickStyleForBuilding } from "./assetDescriptors";
import { settings } from "../state/settings";

export { type BuildingDef, type GenerationStyle };

const FONT_FAMILY = "system-ui, sans-serif";

const COLOR_BG = "#1a1620";
const COLOR_FILL = "#2a2438";
const COLOR_STROKE = "#3a3450";
const COLOR_HOVER_STROKE = "#ffcc00";
const COLOR_TEXT = "#ffffff";

const SKYBOX_BASE = "/src/resources/skybox/cityView-background";

let skyboxCache = new Map<number, HTMLImageElement>();
let skyboxLoaded = new Set<number>();
let skyboxPending = new Set<number>();
let lastVariant = 0;
let activeSkybox: HTMLImageElement | null = null;

function skyboxPath(variant: number): string {
  return variant <= 1 ? `${SKYBOX_BASE}.png` : `${SKYBOX_BASE}-variant${variant}.png`;
}

function ensureSkybox(variant: number): void {
  if (skyboxCache.has(variant)) {
    if (variant !== lastVariant) {
      activeSkybox = skyboxCache.get(variant) ?? null;
      lastVariant = variant;
    }
    return;
  }
  if (skyboxPending.has(variant)) return;
  skyboxPending.add(variant);
  const img = new Image();
  img.onload = () => {
    skyboxCache.set(variant, img);
    skyboxLoaded.add(variant);
    skyboxPending.delete(variant);
    if (variant === lastVariant || lastVariant === 0) {
      activeSkybox = img;
    }
  };
  img.onerror = () => {
    skyboxPending.delete(variant);
    if (variant > 1) {
      ensureSkybox(1);
    }
  };
  img.src = skyboxPath(variant);
}

const TIER_LABELS: Record<CityViewSize, string> = {
  5: "5\u00d75 Settlement",
  10: "10\u00d710 Town",
  15: "15\u00d715 Castle",
};

const STYLE_LABELS: Record<string, string> = Object.fromEntries(
  BUILDING_STYLE_REGISTRY.map((s) => [s.id, s.label])
);

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

export interface DrawCityViewOptions {
  viewportW: number;
  viewportH: number;
  settlementName: string;
  size: CityViewSize;
  hover: { gx: number; gy: number } | null;
  ownerColor?: string;
  provider: SpriteProvider;
  citySpots: Array<{ cell: { x: number; y: number }; resource: ResourceType; vein: string }>;
  cityMines: Array<{ cell: { x: number; y: number }; resource: ResourceType; level: number }>;
  buildings: BuildingDef[];
  style: GenerationStyle;
  pattern: string;
  ghost?: { gx: number; gy: number; kind: string; w: number; h: number; valid: boolean } | null;
  selectedKeys?: ReadonlySet<string>;
}

export function drawCityView(
  ctx: CanvasRenderingContext2D,
  opts: DrawCityViewOptions,
): void {
  const { viewportW, viewportH, settlementName, size, hover, citySpots, cityMines, provider, buildings, style, pattern, ghost } = opts;
  const selectedKeys = opts.selectedKeys;
  const ownerColor = opts.ownerColor ?? "#888888";
  const tileScale = computeCityScale(size, viewportW, viewportH);
  const tw = TILE_W * tileScale;
  const td = TILE_D * tileScale;

  const gridVCenter = (size - 1) * TILE_D / 2;
  const buildingPad = size * TILE_D * 0.18;
  const screenOrigin = { x: viewportW / 2, y: viewportH / 2 - (gridVCenter + buildingPad) * tileScale };
  const gridOrigin = cellOrigin(size);

  ctx.save();

  const s = settings();
  ensureSkybox(s.spriteVariant);
  if (activeSkybox && skyboxLoaded.has(s.spriteVariant)) {
    const imgW = activeSkybox.naturalWidth;
    const imgH = activeSkybox.naturalHeight;
    const imgRatio = imgW / imgH;
    const viewRatio = viewportW / viewportH;

    let drawW: number;
    let drawH: number;
    if (viewRatio > imgRatio) {
      drawW = viewportW;
      drawH = viewportW / imgRatio;
    } else {
      drawH = viewportH;
      drawW = viewportH * imgRatio;
    }

    const offsetX = (drawW - viewportW) / 2 + s.cityBgOffsetX;
    const offsetY = (drawH - viewportH) / 2 + s.cityBgOffsetY;
    ctx.drawImage(activeSkybox, -offsetX, -offsetY, drawW, drawH);
  } else {
    ctx.fillStyle = COLOR_BG;
    ctx.fillRect(0, 0, viewportW, viewportH);
  }

  ctx.lineJoin = "miter";
  for (const cell of cellsInDrawOrder(size)) {
    drawCell(ctx, cell, screenOrigin, gridOrigin, tw, td, hover);
  }

  const spotMap = new Map<string, typeof citySpots[number]>();
  for (const spot of citySpots) {
    spotMap.set(`${spot.cell.x},${spot.cell.y}`, spot);
  }
  const mineMap = new Map<string, typeof cityMines[number]>();
  for (const mine of cityMines) {
    mineMap.set(`${mine.cell.x},${mine.cell.y}`, mine);
  }

  for (const cell of cellsInDrawOrder(size)) {
    const key = `${cell.gx},${cell.gy}`;
    const c = cellToScreen(cell.gx, cell.gy, gridOrigin);
    const wx = screenOrigin.x + c.x * tileScale;
    const wy = screenOrigin.y + c.y * tileScale;

    const spot = spotMap.get(key);
    if (spot) {
      drawSpot(ctx, wx, wy, tw, td, spot.resource, provider);
    }
    const mine = mineMap.get(key);
    if (mine) {
      drawMine(ctx, wx, wy, tw, td, mine.resource, mine.level, provider);
    }
  }

  const orderedBuildings = [...buildings].sort((a, b) => (a.gx + a.gy) - (b.gx + b.gy));
  for (const b of orderedBuildings) {
    const fpSize = buildingFootprintFromRegistry(b.kind, b.level);
    const w = fpSize.w;
    const h = fpSize.h;
    const fp = buildingFootprint(b.gx, b.gy, gridOrigin, screenOrigin, tileScale, w, h);
    drawBuilding(ctx, fp.cx, fp.cy, fp.hw * 2, fp.hh * 2, b.kind, b.level, ownerColor, b.style, provider);
  }

  if (selectedKeys && selectedKeys.size > 0) {
    ctx.save();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#66ccff";
    ctx.setLineDash([6, 4]);
    for (const b of orderedBuildings) {
      const key = `${b.gx},${b.gy},${b.kind}`;
      if (!selectedKeys.has(key)) continue;
      const fpSize = buildingFootprintFromRegistry(b.kind, b.level);
      const w = fpSize.w;
      const h = fpSize.h;
      const fp = buildingFootprint(b.gx, b.gy, gridOrigin, screenOrigin, tileScale, w, h);
      ctx.strokeRect(fp.cx - fp.hw, fp.cy - fp.hh, fp.hw * 2, fp.hh * 2);
    }
    ctx.restore();
  }

  if (ghost) {
    const fp = buildingFootprint(ghost.gx, ghost.gy, gridOrigin, screenOrigin, tileScale, ghost.w, ghost.h);
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = ghost.valid ? "#44ff44" : "#ff4444";
    ctx.lineWidth = 3;
    ctx.strokeRect(fp.cx - fp.hw, fp.cy - fp.hh, fp.hw * 2, fp.hh * 2);
    const ghostStyle = pickStyleForBuilding(ghost.kind, 1, style);
    drawBuilding(ctx, fp.cx, fp.cy, fp.hw * 2, fp.hh * 2, ghost.kind as BuildingDef["kind"], 1, ownerColor, ghostStyle as GenerationStyle, provider);
    ctx.restore();
  }

  ctx.fillStyle = COLOR_TEXT;
  ctx.font = `14px ${FONT_FAMILY}`;
  ctx.textBaseline = "top";
  ctx.fillText(settlementName, 12, 12);

  ctx.globalAlpha = 0.7;
  ctx.font = `11px ${FONT_FAMILY}`;
  ctx.fillText(`${TIER_LABELS[size]}  \u2014  ${STYLE_LABELS[style]}  \u2014  ${pattern}`, 12, 30);
  ctx.globalAlpha = 1;

  ctx.restore();
}

function drawCell(
  ctx: CanvasRenderingContext2D,
  cell: CityCell,
  screenOrigin: { x: number; y: number },
  gridOrigin: { x: number; y: number },
  tw: number,
  td: number,
  hover: { gx: number; gy: number } | null,
): void {
  const tileScale = tw / TILE_W;
  const c = cellToScreen(cell.gx, cell.gy, gridOrigin);
  const wx = screenOrigin.x + c.x * tileScale;
  const wy = screenOrigin.y + c.y * tileScale;
  const hw = tw / 2;
  const hh = td / 2;

  ctx.beginPath();
  ctx.moveTo(wx, wy - hh);
  ctx.lineTo(wx + hw, wy);
  ctx.lineTo(wx, wy + hh);
  ctx.lineTo(wx - hw, wy);
  ctx.closePath();

  ctx.fillStyle = COLOR_FILL;
  ctx.fill();

  if (hover && hover.gx === cell.gx && hover.gy === cell.gy) {
    ctx.strokeStyle = COLOR_HOVER_STROKE;
    ctx.lineWidth = 3;
  } else {
    ctx.strokeStyle = COLOR_STROKE;
    ctx.lineWidth = 1;
  }
  ctx.stroke();
}
