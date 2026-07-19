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
