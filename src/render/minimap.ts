import { Hero } from "../entities/hero";
import { GameMap } from "../map/gameMap";
import { TERRAIN_COLORS } from "../map/terrain";
import { drawMinimapPath } from "./overlays/pathOverlay";
import { isVisible } from "./fog";
import type { Axial } from "../core/hex";
import { Camera, getViewportAxialCorners } from "./camera";
import { MinimapCamera } from "./minimapCamera";
import type { MinimapGeometry } from "./renderTypes";

export { MinimapCamera } from "./minimapCamera";
export type { MinimapGeometry } from "./renderTypes";

const MINIMAP_WIDTH = 180;
const MINIMAP_PAD = 10;
const HIT_PAD = 4;
const VISION_EDGE_DIRS = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

interface MinimapRenderOptions {
  viewPlayerId: number;
  colorForOwner: (ownerId: number | null) => string;
}

function minimapPixelHeight(mapWidth: number, mapHeight: number): number {
  return (mapHeight / mapWidth) * MINIMAP_WIDTH;
}

export function getMinimapGeometry(map: GameMap): MinimapGeometry {
  const w = MINIMAP_WIDTH;
  const h = minimapPixelHeight(map.width, map.height);
  const x0 = window.innerWidth - w - MINIMAP_PAD;
  const y0 = window.innerHeight - h - MINIMAP_PAD;
  return {
    x0,
    y0,
    w,
    h,
    centerX: x0 + w / 2,
    centerY: y0 + h / 2,
    baseScale: w / map.width,
  };
}

// Total vertical footprint of the minimap block measured from the window's
// bottom edge -- MINIMAP_PAD's own gap, plus the minimap height, plus the 4px
// the drawn box extends past it (see boxY/boxH in drawMinimap below). UI
// overlays (the panel rail) reserve exactly this much space so they never
// draw over the minimap.
export function getMinimapReserveHeight(mapWidth: number, mapHeight: number): number {
  return MINIMAP_PAD + minimapPixelHeight(mapWidth, mapHeight) + 4;
}

export function isPointInMinimap(x: number, y: number, geo: MinimapGeometry): boolean {
  return (
    x >= geo.x0 - HIT_PAD &&
    x <= geo.x0 + geo.w + HIT_PAD &&
    y >= geo.y0 - HIT_PAD &&
    y <= geo.y0 + geo.h + HIT_PAD
  );
}

// Screen-space corners (in the minimap's *unrotated* local coordinate system
// used by MinimapCamera.worldToScreen) of the main camera's visible viewport.
// Suitable for drawing directly inside drawMinimap's rotated ctx block, which
// applies the minimap's own rotation for free.
export function getFovFrameLocalPoints(
  camera: Camera,
  minimapCamera: MinimapCamera,
  geo: MinimapGeometry,
  screenWidth: number,
  screenHeight: number,
): { x: number; y: number }[] {
  const corners = getViewportAxialCorners(camera, screenWidth, screenHeight);
  return corners.map(({ q, r }) => minimapCamera.worldToScreen(q, r, geo));
}

