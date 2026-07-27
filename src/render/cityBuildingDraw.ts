import type { BuildingDef, BuildingKind, DrawBuildingContext } from "./cityBuildingDraw/types";
import { coversCell, buildingFootprint, buildingHeight } from "./cityBuildingDraw/primitives";
import { drawSpot, drawMine } from "./cityBuildingDraw/spots";
import { drawClassic } from "./cityBuildingDraw/classic";
import { drawBlocky } from "./cityBuildingDraw/blocky";
import { drawCrystalline } from "./cityBuildingDraw/crystalline";
import { drawOrganic } from "./cityBuildingDraw/organic";
import { drawIndustrial } from "./cityBuildingDraw/industrial";
import type { GenerationStyle } from "./palettes";
import type { BuildingPalette } from "./palettes";
import type { SpriteProvider } from "./assets";
import { buildingKey } from "./assetDescriptors";
import { BUILDING_STYLE_REGISTRY, type BuildingStyleId } from "./buildingStyles";

export type { GenerationStyle };
export type { BuildingPalette };
export type { BuildingDef, BuildingKind, DrawBuildingContext };
export { BUILDING_STYLE_REGISTRY, type BuildingStyleId };
export { coversCell, buildingFootprint, drawSpot, drawMine };

export function drawTownHall(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, tw: number, td: number,
  ownerColor: string,
  style: GenerationStyle,
  provider: SpriteProvider | null = null,
): void {
  drawBuilding(ctx, x, y, tw, td, "townHall", 1, ownerColor, style, provider);
}

const STYLE_DRAW_FNS: Record<BuildingStyleId, (opts: DrawBuildingContext) => void> = {
  classic: drawClassic,
  blocky: drawBlocky,
  crystalline: drawCrystalline,
  organic: drawOrganic,
  industrial: drawIndustrial,
};

class OffscreenBuildingCache {
  private cache = new Map<string, HTMLCanvasElement>();

  get(
    style: GenerationStyle,
    kind: BuildingKind,
    level: number,
    ownerColor: string,
    tw: number,
    td: number,
  ): HTMLCanvasElement | undefined {
    const key = `${style}.${kind}.${level}.${ownerColor}`;
    let canvas = this.cache.get(key);
    if (canvas) return canvas;

    const drawFn = STYLE_DRAW_FNS[style];
    if (!drawFn) return undefined;

    const hw = tw / 2;
    const hh = td / 2;
    const cx = hw;
    const cy = hh + td * 0.5;
    const H = buildingHeight(kind, level);

    const pad = 4;
    const cw = Math.ceil(hw * 2 + pad * 2);
    const ch = Math.ceil(td * 2 + H + pad * 2);

    canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;

    const octx = canvas.getContext("2d")!;
    octx.translate(pad, pad);

    const context: DrawBuildingContext = {
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
    };

    drawFn(context);
    this.cache.set(key, canvas);
    return canvas;
  }

  clear(): void {
    this.cache.clear();
  }
}

const offscreenCache = new OffscreenBuildingCache();

export function clearOffscreenBuildingCache(): void {
  offscreenCache.clear();
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
      const desc = r.descriptor;
      const aspect = dw / dh;
      let sw: number, sh: number;
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
      let dx: number, dy: number;
      if (desc.anchor === "center") {
        dx = x - sw / 2;
        dy = y - sh / 2 + (desc.anchorOffsetY ?? 0);
      } else {
        dx = x - sw / 2;
        dy = y + td * 0.5 - sh + (desc.anchorOffsetY ?? 0);
      }
      ctx.drawImage(r.drawable, dx, dy, sw, sh);
      ctx.restore();
      return;
    }
  }

  const cached = offscreenCache.get(style, kind, level, ownerColor, tw, td);
  if (cached) {
    ctx.drawImage(cached, x - cached.width / 2, y - cached.height / 2);
    return;
  }

  drawBuildingFromContext({
    ctx, gx: 0, gy: 0, w: 1, h: 1,
    gridOrigin: { x: 0, y: 0 }, screenOrigin: { x: 0, y: 0 }, tileScale: 1,
    style, kind, level, ownerColor,
    cellScreen: { x, y }, hw: tw / 2, hh: td / 2,
  });
}

function drawBuildingFromContext(opts: DrawBuildingContext): void {
  const fn = STYLE_DRAW_FNS[opts.style];
  if (fn) fn(opts);
}
