import { Camera } from "../render/camera";
import { Renderer, type RenderOptions } from "../render/renderer";
import { GameMap } from "../map/gameMap";
import { Hero } from "../entities/hero";
import { Castle } from "../entities/settlement";
import { AdventureView, type AdventureViewOptions } from "../views/adventureView";
import { SpriteProvider } from "../render/assets";
import type { Axial } from "../core/hex";
import type { CityView } from "../views/cityView";
import type { CharterState } from "../state/gameState";

export class ViewManager {
  public camera = new Camera();
  public renderer!: Renderer;
  public view!: AdventureView;
  private ctx!: CanvasRenderingContext2D;

  constructor(private canvas: HTMLCanvasElement, private spriteProvider: SpriteProvider) {}

  initializeRenderer(map: GameMap): void {
    this.ctx = this.canvas.getContext("2d")!;
    this.renderer = new Renderer(this.ctx, map, this.camera, this.spriteProvider);
  }

  initializeAdventureView(
    hudEl: HTMLElement,
    opts: Pick<AdventureViewOptions, "heroes" | "getGameState" | "getTurnController" | "onStateChanged" | "onHudUpdate" | "onRedraw" | "getPathPreviewLock" | "setPathPreviewLock" | "onStartCharter" | "getCharterMode" | "setCharterMode" | "getValidCharterHexes">,
  ): void {
    if (this.view) {
      this.view.detach();
    }
    this.view = new AdventureView({
      canvas: this.canvas,
      hud: hudEl,
      renderer: this.renderer,
      map: this.renderer.map,
      camera: this.camera,
      onPathChanged: () => {},
      ...opts,
    });
  }

  updateMap(map: GameMap): void {
    if (this.renderer) this.renderer.map = map;
    if (this.view) this.view.setMap(map);
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
    if (!this.renderer) return;
    const fullOpts: RenderOptions = { ...opts, activeCharters, validCharterHexes };
    this.renderer.draw(hover, heroes, path, castles, fullOpts);
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
    return this.renderer?.hoverFromScreen(x, y) ?? null;
  }
}
