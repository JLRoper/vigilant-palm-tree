import { HEX_SIZE, pixelToAxialExact, type Axial } from "../core/hex";

export const HEX_COLUMN_WIDTH = HEX_SIZE * Math.sqrt(3);

export function computeMinZoomForHexWidth(
  viewportWidth: number,
  maxHexesWide: number,
  hexSize = HEX_SIZE,
): number {
  if (!(viewportWidth > 0) || !(maxHexesWide > 0)) return 0.25;
  const hexWidth = hexSize * Math.sqrt(3);
  return Math.max(0.25, Math.min(3, viewportWidth / (maxHexesWide * hexWidth)));
}

export interface ViewportAxialBounds {
  qMin: number;
  qMax: number;
  rMin: number;
  rMax: number;
  wxMin?: number;
  wxMax?: number;
  marginHexes?: number;
}

export function getRowQBounds(
  bounds: ViewportAxialBounds,
  r: number,
): { qMin: number; qMax: number } {
  if (bounds.wxMin === undefined || bounds.wxMax === undefined) {
    return { qMin: bounds.qMin, qMax: bounds.qMax };
  }
  const margin = bounds.marginHexes ?? 2;
  const minQForR = Math.floor(bounds.wxMin / HEX_COLUMN_WIDTH - r * 0.5) - margin;
  const maxQForR = Math.ceil(bounds.wxMax / HEX_COLUMN_WIDTH - r * 0.5) + margin;
  return {
    qMin: Math.max(bounds.qMin, minQForR),
    qMax: Math.min(bounds.qMax, maxQForR),
  };
}

export function isTileInViewportBounds(
  bounds: ViewportAxialBounds,
  q: number,
  r: number,
): boolean {
  if (r < bounds.rMin || r > bounds.rMax) return false;
  const rowBounds = getRowQBounds(bounds, r);
  return q >= rowBounds.qMin && q <= rowBounds.qMax;
}

export class Camera {
  x = 0;
  y = 0;
  zoom = 1;
  dpr = 1;

  setDpr(dpr: number) {
    this.dpr = dpr;
  }

  pan(dx: number, dy: number) {
    this.x += dx;
    this.y += dy;
  }

  zoomAt(screenX: number, screenY: number, factor: number, minZoom = 0.25) {
    const worldX = (screenX - this.x) / this.zoom;
    const worldY = (screenY - this.y) / this.zoom;
    const floor = factor < 1 ? Math.min(this.zoom, minZoom) : minZoom;
    this.zoom = Math.max(floor, Math.min(3, this.zoom * factor));
    this.x = screenX - worldX * this.zoom;
    this.y = screenY - worldY * this.zoom;
  }

  clampMinZoom(screenX: number, screenY: number, minZoom: number): boolean {
    if (this.zoom >= minZoom) return false;
    const worldX = (screenX - this.x) / this.zoom;
    const worldY = (screenY - this.y) / this.zoom;
    this.zoom = Math.min(3, minZoom);
    this.x = screenX - worldX * this.zoom;
    this.y = screenY - worldY * this.zoom;
    return true;
  }

  apply(ctx: CanvasRenderingContext2D) {
    const dpr = this.dpr;
    ctx.setTransform(
      dpr * this.zoom,
      0,
      0,
      dpr * this.zoom,
      dpr * this.x,
      dpr * this.y
    );
  }

  getVisibleAxialBounds(
    viewportW: number,
    viewportH: number,
    mapWidth: number,
    mapHeight: number,
    marginHexes = 2,
  ): ViewportAxialBounds {
    const corners = getViewportAxialCorners(this, viewportW, viewportH);
    let minQ = Infinity, maxQ = -Infinity, minR = Infinity, maxR = -Infinity;
    for (const c of corners) {
      if (c.q < minQ) minQ = c.q;
      if (c.q > maxQ) maxQ = c.q;
      if (c.r < minR) minR = c.r;
      if (c.r > maxR) maxR = c.r;
    }
    const wxMin = (0 - this.x) / this.zoom;
    const wxMax = (viewportW - this.x) / this.zoom;
    return {
      qMin: Math.max(0, Math.floor(minQ) - marginHexes),
      qMax: Math.min(mapWidth - 1, Math.ceil(maxQ) + marginHexes),
      rMin: Math.max(0, Math.floor(minR) - marginHexes),
      rMax: Math.min(mapHeight - 1, Math.ceil(maxR) + marginHexes),
      wxMin,
      wxMax,
      marginHexes,
    };
  }
}

// The four screen corners of the camera's visible viewport, inverse-projected
// into unrounded axial (hex) space — used to draw the minimap's field-of-view
// frame. Order: top-left, top-right, bottom-right, bottom-left.
export function getViewportAxialCorners(camera: Camera, screenWidth: number, screenHeight: number): Axial[] {
  const screenCorners = [
    { x: 0, y: 0 },
    { x: screenWidth, y: 0 },
    { x: screenWidth, y: screenHeight },
    { x: 0, y: screenHeight },
  ];
  return screenCorners.map(({ x, y }) => {
    const wx = (x - camera.x) / camera.zoom;
    const wy = (y - camera.y) / camera.zoom;
    return pixelToAxialExact(wx, wy);
  });
}
