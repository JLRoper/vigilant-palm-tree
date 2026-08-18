import { axialToPixel, HEX_SIZE } from "../../core/hex";
import { Hero } from "../../entities/hero";
import { drawHeroSprite, drawHorseSprite } from "../sprites";
import { SpriteProvider } from "../assets";
import { isVisible } from "../fog";
import type { RenderOptions } from "../renderTypes";

const OWNER_DOT_OFFSET_Y = 22;
const OWNER_DOT_RADIUS = 3.5;
const SELECTED_HERO_RING_RADIUS = 14;
const BOB_AMPLITUDE = 6;

export class HeroPainter {
  paint(
    ctx: CanvasRenderingContext2D,
    heroes: readonly Hero[],
    sprites: SpriteProvider,
    visible: Set<string>,
    opts: RenderOptions,
  ): void {
    for (const hero of heroes) {
      const canSee =
        hero.ownerId === opts.viewPlayerId || isVisible(visible, hero.tile.q, hero.tile.r);
      if (!canSee) continue;
      const { x, y } = axialToPixel(hero.tile.q, hero.tile.r);
      const phase = hero.moveProgress * Math.PI * 2;
      const bobY = hero.moving ? -Math.sin(phase) * BOB_AMPLITUDE : 0;
      const scaleY = hero.moving ? 1.0 + 0.06 * Math.sin(phase) : 1.0;
      const variant = hero.horseVariant;

      if (variant === "hero") {
        drawHeroSprite(
          ctx,
          sprites,
          hero.faction,
          x + hero.pixelOffset.x,
          y + hero.pixelOffset.y + bobY,
          hero.facingDirection,
          HEX_SIZE,
          scaleY,
        );
      } else {
        drawHorseSprite(
          ctx,
          sprites,
          variant,
          x + hero.pixelOffset.x,
          y + hero.pixelOffset.y + bobY,
          hero.facingDirection,
          HEX_SIZE,
        );
      }

      const color = opts.colorForOwner(hero.ownerId);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(
        x + hero.pixelOffset.x,
        y + hero.pixelOffset.y + OWNER_DOT_OFFSET_Y,
        OWNER_DOT_RADIUS,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.lineWidth = 1;
      ctx.stroke();
      if (opts.selectedHeroId === hero.id) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(
          x + hero.pixelOffset.x,
          y + hero.pixelOffset.y,
          SELECTED_HERO_RING_RADIUS,
          0,
          Math.PI * 2,
        );
        ctx.stroke();
      }
    }
  }
}
