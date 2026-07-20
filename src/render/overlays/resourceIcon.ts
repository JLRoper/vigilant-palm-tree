import { GameMap } from "../../map/gameMap";
import { axialToPixel, HEX_SIZE } from "../../core/hex";
import { drawResourceIcon } from "../sprites";
import { SpriteProvider } from "../assets";

export function drawResourceIcons(
  ctx: CanvasRenderingContext2D,
  sprites: SpriteProvider,
  map: GameMap
) {
  ctx.imageSmoothingEnabled = false;
  for (let r = 0; r < map.height; r++) {
    for (let q = 0; q < map.width; q++) {
      const tile = map.resourceTileAt(q, r);
      if (!tile) continue;
      const { x, y } = axialToPixel(q, r);
      drawResourceIcon(ctx, sprites, tile.resource, x, y, HEX_SIZE);
    }
  }
}
