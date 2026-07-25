import type { ResourceType } from "../../map/resourceTiles";
import { settings } from "../../state/settings";
import { RESOURCE_PAL } from "../palettes";
import { resourceStyleKey } from "../assetDescriptors";
import type { SpriteProvider } from "../assets";

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
  const pal = RESOURCE_PAL[resource];
  if (!pal) return;

  drawSpot(ctx, x, y, tw, td, resource, provider);

  const hw = tw * 0.28;
  const hh = td * 0.28;
  const wallH = tw * 0.12;
  const topY = y - hh;
  const botY = y + hh;
  const botWallY = botY + wallH;

  ctx.save();

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

  ctx.fillStyle = pal.stone;
  ctx.beginPath();
  ctx.moveTo(x - hw, y);
  ctx.lineTo(x - hw, botWallY);
  ctx.lineTo(x, botWallY + wallH * 0.6);
  ctx.lineTo(x, botY);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = pal.stoneDk;
  ctx.beginPath();
  ctx.moveTo(x, botY);
  ctx.lineTo(x + hw, y);
  ctx.lineTo(x + hw, botWallY);
  ctx.lineTo(x, botWallY + wallH * 0.6);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = pal.stoneHi;
  ctx.beginPath();
  ctx.moveTo(x, topY - wallH * 0.3);
  ctx.lineTo(x + hw, topY);
  ctx.lineTo(x, topY + hh * 0.3);
  ctx.lineTo(x - hw, topY);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = pal.glow;
  ctx.font = `${Math.max(8, td * 0.2)}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(level), x, y - tw * 0.06);

  ctx.restore();
}
