import type { DrawBuildingContext } from "./types";
import { lighten, darken, drawIsoBox, buildingHeight, getOpts } from "./primitives";

export function drawClassic(opts: DrawBuildingContext): void {
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
