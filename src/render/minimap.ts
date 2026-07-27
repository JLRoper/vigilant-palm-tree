import { Hero } from "../entities/hero";
import { GameMap } from "../map/gameMap";
import { TERRAIN_COLORS } from "../map/terrain";
import { drawMinimapPath } from "./overlays/pathOverlay";
import { isVisible } from "./fog";
import type { Axial } from "../core/hex";

const MINIMAP_WIDTH = 180;
const MINIMAP_PAD = 10;
const HIT_PAD = 4;

export interface MinimapGeometry {
  x0: number;
  y0: number;
  w: number;
  h: number;
  centerX: number;
  centerY: number;
  baseScale: number;
}

interface MinimapRenderOptions {
  viewPlayerId: number;
  colorForOwner: (ownerId: number | null) => string;
}

export function getMinimapGeometry(map: GameMap): MinimapGeometry {
  const w = MINIMAP_WIDTH;
  const h = (map.height / map.width) * w;
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

export function isPointInMinimap(x: number, y: number, geo: MinimapGeometry): boolean {
  return (
    x >= geo.x0 - HIT_PAD &&
    x <= geo.x0 + geo.w + HIT_PAD &&
    y >= geo.y0 - HIT_PAD &&
    y <= geo.y0 + geo.h + HIT_PAD
  );
}

/**
 * Owns the minimap's own local pan/zoom/rotation, independent of the main
 * game camera. Rotation is purely cosmetic (rotates the minimap drawing
 * around its center) — it never touches the main camera or hex math.
 */
export class MinimapCamera {
  static readonly MIN_ZOOM = 1;
  static readonly MAX_ZOOM = 5;

  zoom = 1;
  rotation = 0;
  panQ = 0;
  panR = 0;

  constructor(map: GameMap) {
    this.reset(map);
  }

  reset(map: GameMap): void {
    this.zoom = 1;
    this.rotation = 0;
    this.panQ = (map.width - 1) / 2;
    this.panR = (map.height - 1) / 2;
  }

  private clampPan(map: GameMap): void {
    this.panQ = Math.max(0, Math.min(map.width - 1, this.panQ));
    this.panR = Math.max(0, Math.min(map.height - 1, this.panR));
  }

  /** World (q, r) -> pre-rotation screen point (the canvas rotation transform handles the twist at draw time). */
  worldToScreen(q: number, r: number, geo: MinimapGeometry): { x: number; y: number } {
    const scale = geo.baseScale * this.zoom;
    return {
      x: geo.centerX + (q - this.panQ) * scale,
      y: geo.centerY + (r - this.panR) * scale,
    };
  }

  /** Actual (post-rotation) screen point -> world (q, r). Inverse of worldToScreen + the canvas rotation. */
  screenToWorld(x: number, y: number, geo: MinimapGeometry): { q: number; r: number } {
    const dx0 = x - geo.centerX;
    const dy0 = y - geo.centerY;
    const cos = Math.cos(-this.rotation);
    const sin = Math.sin(-this.rotation);
    const dx = dx0 * cos - dy0 * sin;
    const dy = dx0 * sin + dy0 * cos;
    const scale = geo.baseScale * this.zoom;
    return { q: this.panQ + dx / scale, r: this.panR + dy / scale };
  }

  /** Zoom while keeping the world point under (x, y) fixed on screen — used for wheel/trackpad pinch. */
  zoomAt(x: number, y: number, factor: number, geo: MinimapGeometry, map: GameMap): void {
    const before = this.screenToWorld(x, y, geo);
    this.zoom = Math.max(MinimapCamera.MIN_ZOOM, Math.min(MinimapCamera.MAX_ZOOM, this.zoom * factor));
    const after = this.screenToWorld(x, y, geo);
    this.panQ += before.q - after.q;
    this.panR += before.r - after.r;
    this.clampPan(map);
  }

  /** Drags the minimap's own view so the world point under (fromX, fromY) ends up under (toX, toY). */
  panBy(fromX: number, fromY: number, toX: number, toY: number, geo: MinimapGeometry, map: GameMap): void {
    const before = this.screenToWorld(fromX, fromY, geo);
    const after = this.screenToWorld(toX, toY, geo);
    this.panQ += before.q - after.q;
    this.panR += before.r - after.r;
    this.clampPan(map);
  }

  /**
   * Applies a combined two-finger pinch (zoom) + twist (rotate), anchored so the
   * world point captured at gesture start (`anchor`) stays glued under the
   * current finger midpoint (midX, midY).
   */
  applyPinchRotate(
    midX: number,
    midY: number,
    zoom: number,
    rotation: number,
    anchor: { q: number; r: number },
    geo: MinimapGeometry,
    map: GameMap,
  ): void {
    this.zoom = Math.max(MinimapCamera.MIN_ZOOM, Math.min(MinimapCamera.MAX_ZOOM, zoom));
    this.rotation = rotation;
    const after = this.screenToWorld(midX, midY, geo);
    this.panQ += anchor.q - after.q;
    this.panR += anchor.r - after.r;
    this.clampPan(map);
  }
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

export function drawMinimap(
  ctx: CanvasRenderingContext2D,
  map: GameMap,
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
      ctx.fillStyle = isVisible(visible, q, r) ? TERRAIN_COLORS[t].fill : "rgba(0,0,0,0.85)";
      ctx.fillRect(x - half, y - half, cellSize + 0.5, cellSize + 0.5);
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

  ctx.restore();

  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 1;
  ctx.strokeRect(boxX, boxY, boxW, boxH);

  drawNorthIndicator(ctx, geo, minimapCamera.rotation);

  ctx.restore();
}
