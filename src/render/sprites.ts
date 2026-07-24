import { Faction, Direction } from "../entities/hero";
import { CastleLevel } from "../entities/settlement";
import { ResourceType } from "../map/resourceTiles";
import { settings } from "../state/settings";
import { SpriteProvider } from "./assets";
import {
  castleKey,
  heroDirectionKey,
  resourceStyleKey,
  horseBubblyKey,
  horseShadowKey,
  horsePaladinKey,
  horseRangerKey,
  horseArcaneKey,
  horseUnicornKey,
  horseSamuraiKey,
} from "./assetDescriptors";
import { drawKnightSprite, drawDemonSprite } from "./heroSprites";

const warnedKeys = new Set<string>();

const HORSE_VARIANT_KEYS = {
  bubbly: horseBubblyKey,
  shadow: horseShadowKey,
  paladin: horsePaladinKey,
  ranger: horseRangerKey,
  arcane: horseArcaneKey,
  unicorn: horseUnicornKey,
  samurai: horseSamuraiKey,
} as const;

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
  cy: number,
  direction: Direction = "n",
  hexSize: number = 32,
  scaleY: number = 1.0
): void {
  const needsScale = Math.abs(scaleY - 1.0) > 1e-6;
  if (needsScale) {
    const anchorY = cy + hexSize * 0.5;
    ctx.save();
    ctx.translate(cx, anchorY);
    ctx.scale(1, scaleY);
    ctx.translate(-cx, -anchorY);
  }
  if (faction === "player") {
    const r = provider.resolve(heroDirectionKey("player", direction));
    if (r && r.ready) {
      drawWithDescriptor(ctx, r.drawable, r.descriptor, cx, cy, hexSize);
    }
  } else {
    const r = provider.resolve("hero.enemy" as const);
    if (r && r.ready) {
      drawWithDescriptor(ctx, r.drawable, r.descriptor, cx, cy, hexSize);
    }
  }
  if (needsScale) {
    ctx.restore();
  }
}

export function drawHorseSprite(
  ctx: CanvasRenderingContext2D,
  provider: SpriteProvider,
  variant: keyof typeof HORSE_VARIANT_KEYS,
  cx: number,
  cy: number,
  direction: Direction = "n",
  hexSize: number = 32
): void {
  const key = HORSE_VARIANT_KEYS[variant](direction);
  const r = provider.resolve(key);
  if (!r) {
    if (!warnedKeys.has(key)) {
      console.warn(`drawHorseSprite: no descriptor for ${key}`);
      warnedKeys.add(key);
    }
    return;
  }
  if (!r.ready) return;
  drawWithDescriptor(ctx, r.drawable, r.descriptor, cx, cy, hexSize);
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
    y = cy + hexSize * 0.5 - h + (desc.anchorOffsetY ?? 0);
  }
  ctx.drawImage(drawable, x, y, w, h);
}

export const HERO_PROCEDURAL_DRAWERS = {
  "hero.player": drawKnightSprite,
  "hero.enemy": drawDemonSprite,
};
