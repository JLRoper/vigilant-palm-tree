import type { DrawBuildingContext } from "./types";
import { lighten, darken, drawIsoBox, buildingHeight, getOpts } from "./primitives";
import { BUILDING_PALETTES } from "../palettes";
import type { BuildingPalette } from "../palettes";

export function drawOrganic(opts: DrawBuildingContext): void {
  const { ctx, cx, cy, hw, hh, kind, level, ownerColor } = getOpts(opts);
  const H = buildingHeight(kind, level);
  const pal = BUILDING_PALETTES["organic"];

  if (kind === "apartment") {
    drawOrganicApartment(ctx, cx, cy, hw, hh, H, level, ownerColor, pal);
    return;
  }
  if (kind === "farmField") {
    drawOrganicFarmField(ctx, cx, cy, hw, hh, ownerColor, pal);
    return;
  }
  if (kind === "farmhouse") {
    drawOrganicFarmhouse(ctx, cx, cy, hw, hh, H, ownerColor, pal);
    return;
  }
  if (kind === "archeryRange") {
    drawOrganicArcheryRange(ctx, cx, cy, hw, hh, H, level, ownerColor, pal);
    return;
  }

  const woodBase = pal.wood!;
  const woodLight = pal.woodLt!;
  const woodRoof = darken(ownerColor, 40);

  drawIsoBox(ctx, cx, cy, hw * 0.7, hh * 0.7, H * 0.65, woodBase, woodLight, "", 0.05);

  const roofPeakY = cy - hh * 0.7 - H * 0.65 - H * 0.25;
  const roofEaveY = cy - H * 0.65;
  ctx.beginPath();
  ctx.moveTo(cx - hw * 0.05, roofPeakY + hh * 0.05);
  ctx.quadraticCurveTo(cx, roofPeakY - hh * 0.08, cx + hw * 0.05, roofPeakY + hh * 0.05);
  ctx.quadraticCurveTo(cx + hw * 0.35, roofPeakY + hh * 0.35, cx + hw * 0.85, roofEaveY);
  ctx.quadraticCurveTo(cx, roofEaveY + hh * 0.7, cx - hw * 0.85, roofEaveY);
  ctx.quadraticCurveTo(cx - hw * 0.35, roofPeakY + hh * 0.35, cx - hw * 0.05, roofPeakY + hh * 0.05);
  ctx.fillStyle = woodRoof;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx - hw * 0.05, roofPeakY + hh * 0.05);
  ctx.quadraticCurveTo(cx, roofPeakY - hh * 0.08, cx + hw * 0.05, roofPeakY + hh * 0.05);
  ctx.quadraticCurveTo(cx + hw * 0.3, roofPeakY + hh * 0.2, cx + hw * 0.55, roofEaveY - hh * 0.15);
  ctx.quadraticCurveTo(cx, roofEaveY + hh * 0.15, cx - hw * 0.55, roofEaveY - hh * 0.15);
  ctx.quadraticCurveTo(cx - hw * 0.3, roofPeakY + hh * 0.2, cx - hw * 0.05, roofPeakY + hh * 0.05);
  ctx.fillStyle = lighten(woodRoof, 20);
  ctx.fill();
  ctx.strokeStyle = darken(woodRoof, 15);
  ctx.lineWidth = 0.6;
  for (let t = 0; t < 4; t++) {
    const ty = roofEaveY - H * 0.06 - t * (H * 0.07);
    ctx.beginPath();
    ctx.moveTo(cx - hw * 0.6, ty);
    ctx.quadraticCurveTo(cx, ty + hh * 0.04, cx + hw * 0.6, ty);
    ctx.stroke();
  }

  if (kind === "house" || kind === "market") {
    const dX = cx;
    const dY = cy + hh * 0.1;
    ctx.fillStyle = darken(woodBase, 40);
    ctx.beginPath();
    ctx.ellipse(dX, dY, hw * 0.12, H * 0.15, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.strokeStyle = darken(woodBase, 20);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - hw * 0.2, cy - H * 0.3);
  ctx.quadraticCurveTo(cx - hw * 0.5, cy, cx - hw * 0.2, cy + H * 0.2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + hw * 0.2, cy - H * 0.3);
  ctx.quadraticCurveTo(cx + hw * 0.5, cy, cx + hw * 0.2, cy + H * 0.2);
  ctx.stroke();
}

