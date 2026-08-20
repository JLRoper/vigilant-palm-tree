import { Camera } from "../render/camera";
import { MapRenderer } from "../render/renderer";
import type { RenderOptions } from "../render/renderTypes";
import { MinimapCamera } from "../render/minimap";
import { GameMap } from "../map/gameMap";
import { Hero } from "../entities/hero";
import { Castle } from "../entities/settlement";
import { AdventureView, type AdventureViewOptions } from "@screens/adventure/adventureView";
import { SpriteProvider } from "../render/assets";
import type { Axial } from "../core/hex";
import type { CityView } from "@screens/settlements/cityView/cityView";
import type { CharterState } from "../state/gameState";

export class ViewManager {
  public camera = new Camera();
  public minimapCamera!: MinimapCamera;
  public mapRenderer!: MapRenderer;
  public view!: AdventureView;
  private ctx!: CanvasRenderingContext2D;

  constructor(private canvas: HTMLCanvasElement, private spriteProvider: SpriteProvider) {}

  initializeRenderer(map: GameMap): void {
    this.ctx = this.canvas.getContext("2d")!;
    if (this.minimapCamera) {
      this.minimapCamera.reset(map);
    } else {
      this.minimapCamera = new MinimapCamera(map);
    }
    this.mapRenderer = new MapRenderer(this.ctx, map, this.camera, this.spriteProvider, this.minimapCamera);
  }

  initializeAdventureView(
    opts: Pick<AdventureViewOptions, "heroes" | "getGameState" | "getTurnController" | "onStateChanged" | "onHudUpdate" | "onRedraw" | "getPathPreviewLock" | "setPathPreviewLock" | "onStartCharter" | "getCharterMode" | "setCharterMode" | "getValidCharterHexes" | "onTileInspect">,
  ): void {
    if (this.view) {
      this.view.detach();
    }
    this.view = new AdventureView({
      canvas: this.canvas,
      renderer: this.mapRenderer,
      map: this.mapRenderer.map,
      camera: this.camera,
      minimapCamera: this.minimapCamera,
      onPathChanged: () => {},
      ...opts,
    });
  }

  updateMap(map: GameMap): void {
    if (this.mapRenderer) this.mapRenderer.map = map;
    if (this.view) this.view.setMap(map);
    if (this.minimapCamera) this.minimapCamera.reset(map);
  }

  draw(
    hover: Axial | null,
    heroes: Hero[],
    path: Axial[],
    castles: Castle[],
    opts: RenderOptions,
    activeCharters?: readonly CharterState[],
    validCharterHexes?: Set<string> | null,
  ): void {
    if (!this.mapRenderer) return;
    const fullOpts: RenderOptions = { ...opts, activeCharters, validCharterHexes };
    this.mapRenderer.draw(hover, heroes, path, castles, fullOpts);
  }

  drawCityOverlay(cityView: CityView | undefined): void {
    if (cityView && cityView.isOpen()) {
      cityView.draw(this.ctx, window.innerWidth, window.innerHeight);
    }
  }

  centerOn(q: number, r: number): void {
    this.view?.centerOn(q, r);
  }

  resize(dpr: number): void {
    if (!this.view) return;
    this.view.resize(dpr);
    this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  getHover(): Axial | null {
    return this.view?.hover ?? null;
  }

  getPath(): Axial[] {
    return this.view?.getPath() ?? [];
  }

  getLastClickDebug(): unknown {
    return this.view?.lastClickDebug ?? null;
  }

  hoverFromScreen(x: number, y: number): Axial | null {
    return this.mapRenderer?.hoverFromScreen(x, y) ?? null;
  }

  getInspectedTile(): Axial | null {
    return this.view?.getInspectedTile() ?? null;
  }

  clearInspectedTile(): void {
    this.view?.clearInspectedTile();
  }
}
