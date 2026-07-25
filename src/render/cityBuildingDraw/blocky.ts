import type { DrawBuildingContext } from "./types";
import { lighten, darken, drawIsoBox, buildingHeight, getOpts } from "./primitives";
import { BUILDING_PALETTES } from "../palettes";
import type { BuildingPalette } from "../palettes";

export function drawBlocky(opts: DrawBuildingContext): void {
  const { ctx, cx, cy, hw, hh, kind, level, ownerColor } = getOpts(opts);
  const H = buildingHeight(kind, level);
  const pal = BUILDING_PALETTES["blocky"];

  if (kind === "archeryRange") {
    drawBlockyArcheryRange(ctx, cx, cy, hw, hh, H, level, ownerColor, pal);
    return;
  }
  if (kind === "farmhouse") {
    drawBlockyFarmhouse(ctx, cx, cy, hw, hh, H, ownerColor, pal);
    return;
  }
  if (kind === "apartment") {
    drawBlockyHighrise(ctx, cx, cy, hw, hh, H, level, ownerColor, pal);
    return;
  }

  const base = lighten(ownerColor, 20);
  const shade = darken(ownerColor, 10);

  const levels = level + 1;
  let currentTop = cy;
  for (let l = 0; l < levels; l++) {
    const stepH = H / levels;
    const shrink = l * (hw * 0.15);
    const stepHw = hw - shrink;
    const stepHh = hh - shrink;

    ctx.beginPath();
    ctx.moveTo(cx, currentTop - stepHh);
    ctx.lineTo(cx + stepHw, currentTop);
    ctx.lineTo(cx, currentTop + stepHh);
    ctx.lineTo(cx - stepHw, currentTop);
    ctx.closePath();
    ctx.fillStyle = l % 2 === 0 ? base : shade;
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.lineWidth = 1;
    ctx.stroke();

    drawIsoBox(ctx, cx, currentTop, stepHw, stepHh, stepH, shade, base, "", 0.1);

    currentTop -= stepHh * 0.6 + stepH;
  }

  if (kind === "tower") {
    const flagX = cx;
    const flagY = cy - hh - H * 1.1;
    ctx.strokeStyle = lighten(ownerColor, 70);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(flagX, flagY);
    ctx.lineTo(flagX, flagY + H * 0.3);
    ctx.stroke();
    ctx.fillStyle = "#ff4444";
    ctx.fillRect(flagX, flagY, hw * 0.25, H * 0.15);
  }

  if (kind === "house" || kind === "market") {
    const doorX = cx;
    const doorY = cy + hh * 0.15;
    ctx.fillStyle = "#111";
    ctx.fillRect(doorX - hw * 0.1, doorY, hw * 0.2, H * 0.2);
    ctx.fillStyle = lighten(ownerColor, 80);
    ctx.fillRect(cx - hw * 0.35, doorY + H * 0.05, hw * 0.12, H * 0.1);
    ctx.fillRect(cx + hw * 0.15, doorY + H * 0.05, hw * 0.12, H * 0.1);
  }
}

export function drawBlockyArcheryRange(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, hw: number, hh: number, H: number, level: number, ownerColor: string,
  pal: BuildingPalette,
): void {
  const base = lighten(ownerColor, 20);
  const shade = darken(ownerColor, 10);
  const ground = pal.accent ?? "#9090a0";

  const shelterCx = cx - hw * 0.22;
  const shelterCy = cy;
  const shelterHw = hw * 0.38;
  const shelterHh = hh * 0.38;
  const shelterH = H * 0.55;
  const tiers = 1 + level;
  let topY = shelterCy;
  for (let t = 0; t < tiers; t++) {
    const stepH = shelterH / tiers;
    const shrink = t * (shelterHw * 0.18);
    const tHw = shelterHw - shrink;
    const tHh = shelterHh - shrink;
    ctx.beginPath();
    ctx.moveTo(shelterCx, topY - tHh);
    ctx.lineTo(shelterCx + tHw, topY);
    ctx.lineTo(shelterCx, topY + tHh);
    ctx.lineTo(shelterCx - tHw, topY);
    ctx.closePath();
    ctx.fillStyle = t % 2 === 0 ? base : shade;
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.lineWidth = 1;
    ctx.stroke();
    drawIsoBox(ctx, shelterCx, topY, tHw, tHh, stepH, shade, base, "", 0.08);
    topY -= tHh * 0.5 + stepH;
  }

  const rangeLeftX = cx + hw * 0.05;
  const rangeRightX = cx + hw * 0.7;
  const rangeTopY = cy - hh * 0.48;
  const rangeBotY = cy + hh * 0.48;

  ctx.fillStyle = ground;
  ctx.fillRect(rangeLeftX, rangeTopY, rangeRightX - rangeLeftX + 1, rangeBotY - rangeTopY);
  ctx.strokeStyle = darken(ground, 20);
  ctx.lineWidth = 1;
  ctx.strokeRect(rangeLeftX, rangeTopY, rangeRightX - rangeLeftX + 1, rangeBotY - rangeTopY);

  ctx.strokeStyle = "rgba(0,0,0,0.6)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(rangeLeftX, rangeBotY + hh * 0.04);
  ctx.lineTo(rangeLeftX - hw * 0.04, rangeBotY);
  ctx.stroke();

  const tgtCount = 1 + level;
  for (let t = 0; t < tgtCount; t++) {
    const tFrac = (t + 0.5) / tgtCount;
    const tX = rangeLeftX + (rangeRightX - rangeLeftX) * 0.55 + (t - (tgtCount - 1) / 2) * (hw * 0.16);
    const tY = rangeTopY + (rangeBotY - rangeTopY) * tFrac;

    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(tX, tY);
    ctx.lineTo(tX, tY - H * 0.3);
    ctx.stroke();

    const brdCY = tY - H * 0.35;
    const brdSize = Math.min(hw * 0.13, hh * 0.22);
    ctx.fillStyle = "#ccbb66";
    ctx.fillRect(tX - brdSize / 2, brdCY - brdSize / 2, brdSize, brdSize);
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 1;
    ctx.strokeRect(tX - brdSize / 2, brdCY - brdSize / 2, brdSize, brdSize);

    const inner = brdSize * 0.5;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(tX - inner / 2, brdCY - inner / 2, inner, inner);

    const bull = brdSize * 0.2;
    ctx.fillStyle = "#cc2222";
    ctx.fillRect(tX - bull / 2, brdCY - bull / 2, bull, bull);
  }
}