export function drawOrganicApartment(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, hw: number, hh: number, H: number, level: number, ownerColor: string,
  pal: BuildingPalette,
): void {
  const woodBase = pal.wood!;
  const woodLight = pal.woodLt!;
  const woodDark = pal.woodDk!;
  const roofColor = darken(ownerColor, 40);
  const floors = 1 + level;
  const floorH = H / floors;

  for (let f = 0; f < floors; f++) {
    const shrink = f * (hw * 0.08);
    const fHw = hw * 0.78 - shrink;
    const fHh = hh * 0.78 - shrink;
    const baseCy = cy - f * floorH;
    const leftC = f % 2 === 0 ? woodBase : woodLight;
    const rightC = f % 2 === 0 ? woodLight : woodBase;
    drawIsoBox(ctx, cx, baseCy, fHw, fHh, floorH, leftC, rightC, "", 0.05);

    const bandY = baseCy - floorH * 0.55;
    for (let wi = -1; wi <= 1; wi++) {
      const wx = cx + wi * fHw * 0.28;
      ctx.fillStyle = "#ffe08a";
      ctx.fillRect(wx - fHw * 0.06, bandY, fHw * 0.12, floorH * 0.22);
      ctx.strokeStyle = woodDark;
      ctx.lineWidth = 0.6;
      ctx.strokeRect(wx - fHw * 0.06, bandY, fHw * 0.12, floorH * 0.22);
      ctx.beginPath();
      ctx.moveTo(wx, bandY);
      ctx.lineTo(wx, bandY + floorH * 0.22);
      ctx.stroke();
    }

    if (f % 2 === 1 && f < floors - 1) {
      ctx.strokeStyle = woodDark;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx - fHw * 0.5, baseCy - floorH);
      ctx.lineTo(cx + fHw * 0.5, baseCy - floorH);
      ctx.stroke();
    }
  }

  const topFloorShrink = (floors - 1) * (hw * 0.08);
  const topHw = hw * 0.78 - topFloorShrink;
  const topCy = cy - (floors - 1) * floorH;
  const roofBaseY = topCy - floorH;
  const roofPeakY = roofBaseY - floorH * 1.4;
  ctx.beginPath();
  ctx.moveTo(cx - topHw * 0.05, roofPeakY + hh * 0.05);
  ctx.quadraticCurveTo(cx, roofPeakY - hh * 0.08, cx + topHw * 0.05, roofPeakY + hh * 0.05);
  ctx.quadraticCurveTo(cx + topHw * 0.35, roofPeakY + hh * 0.35, cx + topHw * 0.85, roofBaseY);
  ctx.quadraticCurveTo(cx, roofBaseY + hh * 0.7, cx - topHw * 0.85, roofBaseY);
  ctx.quadraticCurveTo(cx - topHw * 0.35, roofPeakY + hh * 0.35, cx - topHw * 0.05, roofPeakY + hh * 0.05);
  ctx.fillStyle = roofColor;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx - topHw * 0.05, roofPeakY + hh * 0.05);
  ctx.quadraticCurveTo(cx, roofPeakY - hh * 0.08, cx + topHw * 0.05, roofPeakY + hh * 0.05);
  ctx.quadraticCurveTo(cx + topHw * 0.3, roofPeakY + hh * 0.2, cx + topHw * 0.55, roofBaseY - hh * 0.15);
  ctx.quadraticCurveTo(cx, roofBaseY + hh * 0.15, cx - topHw * 0.55, roofBaseY - hh * 0.15);
  ctx.quadraticCurveTo(cx - topHw * 0.3, roofPeakY + hh * 0.2, cx - topHw * 0.05, roofPeakY + hh * 0.05);
  ctx.fillStyle = lighten(roofColor, 20);
  ctx.fill();

  ctx.fillStyle = woodDark;
  ctx.fillRect(cx - topHw * 0.06, roofPeakY + floorH * 0.2, topHw * 0.12, floorH * 0.25);
}

