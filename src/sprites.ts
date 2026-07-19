import { Faction } from "./hero";
import { CastleLevel } from "./castles";

const castleImages: Partial<Record<CastleLevel, HTMLImageElement>> = {};
const castleReady: Partial<Record<CastleLevel, boolean>> = {};

export function preloadCastleSprites() {
  for (const lvl of [1, 2, 3] as CastleLevel[]) {
    if (castleImages[lvl]) continue;
    const img = new Image();
    img.src = `src/resources/castle-l${lvl}.png`;
    castleImages[lvl] = img;
    castleReady[lvl] = false;
    img.onload = () => {
      castleReady[lvl] = true;
    };
  }
}

export function drawCastleSprite(
  ctx: CanvasRenderingContext2D,
  level: CastleLevel,
  cx: number,
  cy: number,
  hexSize: number
) {
  const img = castleImages[level];
  if (!img || !castleReady[level] || img.naturalWidth === 0) return;
  const targetHeight = hexSize * (level === 1 ? 1.5 : level === 2 ? 2.2 : 3.0);
  const aspect = img.naturalWidth / img.naturalHeight;
  const w = targetHeight * aspect;
  const h = targetHeight;
  const anchorY = cy + hexSize * 0.5;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, cx - w / 2, anchorY - h, w, h);
}

export function drawHeroSprite(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  faction: Faction
) {
  if (faction === "player") {
    drawKnight(ctx, cx, cy, size);
  } else {
    drawDemon(ctx, cx, cy, size);
  }
}

function drawKnight(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number) {
  const r = size * 0.9;
  ctx.fillStyle = "#ffcc00";
  ctx.strokeStyle = "#3a2a00";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy + r * 0.15, r * 0.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(cx, cy - r * 0.15, r * 0.45, Math.PI, 0);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#1a1a1a";
  ctx.fillRect(cx - 2, cy - r * 0.05, 1.5, r * 0.3);
  ctx.fillRect(cx + 0.5, cy - r * 0.05, 1.5, r * 0.3);

  ctx.strokeStyle = "#ffcc00";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx + r * 0.7, cy - r * 0.6);
  ctx.lineTo(cx + r * 1.2, cy - r * 1.1);
  ctx.stroke();

  ctx.fillStyle = "#cc1a1a";
  ctx.fillRect(cx + r * 1.0, cy - r * 1.25, r * 0.4, r * 0.25);
  ctx.strokeStyle = "#3a2a00";
  ctx.lineWidth = 1;
  ctx.strokeRect(cx + r * 1.0, cy - r * 1.25, r * 0.4, r * 0.25);
}

function drawDemon(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number) {
  const r = size * 0.9;
  ctx.fillStyle = "#7a1a1a";
  ctx.strokeStyle = "#1a0000";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy + r * 0.1, r * 0.75, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#7a1a1a";
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.4, cy - r * 0.55);
  ctx.lineTo(cx - r * 0.1, cy - r * 0.15);
  ctx.lineTo(cx - r * 0.7, cy - r * 0.1);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + r * 0.4, cy - r * 0.55);
  ctx.lineTo(cx + r * 0.1, cy - r * 0.15);
  ctx.lineTo(cx + r * 0.7, cy - r * 0.1);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#ffcc00";
  ctx.beginPath();
  ctx.arc(cx - r * 0.3, cy - r * 0.15, r * 0.12, 0, Math.PI * 2);
  ctx.arc(cx + r * 0.3, cy - r * 0.15, r * 0.12, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.arc(cx - r * 0.3, cy - r * 0.15, r * 0.05, 0, Math.PI * 2);
  ctx.arc(cx + r * 0.3, cy - r * 0.15, r * 0.05, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#3a0000";
  ctx.fillRect(cx - r * 0.2, cy + r * 0.25, r * 0.4, r * 0.05);
}
