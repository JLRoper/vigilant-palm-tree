import { axialToPixel, HEX_SIZE } from "../../core/hex";
import { Castle } from "../../entities/settlement";
import { drawCastleSprite } from "../sprites";
import { SpriteProvider } from "../assets";
import { isVisible } from "../fog";
import type { RenderOptions } from "../renderTypes";

export class CastlePainter {
  paint(
    ctx: CanvasRenderingContext2D,
    castles: readonly Castle[],
    sprites: SpriteProvider,
    visible: Set<string>,
    opts: RenderOptions,
  ): void {
    for (const c of castles) {
      const canSee = c.ownerId === opts.viewPlayerId || isVisible(visible, c.tile.q, c.tile.r);
      if (!canSee) continue;
      const { x, y } = axialToPixel(c.tile.q, c.tile.r);
      drawCastleSprite(ctx, sprites, c.level, x, y, HEX_SIZE, c.castleVariant);
      this.paintBorder(ctx, x, y, c, opts);
    }
  }

  private paintBorder(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    castle: Castle,
    opts: RenderOptions,
  ): void {
    const color = opts.colorForOwner(castle.ownerId);
    const isSelected = opts.selectedSettlementId === castle.id;
    const radius = isSelected ? HEX_SIZE * 1.05 : HEX_SIZE * 0.95;
    ctx.beginPath();
    ctx.arc(cx, cy + HEX_SIZE * 0.55, radius, 0, Math.PI * 2);
    if (castle.ownerId === null) {
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.setLineDash([4, 4]);
    } else {
      ctx.strokeStyle = color;
      ctx.setLineDash([]);
    }
    ctx.lineWidth = isSelected ? 3 : 2;
    ctx.stroke();
    ctx.setLineDash([]);
  }
}
