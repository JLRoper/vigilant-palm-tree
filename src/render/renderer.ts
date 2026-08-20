import { Axial, pixelToAxial } from "../core/hex";
import { Camera } from "./camera";
import { Hero } from "../entities/hero";
import { Castle } from "../entities/settlement";
import { GameMap } from "../map/gameMap";
import { drawResourceIcons } from "./overlays/resourceIcon";
import { drawTerritoryOutlines } from "./overlays/territoryOutline";
import { drawPathOverlay } from "./overlays/pathOverlay";
import { SpriteProvider } from "./assets";
import { computeVision } from "./fog";
import { MinimapCamera } from "./minimapCamera";
import { drawMinimap } from "./minimap";
import type { RenderOptions } from "./renderTypes";
import {
  BackgroundPainter,
  CastlePainter,
  CharterPainter,
  HexHoverPainter,
  HexTerrainPainter,
  HeroPainter,
  SelectedTilePainter,
} from "./painter";

export class MapRenderer {
  public map: GameMap;
  private readonly backgroundPainter = new BackgroundPainter();
  private readonly terrainPainter = new HexTerrainPainter();
  private readonly selectedTilePainter = new SelectedTilePainter();
  private readonly hoverPainter = new HexHoverPainter();
  private readonly heroPainter = new HeroPainter();
  private readonly castlePainter = new CastlePainter();
  private readonly charterPainter = new CharterPainter();

  constructor(
    private ctx: CanvasRenderingContext2D,
    map: GameMap,
    private camera: Camera,
    private sprites: SpriteProvider,
    private minimapCamera: MinimapCamera,
  ) {
    this.map = map;
  }

  draw(
    hover: Axial | null,
    heroes: Hero[],
    path: Axial[],
    castles: readonly Castle[],
    opts: RenderOptions,
  ): void {
    const ctx = this.ctx;
    const w = window.innerWidth;
    const h = window.innerHeight;

    this.backgroundPainter.paint(ctx, w, h);

    const visible = computeVision(heroes, castles, opts.viewPlayerId);

    ctx.save();
    this.camera.apply(ctx);

    this.terrainPainter.paint(ctx, this.map, visible);
    drawResourceIcons(ctx, this.sprites, this.map, visible);

    this.charterPainter.paint(ctx, opts.activeCharters, opts.validCharterHexes, visible);

    this.castlePainter.paint(ctx, castles, this.sprites, visible, opts);

    drawTerritoryOutlines(ctx, castles, opts.colorForOwner, this.map.width, this.map.height, visible);

    drawPathOverlay(ctx, heroes, path, this.map, opts);

    this.selectedTilePainter.paint(ctx, opts.inspectedTile);

    this.hoverPainter.paint(ctx, hover, visible);

    this.heroPainter.paint(ctx, heroes, this.sprites, visible, opts);

    ctx.restore();

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