export function drawOrganicFarmField(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, hw: number, hh: number, ownerColor: string,
  pal: BuildingPalette,
): void {
  const soil = pal.soil!;
  const soilDark = pal.soilDk!;
  const furrow = pal.furrow!;
  const cropGreen = pal.crop!;
  const cropDark = pal.cropDk!;
  const fence = pal.fence!;

  ctx.beginPath();
  ctx.moveTo(cx, cy - hh);
  ctx.lineTo(cx + hw, cy);
  ctx.lineTo(cx, cy + hh);
  ctx.lineTo(cx - hw, cy);
  ctx.closePath();
  ctx.fillStyle = soil;
  ctx.fill();
  ctx.strokeStyle = soilDark;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const rowKs = [-hh * 0.42, 0, hh * 0.42];
  for (let i = 0; i < rowKs.length; i++) {
    const k = rowKs[i];
    const half = hw * (1 - Math.abs(k) / hh);
    const ry = cy + k;
    const lx = cx - half;
    const rx = cx + half;

    ctx.strokeStyle = furrow;
    ctx.lineWidth = Math.max(2, hh * 0.06);
    ctx.beginPath();
    ctx.moveTo(lx, ry);
    ctx.lineTo(rx, ry);
    ctx.stroke();

    const tufts = Math.max(6, Math.floor((rx - lx) / (hw * 0.12)));
    for (let t = 0; t <= tufts; t++) {
      const tx = lx + (rx - lx) * (t / tufts);
      ctx.fillStyle = i % 2 === 0 ? cropGreen : cropDark;
      ctx.beginPath();
      ctx.ellipse(tx, ry - hh * 0.05, hw * 0.025, hh * 0.06, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = ownerColor;
    ctx.fillRect(lx - 1, ry - hh * 0.1, 2, hh * 0.12);
    ctx.fillRect(rx - 1, ry - hh * 0.1, 2, hh * 0.12);
  }

  const corners = [
    { x: cx, y: cy - hh },
    { x: cx + hw, y: cy },
    { x: cx, y: cy + hh },
    { x: cx - hw, y: cy },
  ];
  ctx.strokeStyle = fence;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
  ctx.closePath();
  ctx.stroke();
  for (const c of corners) {
    ctx.fillStyle = fence;
    ctx.fillRect(c.x - 1.5, c.y - 3, 3, 6);
  }
}

export function drawOrganicFarmhouse(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, hw: number, hh: number, H: number, ownerColor: string,
  pal: BuildingPalette,
): void {
  const woodBase = pal.wood!;
  const woodLight = pal.woodLt!;
  const woodRoof = darken(ownerColor, 40);

  const houseCx = cx;
  const houseCy = cy - hh * 0.12;
  const bodyHw = hw * 0.62;
  const bodyHh = hh * 0.62;
  const bodyH = H * 0.7;
  drawIsoBox(ctx, houseCx, houseCy, bodyHw, bodyHh, bodyH, woodBase, woodLight, "", 0.05);

  const roofBaseY = houseCy - bodyH;
  const roofPeakY = roofBaseY - H * 0.32;
  ctx.beginPath();
  ctx.moveTo(houseCx - bodyHw * 0.05, roofPeakY + bodyHh * 0.05);
  ctx.quadraticCurveTo(houseCx, roofPeakY - bodyHh * 0.08, houseCx + bodyHw * 0.05, roofPeakY + bodyHh * 0.05);
  ctx.quadraticCurveTo(houseCx + bodyHw * 0.35, roofPeakY + bodyHh * 0.35, houseCx + bodyHw * 0.85, roofBaseY);
  ctx.quadraticCurveTo(houseCx, roofBaseY + bodyHh * 0.7, houseCx - bodyHw * 0.85, roofBaseY);
  ctx.quadraticCurveTo(houseCx - bodyHw * 0.35, roofPeakY + bodyHh * 0.35, houseCx - bodyHw * 0.05, roofPeakY + bodyHh * 0.05);
  ctx.fillStyle = woodRoof;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(houseCx - bodyHw * 0.05, roofPeakY + bodyHh * 0.05);
  ctx.quadraticCurveTo(houseCx, roofPeakY - bodyHh * 0.08, houseCx + bodyHw * 0.05, roofPeakY + bodyHh * 0.05);
  ctx.quadraticCurveTo(houseCx + bodyHw * 0.3, roofPeakY + bodyHh * 0.2, houseCx + bodyHw * 0.55, roofBaseY - bodyHh * 0.15);
  ctx.quadraticCurveTo(houseCx, roofBaseY + bodyHh * 0.15, houseCx - bodyHw * 0.55, roofBaseY - bodyHh * 0.15);
  ctx.quadraticCurveTo(houseCx - bodyHw * 0.3, roofPeakY + bodyHh * 0.2, houseCx - bodyHw * 0.05, roofPeakY + bodyHh * 0.05);
  ctx.fillStyle = lighten(woodRoof, 20);
  ctx.fill();

  ctx.fillStyle = darken(woodBase, 40);
  ctx.beginPath();
  ctx.ellipse(houseCx, houseCy + bodyHh * 0.12, bodyHw * 0.12, bodyH * 0.18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffe08a";
  ctx.fillRect(houseCx + bodyHw * 0.22, houseCy - bodyH * 0.35, bodyHw * 0.12, bodyH * 0.16);
  ctx.strokeStyle = darken(woodBase, 40);
  ctx.lineWidth = 0.8;
  ctx.strokeRect(houseCx + bodyHw * 0.22, houseCy - bodyH * 0.35, bodyHw * 0.12, bodyH * 0.16);

  const baleCx = cx + hw * 0.18;
  const baleCy = cy + hh * 0.42;
  const baleW = hw * 0.26;
  const baleH = hh * 0.42;
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(baleCx, baleCy + baleH * 0.18, baleW * 1.05, baleH * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#d9a521";
  ctx.beginPath();
  ctx.ellipse(baleCx, baleCy, baleW, baleH, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#a9790f";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.strokeStyle = "#a9790f";
  ctx.lineWidth = 0.8;
  for (let b = -2; b <= 2; b++) {
    const by = baleCy + b * (baleH * 0.3);
    const span = baleW * Math.sqrt(Math.max(0, 1 - Math.pow((by - baleCy) / baleH, 2)));
    ctx.beginPath();
    ctx.moveTo(baleCx - span, by);
    ctx.lineTo(baleCx + span, by);
    ctx.stroke();
  }
  ctx.strokeStyle = "#7a5a08";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(baleCx, baleCy - baleH);
  ctx.lineTo(baleCx, baleCy + baleH);
  ctx.stroke();
}

export function drawOrganicArcheryRange(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, hw: number, hh: number, H: number, level: number, ownerColor: string,
  pal: BuildingPalette,
): void {
  const woodBase = pal.wood!;
  const woodLight = pal.woodLt!;
  const woodDark = pal.woodDk!;
  const roofColor = darken(ownerColor, 40);
  const groundColor = "#d4c49c";

  const shelterCx = cx - hw * 0.22;
  const shelterCy = cy;
  const shelterHw = hw * 0.38;
  const shelterHh = hh * 0.38;
  const shelterH = H * 0.6;
  drawIsoBox(ctx, shelterCx, shelterCy, shelterHw, shelterHh, shelterH, woodBase, woodLight, "", 0.05);

  const roofBaseY = shelterCy - shelterH;
  const roofPeakY = roofBaseY - H * 0.2;
  ctx.beginPath();
  ctx.moveTo(shelterCx - shelterHw * 0.05, roofPeakY + shelterHh * 0.05);
  ctx.quadraticCurveTo(shelterCx, roofPeakY - shelterHh * 0.08, shelterCx + shelterHw * 0.05, roofPeakY + shelterHh * 0.05);
  ctx.quadraticCurveTo(shelterCx + shelterHw * 0.35, roofPeakY + shelterHh * 0.35, shelterCx + shelterHw * 0.85, roofBaseY);
  ctx.quadraticCurveTo(shelterCx, roofBaseY + shelterHh * 0.7, shelterCx - shelterHw * 0.85, roofBaseY);
  ctx.quadraticCurveTo(shelterCx - shelterHw * 0.35, roofPeakY + shelterHh * 0.35, shelterCx - shelterHw * 0.05, roofPeakY + shelterHh * 0.05);
  ctx.fillStyle = roofColor;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(shelterCx - shelterHw * 0.05, roofPeakY + shelterHh * 0.05);
  ctx.quadraticCurveTo(shelterCx, roofPeakY - shelterHh * 0.08, shelterCx + shelterHw * 0.05, roofPeakY + shelterHh * 0.05);
  ctx.quadraticCurveTo(shelterCx + shelterHw * 0.3, roofPeakY + shelterHh * 0.2, shelterCx + shelterHw * 0.55, roofBaseY - shelterHh * 0.15);
  ctx.quadraticCurveTo(shelterCx, roofBaseY + shelterHh * 0.15, shelterCx - shelterHw * 0.55, roofBaseY - shelterHh * 0.15);
  ctx.quadraticCurveTo(shelterCx - shelterHw * 0.3, roofPeakY + shelterHh * 0.2, shelterCx - shelterHw * 0.05, roofPeakY + shelterHh * 0.05);
  ctx.fillStyle = lighten(roofColor, 20);
  ctx.fill();

  ctx.strokeStyle = woodDark;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(shelterCx - shelterHw * 0.2, shelterCy - shelterH * 0.35);
  ctx.lineTo(shelterCx + shelterHw * 0.3, shelterCy - shelterH * 0.35);
  ctx.stroke();
  for (let b = -1; b <= 1; b += 2) {
    ctx.beginPath();
    ctx.moveTo(shelterCx + b * shelterHw * 0.25, shelterCy - shelterH * 0.35);
    ctx.quadraticCurveTo(shelterCx + b * shelterHw * 0.2, shelterCy - shelterH * 0.55, shelterCx + b * shelterHw * 0.15, shelterCy - shelterH * 0.45);
    ctx.stroke();
  }

  const rangeLeftX = cx + hw * 0.05;
  const rangeRightX = cx + hw * 0.7;
  const rangeTopY = cy - hh * 0.5;
  const rangeBotY = cy + hh * 0.5;

  ctx.fillStyle = groundColor;
  ctx.beginPath();
  ctx.moveTo(rangeLeftX, rangeTopY);
  ctx.lineTo(rangeRightX, cy - hh * 0.15);
  ctx.lineTo(rangeRightX, cy + hh * 0.15);
  ctx.lineTo(rangeLeftX, rangeBotY);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = darken(groundColor, 30);
  ctx.lineWidth = 0.8;
  ctx.stroke();

  ctx.strokeStyle = woodBase;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(rangeLeftX, rangeBotY + hh * 0.05);
  ctx.lineTo(rangeLeftX - hw * 0.05, rangeBotY);
  ctx.stroke();

  const targetCount = 1 + level;
  for (let t = 0; t < targetCount; t++) {
    const tFraction = (t + 0.5) / targetCount;
    const tX = rangeLeftX + (rangeRightX - rangeLeftX) * 0.5 + (t - (targetCount - 1) / 2) * (hw * 0.18);
    const tY = rangeTopY + (rangeBotY - rangeTopY) * tFraction;

    ctx.strokeStyle = woodDark;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(tX, tY);
    ctx.lineTo(tX, tY - H * 0.35);
    ctx.stroke();

    const targetCY = tY - H * 0.4;
    const targetR = Math.min(hw * 0.08, hh * 0.16);

    ctx.fillStyle = "#d9a521";
    ctx.beginPath();
    ctx.ellipse(tX, targetCY, targetR, targetR * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = woodDark;
    ctx.lineWidth = 0.6;
    ctx.stroke();

    ctx.fillStyle = "#f8f8f0";
    ctx.beginPath();
    ctx.ellipse(tX, targetCY, targetR * 0.55, targetR * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#cc3333";
    ctx.beginPath();
    ctx.ellipse(tX, targetCY, targetR * 0.2, targetR * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();

    const arrowLen = targetR * 1.2;
    const arrowAngle = cx + t * 0.4;
    const arrowTipX = tX + Math.cos(arrowAngle) * targetR * 0.25;
    const arrowTipY = targetCY + Math.sin(arrowAngle) * targetR * 0.15;
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(arrowTipX, arrowTipY);
    ctx.lineTo(arrowTipX - arrowLen * 0.7, arrowTipY - arrowLen * 0.25);
    ctx.stroke();
    ctx.strokeStyle = "#884422";
    ctx.lineWidth = 0.4;
    ctx.beginPath();
    ctx.moveTo(arrowTipX - arrowLen * 0.5, arrowTipY - arrowLen * 0.18);
    ctx.lineTo(arrowTipX - arrowLen * 0.8, arrowTipY - arrowLen * 0.28);
    ctx.stroke();
  }
}
