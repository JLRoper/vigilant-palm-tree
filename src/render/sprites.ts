import { Faction } from "../entities/hero";
import { CastleLevel } from "../entities/settlement";
import { ResourceType } from "../map/resourceTiles";
import { ProceduralDrawer, SpriteProvider } from "./assets";
import { castleKey, heroKey, resourceKey } from "./assetDescriptors";

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
  const r = provider.resolve(resourceKey(resource));
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
  desc: { anchor: "bottom" | "center"; sizing: { kind: "abs"; size: number } | { kind: "fitHeight"; hexSizeMul: number } | { kind: "fitWidth"; hexSizeMul: number } },
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

const knightDrawer: ProceduralDrawer = (ctx, size) => {
  const r = size * 0.9;
  ctx.fillStyle = "#ffcc00";
  ctx.strokeStyle = "#3a2a00";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2 + r * 0.15, r * 0.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(size / 2, size / 2 - r * 0.15, r * 0.45, Math.PI, 0);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#1a1a1a";
  ctx.fillRect(size / 2 - 2, size / 2 - r * 0.05, 1.5, r * 0.3);
  ctx.fillRect(size / 2 + 0.5, size / 2 - r * 0.05, 1.5, r * 0.3);

  ctx.strokeStyle = "#ffcc00";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(size / 2 + r * 0.7, size / 2 - r * 0.6);
  ctx.lineTo(size / 2 + r * 1.2, size / 2 - r * 1.1);
  ctx.stroke();

  ctx.fillStyle = "#cc1a1a";
  ctx.fillRect(size / 2 + r * 1.0, size / 2 - r * 1.25, r * 0.4, r * 0.25);
  ctx.strokeStyle = "#3a2a00";
  ctx.lineWidth = 1;
  ctx.strokeRect(size / 2 + r * 1.0, size / 2 - r * 1.25, r * 0.4, r * 0.25);
};

const demonDrawer: ProceduralDrawer = (ctx, size) => {
  const r = size * 0.9;
  ctx.fillStyle = "#7a1a1a";
  ctx.strokeStyle = "#1a0000";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2 + r * 0.1, r * 0.75, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#7a1a1a";
  ctx.beginPath();
  ctx.moveTo(size / 2 - r * 0.4, size / 2 - r * 0.55);
  ctx.lineTo(size / 2 - r * 0.1, size / 2 - r * 0.15);
  ctx.lineTo(size / 2 - r * 0.7, size / 2 - r * 0.1);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(size / 2 + r * 0.4, size / 2 - r * 0.55);
  ctx.lineTo(size / 2 + r * 0.1, size / 2 - r * 0.15);
  ctx.lineTo(size / 2 + r * 0.7, size / 2 - r * 0.1);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#ffcc00";
  ctx.beginPath();
  ctx.arc(size / 2 - r * 0.3, size / 2 - r * 0.15, r * 0.12, 0, Math.PI * 2);
  ctx.arc(size / 2 + r * 0.3, size / 2 - r * 0.15, r * 0.12, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.arc(size / 2 - r * 0.3, size / 2 - r * 0.15, r * 0.05, 0, Math.PI * 2);
  ctx.arc(size / 2 + r * 0.3, size / 2 - r * 0.15, r * 0.05, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#3a0000";
  ctx.fillRect(size / 2 - r * 0.2, size / 2 + r * 0.25, r * 0.4, r * 0.05);
};

export const HERO_PROCEDURAL_DRAWERS = {
  "hero.player": knightDrawer,
  "hero.enemy": demonDrawer,
};
