import { Axial, axialToPixel, hexCorners } from "../../core/hex";

export class SelectedTilePainter {
  paint(ctx: CanvasRenderingContext2D, tile: Axial | null | undefined): void {
    if (!tile) return;
    const { x, y } = axialToPixel(tile.q, tile.r);
    const corners = hexCorners(x, y);
    ctx.save();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#ffffff";
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < 6; i++) ctx.lineTo(corners[i].x, corners[i].y);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
}
