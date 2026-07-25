import type { DrawBuildingContext } from "./types";
import { darken, drawIsoBox, buildingHeight, getOpts } from "./primitives";
import { BUILDING_PALETTES } from "../palettes";

export function drawIndustrial(opts: DrawBuildingContext): void {
  const { ctx, cx, cy, hw, hh, kind, level, ownerColor: _oc } = getOpts(opts);
  const H = buildingHeight(kind, level);
  const pal = BUILDING_PALETTES["industrial"];

  const stoneDark = pal.stoneDk!;
  const stoneMid = pal.stoneMd!;
  const metalAccent = pal.accent!;

  drawIsoBox(ctx, cx, cy, hw * 0.85, hh * 0.85, H * 0.6, stoneDark, stoneMid, "", 0);

  const topY = cy - hh * 0.85 - H * 0.6;

  ctx.beginPath();
  ctx.moveTo(cx, topY - hh * 0.15);
  ctx.lineTo(cx + hw * 0.85, topY);
  ctx.lineTo(cx, topY + hh * 0.15);
  ctx.lineTo(cx - hw * 0.85, topY);
  ctx.closePath();
  ctx.fillStyle = stoneMid;
  ctx.fill();
  ctx.strokeStyle = metalAccent;
  ctx.lineWidth = 1;
  ctx.stroke();

  if (kind === "smithy" || kind === "mine") {
    const chimneyX = cx + hw * 0.4;
    const chimneyW = hw * 0.12;
    const chimneyH = H * 0.4;
    ctx.fillStyle = "#222";
    ctx.fillRect(chimneyX, cy - hh * 0.5 - chimneyH, chimneyW, chimneyH);
    ctx.fillStyle = "#666";
    ctx.fillRect(chimneyX - 1, cy - hh * 0.5 - chimneyH, chimneyW + 2, 3);

    for (let p = 0; p < 2; p++) {
      const smokeX = chimneyX + chimneyW / 2 + p * 4;
      const smokeY = cy - hh * 0.5 - chimneyH - p * 6;
      ctx.globalAlpha = 0.15;
      ctx.fillStyle = "#aaa";
      ctx.beginPath();
      ctx.arc(smokeX, smokeY, hw * 0.06, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  if (kind === "townHall" || kind === "barracks") {
    const bw = hw * 0.12;
    const bh = H * 0.12;
    for (let bx = -1; bx <= 1; bx += 2) {
      ctx.fillStyle = metalAccent;
      ctx.fillRect(cx + bx * hw * 0.3, cy + hh * 0.1, bw, bh);
      ctx.strokeStyle = darken(metalAccent, 40);
      ctx.lineWidth = 1;
      ctx.strokeRect(cx + bx * hw * 0.3, cy + hh * 0.1, bw, bh);
    }
  }

  if (kind === "tower") {
    const bw = hw * 0.15;
    const bh = H * 0.15;
    ctx.fillStyle = "#111";
    ctx.fillRect(cx - bw / 2, cy - H * 0.5, bw, bh);
  }
}