export function drawBlockyFarmhouse(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, hw: number, hh: number, H: number, ownerColor: string,
  _pal: BuildingPalette,
): void {
  const base = lighten(ownerColor, 20);
  const shade = darken(ownerColor, 10);

  const fieldLeftX = cx - hw * 0.82;
  const fieldRightX = cx - hw * 0.05;
  const fieldTopY = cy - hh * 0.55;
  const fieldBotY = cy + hh * 0.55;

  ctx.fillStyle = "#665522";
  ctx.fillRect(fieldLeftX, fieldTopY, fieldRightX - fieldLeftX + 1, fieldBotY - fieldTopY);
  ctx.strokeStyle = "rgba(0,0,0,0.4)";
  ctx.lineWidth = 1;
  ctx.strokeRect(fieldLeftX, fieldTopY, fieldRightX - fieldLeftX + 1, fieldBotY - fieldTopY);

  for (let r = 0; r < 3; r++) {
    const ry = fieldTopY + (fieldBotY - fieldTopY) * (0.2 + r * 0.28);
    ctx.strokeStyle = "#3a2a10";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(fieldLeftX + 2, ry);
    ctx.lineTo(fieldRightX - 2, ry);
    ctx.stroke();
    const count = Math.floor((fieldRightX - fieldLeftX) / (hw * 0.1));
    for (let c = 0; c < count; c++) {
      const fx = fieldLeftX + (fieldRightX - fieldLeftX) * ((c + 0.5) / count);
      ctx.fillStyle = r % 2 === 0 ? "#448822" : "#337711";
      ctx.fillRect(fx - 2, ry - 3, 4, 4);
      ctx.strokeStyle = "rgba(0,0,0,0.3)";
      ctx.lineWidth = 0.5;
      ctx.strokeRect(fx - 2, ry - 3, 4, 4);
    }
  }

  ctx.strokeStyle = "rgba(0,0,0,0.5)";
  ctx.lineWidth = 1.2;
  ctx.strokeRect(fieldLeftX, fieldTopY, fieldRightX - fieldLeftX + 1, fieldBotY - fieldTopY);

  const houseX = cx + hw * 0.22;
  const houseCy = cy - hh * 0.06;
  const bodyHw = hw * 0.34;
  const bodyHh = hh * 0.38;
  const bodyH = H * 0.42;
  const tiers = 2;
  let topY = houseCy;
  for (let t = 0; t < tiers; t++) {
    const stepH = bodyH / tiers;
    const shrink = t * (bodyHw * 0.2);
    const tHw = bodyHw - shrink;
    const tHh = bodyHh - shrink;
    ctx.beginPath();
    ctx.moveTo(houseX, topY - tHh);
    ctx.lineTo(houseX + tHw, topY);
    ctx.lineTo(houseX, topY + tHh);
    ctx.lineTo(houseX - tHw, topY);
    ctx.closePath();
    ctx.fillStyle = t % 2 === 0 ? base : shade;
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.lineWidth = 1;
    ctx.stroke();
    drawIsoBox(ctx, houseX, topY, tHw, tHh, stepH, shade, base, "", 0.08);
    topY -= tHh * 0.5 + stepH;
  }

  ctx.fillStyle = "#111";
  ctx.fillRect(houseX - bodyHw * 0.06, cy + bodyHh * 0.08, bodyHw * 0.13, bodyH * 0.16);
  ctx.strokeStyle = lighten(ownerColor, 40);
  ctx.lineWidth = 0.8;
  ctx.strokeRect(houseX - bodyHw * 0.06, cy + bodyHh * 0.08, bodyHw * 0.13, bodyH * 0.16);
  ctx.fillStyle = lighten(ownerColor, 80);
  ctx.fillRect(houseX + bodyHw * 0.18, cy - bodyH * 0.2, bodyHw * 0.08, bodyH * 0.1);

  const baleX = houseX + hw * 0.04;
  const baleY = cy + hh * 0.38;
  const baleW = hw * 0.16;
  const baleH = hh * 0.24;
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fillRect(baleX - baleW / 2 - 1, baleY + baleH * 0.1, baleW + 2, baleH * 0.12);
  ctx.fillStyle = "#cc9911";
  ctx.fillRect(baleX - baleW / 2, baleY - baleH / 2, baleW, baleH);
  ctx.strokeStyle = "rgba(0,0,0,0.4)";
  ctx.lineWidth = 1;
  ctx.strokeRect(baleX - baleW / 2, baleY - baleH / 2, baleW, baleH);
  ctx.strokeStyle = "#886600";
  ctx.lineWidth = 0.6;
  for (let i = -2; i <= 2; i++) {
    const by = baleY + i * (baleH / 5);
    ctx.beginPath();
    ctx.moveTo(baleX - baleW * 0.4, by);
    ctx.lineTo(baleX + baleW * 0.4, by);
    ctx.stroke();
  }
  for (let i = -1; i <= 1; i += 2) {
    ctx.beginPath();
    ctx.moveTo(baleX + i * baleW * 0.18, baleY - baleH * 0.42);
    ctx.lineTo(baleX + i * baleW * 0.18, baleY + baleH * 0.42);
    ctx.stroke();
  }
}

