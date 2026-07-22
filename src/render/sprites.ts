import { Faction } from "../entities/hero";
import { CastleLevel } from "../entities/settlement";
import { ResourceType } from "../map/resourceTiles";
import { settings } from "../state/settings";
import { SpriteProvider } from "./assets";
import { castleKey, heroKey, resourceStyleKey } from "./assetDescriptors";
import { drawKnightSprite, drawDemonSprite } from "./heroSprites";

export function drawCastleSprite(
  ctx: CanvasRenderingContext2D,
  provider: SpriteProvider,
  level: CastleLevel,
  cx: number,
  cy: number,
  hexSize: number
): void {
  const r = provider.resolve(castleKey(level));
  if (!r || !r.ready) return;
  drawWithDescriptor(ctx, r.drawable, r.descriptor, cx, cy, hexSize);
}

export function drawResourceIcon(
  ctx: CanvasRenderingContext2D,
  provider: SpriteProvider,
  resource: ResourceType,
  cx: number,
  cy: number,
  hexSize: number
): void {
  const r = provider.resolve(resourceStyleKey(resource, settings().resourceStyle));
  if (!r || !r.ready) return;
  drawWithDescriptor(ctx, r.drawable, r.descriptor, cx, cy, hexSize);
}

export function drawHeroSprite(
  ctx: CanvasRenderingContext2D,
  provider: SpriteProvider,
  faction: Faction,
  cx: number,
  cy: number
): void {
  const r = provider.resolve(heroKey(faction));
  if (!r || !r.ready) return;
  drawWithDescriptor(ctx, r.drawable, r.descriptor, cx, cy, 0);
}

function drawWithDescriptor(
  ctx: CanvasRenderingContext2D,
  drawable: CanvasImageSource,
  desc: import("./assetDescriptors").SpriteDescriptor,
  cx: number,
  cy: number,
  hexSize: number
): void {
  const naturalW = (drawable as HTMLImageElement).naturalWidth ?? (drawable as HTMLCanvasElement).width;
  const naturalH = (drawable as HTMLImageElement).naturalHeight ?? (drawable as HTMLCanvasElement).height;
  if (!naturalW || !naturalH) return;
  const aspect = naturalW / naturalH;

  let w: number;
  let h: number;
  switch (desc.sizing.kind) {
    case "abs":
      w = desc.sizing.size * aspect;
      h = desc.sizing.size;
      break;
    case "fitHeight":
      h = hexSize * desc.sizing.hexSizeMul;
      w = h * aspect;
      break;
    case "fitWidth":
      w = hexSize * desc.sizing.hexSizeMul;
      h = w / aspect;
      break;
  }

  ctx.imageSmoothingEnabled = false;
  let x: number;
  let y: number;
  if (desc.anchor === "center") {
    x = cx - w / 2;
    y = cy - h / 2;
  } else {
    x = cx - w / 2;
    y = cy + hexSize * 0.5 - h;
  }
  ctx.drawImage(drawable, x, y, w, h);
}

export const HERO_PROCEDURAL_DRAWERS = {
  "hero.player": drawKnightSprite,
  "hero.enemy": drawDemonSprite,
};
