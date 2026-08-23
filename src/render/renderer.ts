import { Axial, pixelToAxial } from "../core/hex";
import { Camera } from "./camera";
import { Hero } from "../entities/hero";
import { Castle } from "../entities/settlement";
import { GameMap } from "../map/gameMap";
import { SpriteProvider } from "./assets";
import { computeVision } from "./fog";
import { MinimapCamera } from "./minimapCamera";
import { drawMinimap } from "./minimap";
import type { RenderOptions } from "./renderTypes";
import { buildAdventureScene } from "./scene/sceneBuilder/adventureScene";
import { paintScene } from "./scene/paint2d";
import { createPaint2DDep } from "./paint2dDefaults";
import type { Paint2DDep } from "./scene/paint2d/deps";

const BACKGROUND = "#0a0a0a";

export class MapRenderer {
  public map: GameMap;
  private readonly paint2d: Paint2DDep;
  private colorForOwner: (ownerId: number | null) => string = () => "#ffffff";

  constructor(
    private ctx: CanvasRenderingContext2D,
    map: GameMap,
    private camera: Camera,
    private sprites: SpriteProvider,
    private minimapCamera: MinimapCamera,
  ) {
    this.map = map;
    // Built once, not per frame: the sprite resolver is stateless but the dep
    // is the painter's whole external surface, and rebuilding it each draw
    // would allocate a closure set per frame for no gain. The adventure map
    // has no skybox nodes, so no SkyboxProvider is needed.
    this.paint2d = createPaint2DDep({
      spriteProvider: this.sprites,
      skybox: null,
      colorForOwner: (ownerId) => this.colorForOwner(ownerId),
    });
  }

  draw(
    hover: Axial | null,
    heroes: Hero[],
    path: Axial[],
    castles: readonly Castle[],
    opts: RenderOptions,
  ): void {
    const ctx = this.ctx;
    this.colorForOwner = opts.colorForOwner;

    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

    const visible = computeVision(heroes, castles, opts.viewPlayerId);
    const nodes = buildAdventureScene({ map: this.map, heroes, castles, path, hover, opts, visible });

    ctx.save();
    this.camera.apply(ctx);
    paintScene(ctx, nodes, this.paint2d);
    ctx.restore();

    // The minimap is a self-contained secondary view drawn outside the camera
    // transform; the scene graph models no minimap node kinds, so it stays a
    // direct call. See plan/2026-08-19-phase5-final-renderer-rewrite.md §7.
    drawMinimap(ctx, this.map, this.camera, this.minimapCamera, heroes, path, opts, visible);
  }

  hoverFromScreen(sx: number, sy: number): Axial | null {
    const wx = (sx - this.camera.x) / this.camera.zoom;
    const wy = (sy - this.camera.y) / this.camera.zoom;
    const { q, r } = pixelToAxial(wx, wy);
    if (q < 0 || q >= this.map.width || r < 0 || r >= this.map.height) return null;
    return { q, r };
  }
}
