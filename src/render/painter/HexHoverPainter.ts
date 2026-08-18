import { Axial, axialToPixel, hexCorners } from "../../core/hex";
import { isVisible } from "../fog";

export class HexHoverPainter {
  paint(ctx: CanvasRenderingContext2D, hover: Axial | null, visible: Set<string>): void {
    if (!hover || !isVisible(visible, hover.q, hover.r)) return;
    const { x, y } = axialToPixel(hover.q, hover.r);
    const corners = hexCorners(x, y);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#ffcc00";
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < 6; i++) ctx.lineTo(corners[i].x, corners[i].y);
    ctx.closePath();
    ctx.stroke();
  }
}