function rotateAroundPoint(x: number, y: number, cx: number, cy: number, angle: number): { x: number; y: number } {
  const dx = x - cx;
  const dy = y - cy;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

// Same frame, but rotated into real (unrotated) mouse-event screen space —
// i.e. what MinimapCamera.screenToWorld expects as input. Use this for drag
// hit-testing so it agrees with what getFovFrameLocalPoints draws.
export function getFovFrameScreenPolygon(
  camera: Camera,
  minimapCamera: MinimapCamera,
  geo: MinimapGeometry,
  screenWidth: number,
  screenHeight: number,
): { x: number; y: number }[] {
  const local = getFovFrameLocalPoints(camera, minimapCamera, geo, screenWidth, screenHeight);
  return local.map((p) => rotateAroundPoint(p.x, p.y, geo.centerX, geo.centerY, minimapCamera.rotation));
}

// Standard even-odd point-in-polygon test (ray casting).
export function isPointInPolygon(x: number, y: number, poly: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function drawNorthIndicator(ctx: CanvasRenderingContext2D, geo: MinimapGeometry, rotation: number): void {
  const cx = geo.x0 + 13;
  const cy = geo.y0 + 13;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotation);
  ctx.fillStyle = "#ffcc00";
  ctx.beginPath();
  ctx.moveTo(0, -8);
  ctx.lineTo(4, 3);
  ctx.lineTo(0, 0.5);
  ctx.lineTo(-4, 3);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = "9px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("N", 0, 17);
  ctx.restore();
}

function isVisionEdge(visible: Set<string>, q: number, r: number): boolean {
  for (const dir of VISION_EDGE_DIRS) {
    if (!isVisible(visible, q + dir.q, r + dir.r)) return true;
  }
  return false;
}

function drawMistCell(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  time: number,
  q: number,
  r: number,
  opacity: number,
): void {
  const driftA = time * 24;
  const driftB = time * 16;
  const oxA = Math.sin((r * 1.35 + time * 1.4) * 1.3) * size * 0.26;
  const oyA = Math.cos((q * 1.1 + time * 1.1) * 1.2) * size * 0.26;
  const oxB = Math.sin((q * 1.7 - time * 1.2) * 1.1) * size * 0.34;
  const oyB = Math.cos((r * 1.55 - time * 1.5) * 1.05) * size * 0.34;
  const pulse = (Math.sin(time * 2.2 + q * 0.9 + r * 1.3) + 1) * 0.5;

  const g1 = ctx.createLinearGradient(
    x - size * 0.5 + oxA + driftA,
    y + oyA,
    x + size * 1.5 + oxA + driftA,
    y + size + oyA,
  );
  g1.addColorStop(0, `rgba(210, 218, 226, ${opacity * 0.32})`);
  g1.addColorStop(0.5, `rgba(120, 138, 154, ${opacity * 0.46})`);
  g1.addColorStop(1, `rgba(58, 72, 86, ${opacity * 0.32})`);

  const g2 = ctx.createLinearGradient(
    x - size * 0.7 + oxB - driftB,
    y + size * 0.2 + oyB,
    x + size * 1.2 + oxB - driftB,
    y + size * 0.9 + oyB,
  );
  g2.addColorStop(0, `rgba(222, 230, 236, ${opacity * 0.2})`);
  g2.addColorStop(0.6, `rgba(128, 146, 162, ${opacity * 0.3})`);
  g2.addColorStop(1, `rgba(58, 70, 82, ${opacity * 0.2})`);

  ctx.fillStyle = g1;
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = g2;
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = `rgba(188, 200, 212, ${opacity * (0.08 + pulse * 0.18)})`;
  ctx.fillRect(x, y, size, size);
}

export function drawMinimap(
  ctx: CanvasRenderingContext2D,
  map: GameMap,
  camera: Camera,
  minimapCamera: MinimapCamera,
  heroes: Hero[],
  path: Axial[],
  opts: MinimapRenderOptions,
  visible: Set<string>,
): void {
  const geo = getMinimapGeometry(map);
  const boxX = geo.x0 - 4;
  const boxY = geo.y0 - 4;
  const boxW = geo.w + 8;
  const boxH = geo.h + 8;

  ctx.save();
  ctx.beginPath();
  ctx.rect(boxX, boxY, boxW, boxH);
  ctx.clip();

  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(boxX, boxY, boxW, boxH);

  ctx.save();
  ctx.translate(geo.centerX, geo.centerY);
  ctx.rotate(minimapCamera.rotation);
  ctx.translate(-geo.centerX, -geo.centerY);

  const cellSize = geo.baseScale * minimapCamera.zoom;
  const half = cellSize / 2;
  const cullMargin = cellSize + 24;
  const mistTime = performance.now() * 0.001;

  for (let r = 0; r < map.height; r++) {
    for (let q = 0; q < map.width; q++) {
      const t = map.get(q, r);
      if (!t) continue;
      const { x, y } = minimapCamera.worldToScreen(q, r, geo);
      if (
        x < boxX - cullMargin ||
        x > boxX + boxW + cullMargin ||
        y < boxY - cullMargin ||
        y > boxY + boxH + cullMargin
      ) {
        continue;
      }
      const cellX = x - half;
      const cellY = y - half;
      const canSee = isVisible(visible, q, r);
      const edgeOfVision = canSee && isVisionEdge(visible, q, r);

      ctx.fillStyle = canSee ? TERRAIN_COLORS[t].fill : "rgba(12,18,24,0.92)";
      ctx.fillRect(cellX, cellY, cellSize + 0.5, cellSize + 0.5);

      if (!canSee) {
        drawMistCell(ctx, cellX, cellY, cellSize + 0.5, mistTime, q, r, 1.22);
      } else if (edgeOfVision) {
        drawMistCell(ctx, cellX, cellY, cellSize + 0.5, mistTime, q, r, 0.14);
      }
    }
  }

  ctx.fillStyle = "#ffa500";
  for (let r = 0; r < map.height; r++) {
    for (let q = 0; q < map.width; q++) {
      const t = map.resourceTileAt(q, r);
      if (!t) continue;
      if (!isVisible(visible, q, r)) continue;
      const { x, y } = minimapCamera.worldToScreen(q + 0.28, r - 0.28, geo);
      ctx.beginPath();
      ctx.arc(x, y, cellSize * 0.22, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawMinimapPath(ctx, path, minimapCamera, geo);

  for (const hero of heroes) {
    if (hero.ownerId !== opts.viewPlayerId && !isVisible(visible, hero.tile.q, hero.tile.r)) continue;
    const { x, y } = minimapCamera.worldToScreen(hero.tile.q, hero.tile.r, geo);
    ctx.fillStyle = opts.colorForOwner(hero.ownerId);
    ctx.fillRect(x - half - 1, y - half - 1, cellSize + 2, cellSize + 2);
  }

  const fovPoints = getFovFrameLocalPoints(camera, minimapCamera, geo, window.innerWidth, window.innerHeight);
  ctx.beginPath();
  ctx.moveTo(fovPoints[0].x, fovPoints[0].y);
  for (let i = 1; i < fovPoints.length; i++) ctx.lineTo(fovPoints[i].x, fovPoints[i].y);
  ctx.closePath();
  ctx.fillStyle = "rgba(255, 204, 0, 0.1)";
  ctx.fill();
  ctx.strokeStyle = "#ffcc00";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.restore();

  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 1;
  ctx.strokeRect(boxX, boxY, boxW, boxH);

  drawNorthIndicator(ctx, geo, minimapCamera.rotation);

  ctx.restore();
}
