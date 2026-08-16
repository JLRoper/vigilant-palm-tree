// MinimapCamera owns the minimap's own local pan/zoom/rotation, independent
// of the main game camera. Rotation is purely cosmetic (rotates the minimap
// drawing around its center) — it never touches the main camera or hex math.
// Lives in its own file so renderer.ts and overlays/pathOverlay.ts can both
// depend on it without creating a triangle through minimap.ts.

import type { GameMap } from "../map/gameMap";
import type { MinimapGeometry } from "./renderTypes";

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

  private clampPan(map: GameMap, geo: MinimapGeometry): void {
    const qHalfSpan = geo.w / (2 * (geo.baseScale * this.zoom));
    if (qHalfSpan * 2 >= map.width - 1) {
      this.panQ = (map.width - 1) / 2;
    } else {
      const qMin = qHalfSpan;
      const qMax = map.width - 1 - qHalfSpan;
      this.panQ = Math.max(qMin, Math.min(qMax, this.panQ));
    }

    const rHalfSpan = geo.h / (2 * (geo.baseScale * this.zoom));
    if (rHalfSpan * 2 >= map.height - 1) {
      this.panR = (map.height - 1) / 2;
    } else {
      const rMin = rHalfSpan;
      const rMax = map.height - 1 - rHalfSpan;
      this.panR = Math.max(rMin, Math.min(rMax, this.panR));
    }
  }

  worldToScreen(q: number, r: number, geo: MinimapGeometry): { x: number; y: number } {
    const scale = geo.baseScale * this.zoom;
    return {
      x: geo.centerX + (q - this.panQ) * scale,
      y: geo.centerY + (r - this.panR) * scale,
    };
  }

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

  zoomAt(x: number, y: number, factor: number, geo: MinimapGeometry, map: GameMap): void {
    const before = this.screenToWorld(x, y, geo);
    this.zoom = Math.max(MinimapCamera.MIN_ZOOM, Math.min(MinimapCamera.MAX_ZOOM, this.zoom * factor));
    const after = this.screenToWorld(x, y, geo);
    this.panQ += before.q - after.q;
    this.panR += before.r - after.r;
    this.clampPan(map, geo);
  }

  panBy(fromX: number, fromY: number, toX: number, toY: number, geo: MinimapGeometry, map: GameMap): void {
    const before = this.screenToWorld(fromX, fromY, geo);
    const after = this.screenToWorld(toX, toY, geo);
    this.panQ += before.q - after.q;
    this.panR += before.r - after.r;
    this.clampPan(map, geo);
  }

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
    this.clampPan(map, geo);
  }
}
