// Isometric building draw for the city painters, transcribed from
// cityBuildingDraw.ts's `drawBuilding()` + its `OffscreenBuildingCache`.
//
// It lives here rather than being imported because the cityBuildingDraw.ts
// barrel imports `buildingKey` from assetDescriptors.ts -- the Vite-?url
// coupling paint2d/ exists to stay clear of (see README.md). The five style
// leaves and primitives.ts are leaf-clean and imported directly, so only the
// sprite-resolution branch and the cache wrapper are re-stated here; the
// actual per-style drawing is the same code the live renderer runs.

import type { BuildingKind, GenerationStyle } from "@heroes/contracts";
import type { DrawBuildingContext } from "../../cityBuildingDraw/types";
import { buildingHeight } from "../../cityBuildingDraw/primitives";
import { drawClassic } from "../../cityBuildingDraw/classic";
import { drawBlocky } from "../../cityBuildingDraw/blocky";
import { drawCrystalline } from "../../cityBuildingDraw/crystalline";
import { drawOrganic } from "../../cityBuildingDraw/organic";
import { drawIndustrial } from "../../cityBuildingDraw/industrial";
import type { ResolvedSprite } from "./deps";

const STYLE_DRAW_FNS: Record<string, (opts: DrawBuildingContext) => void> = {
  classic: drawClassic,
  blocky: drawBlocky,
  crystalline: drawCrystalline,
  organic: drawOrganic,
  industrial: drawIndustrial,
};

const offscreenCache = new Map<string, HTMLCanvasElement>();

export function clearBuildingCanvasCache(): void {
  offscreenCache.clear();
}

function cachedBuildingCanvas(
  style: GenerationStyle,
  kind: BuildingKind,
  level: number,
  ownerColor: string,
  tw: number,
  td: number,
): HTMLCanvasElement | undefined {
  const cacheKey = `${style}.${kind}.${level}.${ownerColor}`;
  const hit = offscreenCache.get(cacheKey);
  if (hit) return hit;

  const drawFn = STYLE_DRAW_FNS[style];
  if (!drawFn) return undefined;
  // No DOM (bare node:test, worker): skip the offscreen canvas entirely and
  // let the caller draw the style leaf straight into the target context.
  if (typeof document === "undefined") return undefined;

  const hw = tw / 2;
  const hh = td / 2;
  const cx = hw;
  const cy = hh + td * 0.5;
  const H = buildingHeight(kind, level);

  const pad = 4;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(hw * 2 + pad * 2);
  canvas.height = Math.ceil(td * 2 + H + pad * 2);

  const octx = canvas.getContext("2d");
  if (!octx) return undefined;
  octx.translate(pad, pad);

  drawFn({
    ctx: octx,
    gx: 0, gy: 0, w: 1, h: 1,
    gridOrigin: { x: 0, y: 0 },
    screenOrigin: { x: 0, y: 0 },
    tileScale: 1,
    style,
    kind,
    level,
    ownerColor,
    cellScreen: { x: cx, y: cy },
    hw,
    hh,
  });

  offscreenCache.set(cacheKey, canvas);
  return canvas;
}

/**
 * Draw one isometric building centred on `(x, y)` within a `tw` x `td` tile
 * footprint. Sprite first; procedural style leaf (via an offscreen canvas
 * cache) when no sprite is ready.
 *
 * Note the sizing quirk carried over verbatim from `drawBuilding()`: the
 * `fitHeight` branch scales off `tw`, not `td`.
 */
export function drawBuildingInto(
  ctx: CanvasRenderingContext2D,
  sprite: ResolvedSprite | undefined,
  x: number,
  y: number,
  tw: number,
  td: number,
  kind: BuildingKind,
  level: number,
  ownerColor: string,
  style: GenerationStyle,
): void {
  if (sprite && sprite.ready) {
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    const drawable = sprite.drawable;
    const dw = (drawable as HTMLImageElement).naturalWidth ?? (drawable as HTMLCanvasElement).width;
    const dh = (drawable as HTMLImageElement).naturalHeight ?? (drawable as HTMLCanvasElement).height;
    const desc = sprite.descriptor;
    const aspect = dw / dh;
    let sw: number;
    let sh: number;
    if (desc.sizing.kind === "fitWidth") {
      sw = tw * desc.sizing.hexSizeMul;
      sh = sw / aspect;
    } else if (desc.sizing.kind === "fitHeight") {
      sh = tw * desc.sizing.hexSizeMul;
      sw = sh * aspect;
    } else {
      sw = tw * 0.85;
      sh = (tw * 0.85) / aspect;
    }
    const dx = x - sw / 2;
    const dy = desc.anchor === "center"
      ? y - sh / 2 + (desc.anchorOffsetY ?? 0)
      : y + td * 0.5 - sh + (desc.anchorOffsetY ?? 0);
    ctx.drawImage(drawable, dx, dy, sw, sh);
    ctx.restore();
    return;
  }

  const cached = cachedBuildingCanvas(style, kind, level, ownerColor, tw, td);
  if (cached) {
    ctx.drawImage(cached, x - cached.width / 2, y - cached.height / 2);
    return;
  }

  const drawFn = STYLE_DRAW_FNS[style];
  if (!drawFn) return;
  drawFn({
    ctx,
    gx: 0, gy: 0, w: 1, h: 1,
    gridOrigin: { x: 0, y: 0 },
    screenOrigin: { x: 0, y: 0 },
    tileScale: 1,
    style,
    kind,
    level,
    ownerColor,
    cellScreen: { x, y },
    hw: tw / 2,
    hh: td / 2,
  });
}
