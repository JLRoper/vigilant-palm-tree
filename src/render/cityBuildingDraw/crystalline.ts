import type { DrawBuildingContext } from "./types";
import { lighten, darken, buildingHeight, getOpts } from "./primitives";

export function drawCrystalline(opts: DrawBuildingContext): void {
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

export function drawCrystalSpire(
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
