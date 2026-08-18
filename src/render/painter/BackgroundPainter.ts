export class BackgroundPainter {
  paint(ctx: CanvasRenderingContext2D, width: number, height: number, color = "#0a0a0a"): void {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, width, height);
  }
}
