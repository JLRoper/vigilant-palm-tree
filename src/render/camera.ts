import { HEX_SIZE, axialToPixel, pixelToAxialExact, type Axial } from "../core/hex";

export const HEX_COLUMN_WIDTH = HEX_SIZE * Math.sqrt(3);

/** World-pixel bounding box of a pointy-top axial map's hexes (corners included). */
export interface MapWorldExtent {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * The pixel extent the map's own tiles occupy, corners included — what the
 * camera clamps against. Four corner hexes bound a pointy-top axial grid, so
 * the extent is exact without walking every tile.
 */
export function mapWorldExtent(
  mapWidth: number,
  mapHeight: number,
  size = HEX_SIZE,
): MapWorldExtent {
  const halfW = (size * Math.sqrt(3)) / 2;
  const corners = [
    axialToPixel(0, 0, size),
    axialToPixel(mapWidth - 1, 0, size),
    axialToPixel(0, mapHeight - 1, size),
    axialToPixel(mapWidth - 1, mapHeight - 1, size),
  ];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of corners) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX: minX - halfW, maxX: maxX + halfW, minY: minY - size, maxY: maxY + size };
}

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

  /**
   * Keep the map's own extent overlapping the viewport, at any zoom level.
   *
   * Without this a drag can walk the camera arbitrarily far off the map: the
   * renderer's per-frame query clamps the TILES it asks about to the map's
   * bounds, so a runaway camera paints nothing and the player stares at the
   * black background with no way back except a minimap click (F3).
   *
   * When the whole map fits in the viewport at the current zoom, there is no
   * edge to pin, so the camera is centred on it instead. Returns true when the
   * camera moved, so a caller can decide to redraw.
   */
  clampToMap(
    viewportW: number,
    viewportH: number,
    mapWidth: number,
    mapHeight: number,
  ): boolean {
    const extent = mapWorldExtent(mapWidth, mapHeight);
    const beforeX = this.x;
    const beforeY = this.y;

    const spanX = (extent.maxX - extent.minX) * this.zoom;
    if (spanX >= viewportW) {
      const min = viewportW - extent.maxX * this.zoom;
      const max = -extent.minX * this.zoom;
      this.x = Math.min(max, Math.max(min, this.x));
    } else {
      this.x = viewportW / 2 - ((extent.minX + extent.maxX) / 2) * this.zoom;
    }

    const spanY = (extent.maxY - extent.minY) * this.zoom;
    if (spanY >= viewportH) {
      const min = viewportH - extent.maxY * this.zoom;
      const max = -extent.minY * this.zoom;
      this.y = Math.min(max, Math.max(min, this.y));
    } else {
      this.y = viewportH / 2 - ((extent.minY + extent.maxY) / 2) * this.zoom;
    }

    return this.x !== beforeX || this.y !== beforeY;
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
