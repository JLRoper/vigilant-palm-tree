import {
  cellOrigin,
  cellToScreen,
  cellsInDrawOrder,
  TILE_W,
  TILE_D,
  type CityCell,
  type CityViewSize,
} from "../core/cityGrid";

const FONT_FAMILY = "system-ui, sans-serif";

const COLOR_BG = "#1a1620";
const COLOR_FILL = "#2a2438";
const COLOR_STROKE = "#3a3450";
const COLOR_HOVER_STROKE = "#ffcc00";
const COLOR_TEXT = "#ffffff";

const TIER_LABELS: Record<CityViewSize, string> = {
  5: "5\u00d75 Settlement",
  10: "10\u00d710 Town",
  15: "15\u00d715 Castle",
};

export function computeCityScale(
  size: CityViewSize,
  viewportW: number,
  viewportH: number,
): number {
  if (size <= 10) return 1.0;
  const limitW = viewportW * 0.85;
  const limitH = viewportH * 0.85;
  const maxW = limitW / (size * TILE_W);
  const maxH = limitH / (size * TILE_D);
  return Math.min(1, maxW, maxH);
}

export interface DrawCityViewOptions {
  viewportW: number;
  viewportH: number;
  settlementName: string;
  size: CityViewSize;
  hover: { gx: number; gy: number } | null;
  ownerColor?: string;
}

export function drawCityView(
  ctx: CanvasRenderingContext2D,
  opts: DrawCityViewOptions,
): void {
  const { viewportW, viewportH, settlementName, size, hover } = opts;
  const tileScale = computeCityScale(size, viewportW, viewportH);
  const tw = TILE_W * tileScale;
  const td = TILE_D * tileScale;

  const screenOrigin = { x: viewportW / 2, y: viewportH / 2 };
  const gridOrigin = cellOrigin(size);

  ctx.save();
  ctx.fillStyle = COLOR_BG;
  ctx.fillRect(0, 0, viewportW, viewportH);

  ctx.lineJoin = "miter";
  for (const cell of cellsInDrawOrder(size)) {
    drawCell(ctx, cell, screenOrigin, gridOrigin, tw, td, hover);
  }

  ctx.fillStyle = COLOR_TEXT;
  ctx.font = `14px ${FONT_FAMILY}`;
  ctx.textBaseline = "top";
  ctx.fillText(settlementName, 12, 12);

  ctx.globalAlpha = 0.7;
  ctx.font = `11px ${FONT_FAMILY}`;
  ctx.fillText(TIER_LABELS[size], 12, 30);
  ctx.globalAlpha = 1;

  ctx.restore();
}

function drawCell(
  ctx: CanvasRenderingContext2D,
  cell: CityCell,
  screenOrigin: { x: number; y: number },
  gridOrigin: { x: number; y: number },
  tw: number,
  td: number,
  hover: { gx: number; gy: number } | null,
): void {
  const tileScale = tw / TILE_W;
  const c = cellToScreen(cell.gx, cell.gy, gridOrigin);
  const wx = screenOrigin.x + c.x * tileScale;
  const wy = screenOrigin.y + c.y * tileScale;
  const hw = tw / 2;
  const hh = td / 2;

  ctx.beginPath();
  ctx.moveTo(wx, wy - hh);
  ctx.lineTo(wx + hw, wy);
  ctx.lineTo(wx, wy + hh);
  ctx.lineTo(wx - hw, wy);
  ctx.closePath();

  ctx.fillStyle = COLOR_FILL;
  ctx.fill();

  if (hover && hover.gx === cell.gx && hover.gy === cell.gy) {
    ctx.strokeStyle = COLOR_HOVER_STROKE;
    ctx.lineWidth = 3;
  } else {
    ctx.strokeStyle = COLOR_STROKE;
    ctx.lineWidth = 1;
  }
  ctx.stroke();
}
