import { axialToPixel, hexCorners, HEX_SIZE } from "../../core/hex";
import type { CharterState } from "../../state/gameState";
import { isVisible } from "../fog";

export class CharterPainter {
  paint(
    ctx: CanvasRenderingContext2D,
    charters: readonly CharterState[] | undefined,
    validCharterHexes: Set<string> | null | undefined,
    visible: Set<string>,
  ): void {
    if (charters && charters.length > 0) {
      this.paintActiveCharters(ctx, charters, visible);
    }
    if (validCharterHexes && validCharterHexes.size > 0) {
      this.paintValidCharterHexes(ctx, validCharterHexes, visible);
    }
  }

  private paintActiveCharters(
    ctx: CanvasRenderingContext2D,
    charters: readonly CharterState[],
    visible: Set<string>,
  ): void {
    for (const charter of charters) {
      if (!isVisible(visible, charter.targetQ, charter.targetR)) continue;
      const { x, y } = axialToPixel(charter.targetQ, charter.targetR);
      const corners = hexCorners(x, y);

      if (charter.phase === "traveling") {
        ctx.strokeStyle = "rgba(200, 180, 140, 0.5)";
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 2;
      } else {
        ctx.strokeStyle = "rgba(200, 160, 80, 0.7)";
        ctx.setLineDash([]);
        ctx.lineWidth = 3;
      }

      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (let i = 1; i < 6; i++) ctx.lineTo(corners[i].x, corners[i].y);
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);

      if (charter.phase === "traveling") {
        ctx.fillStyle = "rgba(200, 180, 140, 0.15)";
      } else {
        ctx.fillStyle = "rgba(200, 160, 80, 0.2)";
      }
      ctx.fill();

      if (charter.phase === "constructing") {
        const innerSize = HEX_SIZE * 0.5;
        ctx.strokeStyle = "rgba(160, 120, 60, 0.6)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x - innerSize * 0.5, y - innerSize * 0.3);
        ctx.lineTo(x + innerSize * 0.5, y - innerSize * 0.3);
        ctx.lineTo(x, y - innerSize);
        ctx.closePath();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x - innerSize * 0.5, y - innerSize * 0.3);
        ctx.lineTo(x + innerSize * 0.5, y - innerSize * 0.3);
        ctx.lineTo(x, y + innerSize * 0.2);
        ctx.closePath();
        ctx.stroke();
      }
    }
  }

  private paintValidCharterHexes(
    ctx: CanvasRenderingContext2D,
    hexes: Set<string>,
    visible: Set<string>,
  ): void {
    for (const key of hexes) {
      const [qs, rs] = key.split(",");
      const q = Number(qs);
      const r = Number(rs);
      if (isNaN(q) || isNaN(r)) continue;
      if (!isVisible(visible, q, r)) continue;
      const { x, y } = axialToPixel(q, r);
      const corners = hexCorners(x, y);
      ctx.strokeStyle = "rgba(100, 220, 100, 0.6)";
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (let i = 1; i < 6; i++) ctx.lineTo(corners[i].x, corners[i].y);
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(100, 220, 100, 0.08)";
      ctx.fill();
    }
  }
}
