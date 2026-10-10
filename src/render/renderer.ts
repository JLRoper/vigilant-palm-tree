import { Axial, pixelToAxial } from "../core/hex";
import { Camera } from "./camera";
import { GameMap } from "../map/gameMap";
import { SpriteProvider } from "./assets";
import { computeVision, isVisible } from "./fog";
import { heroFadeAlpha, observeHeroSightings, pruneHeroSightings } from "./heroSpotted";
import { MinimapCamera } from "./minimapCamera";
import { drawMinimap } from "./minimap";
import type { RenderOptions } from "./renderTypes";
import { buildAdventureScene } from "./scene/sceneBuilder/adventureScene";
import { paintScene } from "./scene/paint2d";
import { createPaint2DDep } from "./paint2dDefaults";
import type { Paint2DDep } from "./scene/paint2d/deps";
import type { EntityMirror } from "./scene/entityMirror";

const BACKGROUND = "#0a0a0a";

export class MapRenderer {
  public map: GameMap;
  private readonly paint2d: Paint2DDep;
  private colorForOwner: (ownerId: number | null) => string = () => "#ffffff";
  private readonly mirror: EntityMirror;

  constructor(
    private ctx: CanvasRenderingContext2D,
    map: GameMap,
    private camera: Camera,
    private sprites: SpriteProvider,
    private minimapCamera: MinimapCamera,
    mirror: EntityMirror,
  ) {
    this.map = map;
    this.mirror = mirror;
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

  // The hero/castle entities come from the mirror: it stores the exact
  // instances GameEngine's state:committed feed hands it (syncWith), which
  // are the ones the state layer tweens in place.
  draw(hover: Axial | null, path: Axial[], opts: RenderOptions): void {
    const ctx = this.ctx;
    this.colorForOwner = opts.colorForOwner;

    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

    const heroes = this.mirror.getHeroes();
    const castles = this.mirror.getSettlements();
    const visible = computeVision(heroes, castles, opts.viewPlayerId);
    const nowMs = performance.now();
    const sighted: string[] = [];
    for (const h of heroes) {
      if (h.ownerId !== opts.viewPlayerId && isVisible(visible, h.tile.q, h.tile.r)) sighted.push(h.id);
    }
    observeHeroSightings(sighted, nowMs);
    pruneHeroSightings(new Set(heroes.map((h) => h.id)));
    const heroAlpha: Record<string, number> = {};
    for (const id of sighted) {
      const a = heroFadeAlpha(id, nowMs);
      if (a < 1) heroAlpha[id] = a;
    }
    const nodes = buildAdventureScene({ map: this.map, mirror: this.mirror, heroes, castles, path, hover, opts: { ...opts, heroAlpha }, visible });

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

  getMirror(): EntityMirror {
    return this.mirror;
  }
}
