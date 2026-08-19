import { pixelToAxialExact, type Axial } from "../core/hex";

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

  zoomAt(screenX: number, screenY: number, factor: number) {
    const worldX = (screenX - this.x) / this.zoom;
    const worldY = (screenY - this.y) / this.zoom;
    this.zoom = Math.max(0.25, Math.min(3, this.zoom * factor));
    this.x = screenX - worldX * this.zoom;
    this.y = screenY - worldY * this.zoom;
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
