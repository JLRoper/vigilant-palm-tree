import {
  cellOrigin,
  cellToScreen,
  cellsInDrawOrder,
  computeCityScale,
  TILE_W,
  TILE_D,
  type CityCell,
} from "../core/cityGrid";
import type { CityViewSize } from "@heroes/engine";
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
import { buildingFootprintFromRegistry } from "@heroes/engine";
import { pickStyleForBuilding } from "./assetDescriptors";
import { settings, PARALLAX_SPEEDS } from "../state/settings";
import skyboxBaseUrl from "../resources/skybox/cityView-background.png?url";
import skyboxVariant2Url from "../resources/skybox/cityView-background-variant2.png?url";
import skyboxVariant3Url from "../resources/skybox/cityView-background-variant3.png?url";
import skyboxVariant4Url from "../resources/skybox/cityView-background-variant4.png?url";

export { type BuildingDef, type GenerationStyle };

const FONT_FAMILY = "system-ui, sans-serif";

const COLOR_BG = "#1a1620";
const COLOR_FILL = "#2a2438";
const COLOR_STROKE = "#3a3450";
const COLOR_HOVER_STROKE = "#ffcc00";
const COLOR_TEXT = "#ffffff";

const LAYER_BANDS: Record<number, Array<{ yStart: number; yEnd: number }>> = {
  2: [
    { yStart: 0.00, yEnd: 0.55 },
    { yStart: 0.45, yEnd: 1.00 },
  ],
  3: [
    { yStart: 0.00, yEnd: 0.40 },
    { yStart: 0.30, yEnd: 0.70 },
    { yStart: 0.60, yEnd: 1.00 },
  ],
  4: [
    { yStart: 0.00, yEnd: 0.35 },
    { yStart: 0.25, yEnd: 0.60 },
    { yStart: 0.50, yEnd: 0.80 },
    { yStart: 0.70, yEnd: 1.00 },
  ],
};

let skyboxCache = new Map<number, HTMLImageElement>();
let skyboxLoaded = new Set<number>();
let skyboxPending = new Set<number>();
let lastVariant = 0;
let activeSkybox: HTMLImageElement | null = null;

type LayerId = string;
let layerCanvasCache = new Map<LayerId, HTMLCanvasElement[]>();
let layerSplitPending = new Set<LayerId>();

const SKYBOX_URLS: Record<number, string> = {
  1: skyboxBaseUrl,
  2: skyboxVariant2Url,
  3: skyboxVariant3Url,
  4: skyboxVariant4Url,
};

function skyboxPath(variant: number): string {
  return SKYBOX_URLS[variant] ?? skyboxBaseUrl;
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

function splitIntoLayers(img: HTMLImageElement, layerCount: number): HTMLCanvasElement[] {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const bands = LAYER_BANDS[layerCount] ?? LAYER_BANDS[4];
  const layers: HTMLCanvasElement[] = [];
  const fadePct = 0.18;

  for (let i = 0; i < layerCount; i++) {
    const band = bands[i];
    const y0 = Math.floor(band.yStart * h);
    const y1 = Math.floor(band.yEnd * h);
    const bandH = y1 - y0;
    const fadePx = Math.max(1, Math.floor(bandH * fadePct));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;

    const sliceCanvas = document.createElement("canvas");
    sliceCanvas.width = w;
    sliceCanvas.height = bandH;
    const sctx = sliceCanvas.getContext("2d")!;
    sctx.drawImage(img, 0, y0, w, bandH, 0, 0, w, bandH);

    const imageData = sctx.getImageData(0, 0, w, bandH);
    const data = imageData.data;
    for (let py = 0; py < bandH; py++) {
      let alphaMul = 1;
      if (py < fadePx) {
        alphaMul = py / fadePx;
      } else if (py > bandH - fadePx) {
        alphaMul = (bandH - py) / fadePx;
      }
      if (alphaMul >= 1) continue;
      const rowStart = py * w * 4;
      for (let px = 0; px < w; px++) {
        const idx = rowStart + px * 4;
        data[idx + 3] = Math.round(data[idx + 3] * alphaMul);
      }
    }
    sctx.putImageData(imageData, 0, 0);

    ctx.drawImage(sliceCanvas, 0, y0);
    layers.push(canvas);
  }

  return layers;
}

function ensureSkyboxLayers(variant: number, layerCount: number): HTMLCanvasElement[] | null {
  const img = skyboxCache.get(variant);
  if (!img || !skyboxLoaded.has(variant)) return null;

  const key = `${variant}:${layerCount}`;
  if (layerCanvasCache.has(key)) return layerCanvasCache.get(key)!;
  if (layerSplitPending.has(key)) return null;

  layerSplitPending.add(key);
  try {
    const layers = splitIntoLayers(img, layerCount);
    layerCanvasCache.set(key, layers);
    layerSplitPending.delete(key);
    return layers;
  } catch {
    layerSplitPending.delete(key);
    return null;
  }
}

function drawSkybox(
  ctx: CanvasRenderingContext2D,
  s: ReturnType<typeof settings>,
  viewportW: number,
  viewportH: number,
): void {
  ensureSkybox(s.spriteVariant);

  if (s.parallaxEnabled) {
    const layerCount = s.parallaxLayerCount;
    const layers = ensureSkyboxLayers(s.spriteVariant, layerCount);

    if (layers) {
      const img = activeSkybox!;
      const imgW = img.naturalWidth;
      const imgH = img.naturalHeight;
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
      const speeds = PARALLAX_SPEEDS[layerCount] ?? PARALLAX_SPEEDS[4];

      for (let i = 0; i < layers.length; i++) {
        const speed = speeds[i];
        ctx.drawImage(layers[i], -offsetX * speed, -offsetY * speed, drawW, drawH);
      }
      return;
    }
  }

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
    return;
  }

  ctx.fillStyle = COLOR_BG;
  ctx.fillRect(0, 0, viewportW, viewportH);
}

const TIER_LABELS: Record<CityViewSize, string> = {
  5: "5\u00d75 Settlement",
  10: "10\u00d710 Town",
  15: "15\u00d715 Castle",
};

const STYLE_LABELS: Record<string, string> = Object.fromEntries(
  BUILDING_STYLE_REGISTRY.map((s) => [s.id, s.label])
);

export { computeCityScale };

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
  drawSkybox(ctx, s, viewportW, viewportH);

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
