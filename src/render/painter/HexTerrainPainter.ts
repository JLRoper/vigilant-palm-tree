import { axialToPixel, hexCorners } from "../../core/hex";
import { GameMap } from "../../map/gameMap";
import { TERRAIN_COLORS, Terrain } from "../../map/terrain";
import { isVisible } from "../fog";
import { decorationSeed } from "../decorationSeed";

const FOG_FILL = "rgba(8, 10, 16, 0.78)";
const FOG_EDGE = "rgba(8, 10, 16, 0.55)";

export class HexTerrainPainter {
  paint(ctx: CanvasRenderingContext2D, map: GameMap, visible: Set<string>): void {
    for (let r = 0; r < map.height; r++) {
      for (let q = 0; q < map.width; q++) {
        const t = map.get(q, r);
        if (!t) continue;
        const { x, y } = axialToPixel(q, r);
        this.paintHex(ctx, x, y, t);
        this.paintDecoration(ctx, q, r, x, y, t);
        if (!isVisible(visible, q, r)) {
          this.paintFogHex(ctx, x, y);
        }
      }
    }
  }

  private paintHex(ctx: CanvasRenderingContext2D, cx: number, cy: number, t: Terrain): void {
    const corners = hexCorners(cx, cy);
    const colors = TERRAIN_COLORS[t];
    ctx.fillStyle = colors.fill;
    ctx.strokeStyle = colors.stroke;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < 6; i++) ctx.lineTo(corners[i].x, corners[i].y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  private paintDecoration(
    ctx: CanvasRenderingContext2D,
    q: number,
    r: number,
    cx: number,
    cy: number,
    t: Terrain,
  ): void {
    const seed = decorationSeed(q, r) - Math.floor(decorationSeed(q, r));
    const ox = (seed - 0.5) * 14;
    const oy = (((decorationSeed(q + 7, r - 3)) % 1) - 0.5) * 10;

    if (t === "forest") {
      ctx.fillStyle = "#0d2a14";
      ctx.beginPath();
      ctx.moveTo(cx + ox, cy + oy - 10);
      ctx.lineTo(cx + ox - 8, cy + oy + 6);
      ctx.lineTo(cx + ox + 8, cy + oy + 6);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#5a3a1a";
      ctx.fillRect(cx + ox - 1.5, cy + oy + 5, 3, 4);
    } else if (t === "water") {
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx + ox, cy + oy, 4, 0.2 * Math.PI, 0.9 * Math.PI);
      ctx.stroke();
    } else if (t === "desert") {
      ctx.strokeStyle = "rgba(80,60,30,0.55)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx + ox - 7, cy + oy - 2);
      ctx.lineTo(cx + ox - 3, cy + oy - 5);
      ctx.moveTo(cx + ox + 2, cy + oy + 3);
      ctx.lineTo(cx + ox + 6, cy + oy + 1);
      ctx.moveTo(cx + ox - 5, cy + oy + 5);
      ctx.lineTo(cx + ox - 1, cy + oy + 3);
      ctx.stroke();
      ctx.fillStyle = "rgba(120,90,50,0.6)";
      ctx.beginPath();
      ctx.arc(cx + ox + 9, cy + oy + 4, 1, 0, Math.PI * 2);
      ctx.arc(cx + ox - 10, cy + oy - 6, 1, 0, Math.PI * 2);
      ctx.arc(cx + ox + 3, cy + oy - 9, 1, 0, Math.PI * 2);
      ctx.fill();
    } else if (t === "mountain") {
      ctx.fillStyle = "#5a5a64";
      ctx.beginPath();
      ctx.moveTo(cx + ox, cy + oy - 14);
      ctx.lineTo(cx + ox - 14, cy + oy + 8);
      ctx.lineTo(cx + ox + 14, cy + oy + 8);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#f4f4f8";
      ctx.beginPath();
      ctx.moveTo(cx + ox, cy + oy - 14);
      ctx.lineTo(cx + ox - 4, cy + oy - 6);
      ctx.lineTo(cx + ox + 4, cy + oy - 6);
      ctx.closePath();
      ctx.fill();
    }
  }

  private paintFogHex(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
    const corners = hexCorners(cx, cy);
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < 6; i++) ctx.lineTo(corners[i].x, corners[i].y);
    ctx.closePath();
    ctx.fillStyle = FOG_FILL;
    ctx.fill();
    ctx.strokeStyle = FOG_EDGE;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}