export function drawBlockyHighrise(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, hw: number, hh: number, H: number, level: number, ownerColor: string,
  _pal: BuildingPalette,
): void {
  const base = lighten(ownerColor, 20);
  const shade = darken(ownerColor, 10);

  const tiers = 2 + level;
  let topY = cy;
  for (let t = 0; t < tiers; t++) {
    const stepH = H / tiers;
    const shrink = t * (hw * 0.1);
    const tHw = hw * 0.82 - shrink;
    const tHh = hh * 0.82 - shrink;

    ctx.beginPath();
    ctx.moveTo(cx, topY - tHh);
    ctx.lineTo(cx + tHw, topY);
    ctx.lineTo(cx, topY + tHh);
    ctx.lineTo(cx - tHw, topY);
    ctx.closePath();
    ctx.fillStyle = t % 2 === 0 ? base : shade;
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.lineWidth = 1;
    ctx.stroke();

    drawIsoBox(ctx, cx, topY, tHw, tHh, stepH, shade, base, "", 0.08);

    const winBandFrac = 0.55;
    const bandY = topY - stepH * winBandFrac;
    const inset = tHw * 0.08;
    const leftEdgeX = cx - tHw + inset * (1 - winBandFrac);
    const rightEdgeX = cx + tHw - inset * (1 - winBandFrac);
    const winW = tHw * 0.06;
    const winH = stepH * 0.2;
    for (let wi = 0; wi < 2; wi++) {
      const frac = (wi + 0.5) / 2;
      const lx = leftEdgeX + (cx - leftEdgeX) * frac;
      ctx.fillStyle = lighten(ownerColor, 80);
      ctx.fillRect(lx - winW / 2, bandY, winW, winH);
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.lineWidth = 0.5;
      ctx.strokeRect(lx - winW / 2, bandY, winW, winH);
      const rx = cx + (rightEdgeX - cx) * frac;
      ctx.fillStyle = lighten(ownerColor, 80);
      ctx.fillRect(rx - winW / 2, bandY, winW, winH);
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.lineWidth = 0.5;
      ctx.strokeRect(rx - winW / 2, bandY, winW, winH);
    }

    topY -= tHh * 0.5 + stepH;
  }

  const mastBaseY = topY;
  const mastTopY = mastBaseY - H * 0.25;
  ctx.strokeStyle = "rgba(0,0,0,0.6)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx, mastBaseY);
  ctx.lineTo(cx, mastTopY);
  ctx.stroke();
  ctx.strokeStyle = "rgba(0,0,0,0.5)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - hw * 0.08, mastTopY + H * 0.08);
  ctx.lineTo(cx + hw * 0.08, mastTopY + H * 0.08);
  ctx.stroke();
}
