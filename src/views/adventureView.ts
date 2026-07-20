import { Axial, axialToPixel } from "../core/hex";
import { Camera } from "../render/camera";
import { GameMap } from "../map/gameMap";
import { Renderer } from "../render/renderer";
import { Hero } from "../entities/hero";
import { findPath } from "../map/pathfinding";
import type { GameState, HeroId } from "../state/gameState";
import type { TurnController } from "../state/turnController";
import { TERRAIN_COST } from "../map/terrain";

export const MAP_SEED = 42;

export interface LastClickDebug {
  hover: Axial | null;
  path: Axial[];
  reason: string;
  moved: boolean;
}

export interface AdventureViewOptions {
  canvas: HTMLCanvasElement;
  hud: HTMLElement;
  renderer: Renderer;
  map: GameMap;
  camera: Camera;
  heroes: () => Record<string, Hero>;
  getGameState: () => GameState;
  getTurnController: () => TurnController;
  onStateChanged?: () => void;
  onPathChanged: (path: Axial[]) => void;
  onHudUpdate: () => void;
  onRedraw: () => void;
}

export class AdventureView {
  hover: Axial | null = null;
  path: Axial[] = [];
  lastClickDebug: LastClickDebug = { hover: null, path: [], reason: "", moved: false };

  private dragging = false;
  private movedDuringDrag = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private lastX = 0;
  private lastY = 0;

  constructor(private opts: AdventureViewOptions) {
    this.attach();
  }

  private get state(): GameState {
    return this.opts.getGameState();
  }

  private isPlayerTurn(): boolean {
    return this.state.phase.kind === "PLAYER_TURN" && this.state.activePlayerId === 0;
  }

  private attach(): void {
    this.opts.canvas.addEventListener("mousedown", (e) => {
      this.dragging = true;
      this.movedDuringDrag = false;
      this.dragStartX = e.clientX;
      this.dragStartY = e.clientY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });

    window.addEventListener("mouseup", () => (this.dragging = false));

    window.addEventListener("mousemove", (e) => {
      if (this.dragging) {
        this.opts.camera.pan(e.clientX - this.lastX, e.clientY - this.lastY);
        this.lastX = e.clientX;
        this.lastY = e.clientY;
        if (
          Math.abs(e.clientX - this.dragStartX) +
            Math.abs(e.clientY - this.dragStartY) >
          4
        ) {
          this.movedDuringDrag = true;
        }
      }
      this.hover = this.opts.renderer.hoverFromScreen(e.clientX, e.clientY);
      if (!this.dragging && this.hover && this.isPlayerTurn()) {
        const selectedId = this.state.selectedHeroId;
        const startTile = selectedId ? this.state.heroes[selectedId] : null;
        const start: Axial = startTile
          ? { q: startTile.q, r: startTile.r }
          : { q: -1, r: -1 };
        if (start.q >= 0 && this.opts.map.isPassable(this.hover.q, this.hover.r)) {
          this.path = findPath(this.opts.map, start, this.hover);
        } else {
          this.path = [];
        }
        this.opts.onPathChanged(this.path);
      } else {
        this.path = [];
        this.opts.onPathChanged(this.path);
      }
      this.opts.onHudUpdate();
      this.opts.onRedraw();
    });

    this.opts.canvas.addEventListener("click", (e) => {
      this.lastClickDebug.reason = "";
      if (this.movedDuringDrag) {
        this.lastClickDebug.reason = "movedDuringDrag";
        return;
      }
      if (!this.isPlayerTurn()) {
        this.lastClickDebug.reason = "not_player_turn";
        return;
      }
      const t = this.opts.renderer.hoverFromScreen(e.clientX, e.clientY);
      this.lastClickDebug.hover = t;
      if (!t) {
        this.lastClickDebug.reason = "no hover";
        return;
      }
      const heroes = this.opts.heroes();
      const clickedHero = Object.values(heroes).find(
        (h) => h.tile.q === t.q && h.tile.r === t.r
      );
      if (clickedHero && clickedHero.ownerId === 0) {
        const tc = this.opts.getTurnController();
        tc.selectHero(clickedHero.id as HeroId);
        this.opts.onStateChanged?.();
        this.lastClickDebug.moved = false;
        this.lastClickDebug.reason = "select";
        this.opts.onHudUpdate();
        return;
      }
      const selectedId = this.state.selectedHeroId;
      if (!selectedId) {
        this.lastClickDebug.reason = "no selection";
        return;
      }
      const startTile = this.state.heroes[selectedId];
      if (!startTile) {
        this.lastClickDebug.reason = "no hero";
        return;
      }
      const newPath = findPath(this.opts.map, { q: startTile.q, r: startTile.r }, t);
      this.lastClickDebug.path = newPath;
      if (newPath.length === 0) {
        this.lastClickDebug.reason = "empty path";
        return;
      }
      this.path = newPath;
      this.opts.onPathChanged(this.path);
      let cost = 0;
      for (const step of newPath) {
        const terrain = this.opts.map.get(step.q, step.r);
        if (terrain) cost += TERRAIN_COST[terrain];
        else cost += 1;
      }
      const tc = this.opts.getTurnController();
      const ok = tc.requestMove(selectedId, t, cost);
      this.opts.onStateChanged?.();
      this.lastClickDebug.moved = ok;
      this.opts.onHudUpdate();
      this.opts.onRedraw();
    });

    this.opts.canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        this.opts.camera.zoomAt(e.clientX, e.clientY, factor);
        this.opts.onRedraw();
      },
      { passive: false }
    );
  }

  centerOn(q: number, r: number): void {
    const camera = this.opts.camera;
    const SQRT3 = Math.sqrt(3);
    const size = 32;
    const wx = size * (SQRT3 * q + (SQRT3 / 2) * r);
    const wy = size * (1.5 * r);
    camera.x = window.innerWidth / 2 - wx * camera.zoom;
    camera.y = window.innerHeight / 2 - wy * camera.zoom;
  }

  centerOnMap(): void {
    const map = this.opts.map;
    this.centerOn((map.width - 1) / 2, (map.height - 1) / 2);
  }

  resize(dpr: number): void {
    const canvas = this.opts.canvas;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    this.opts.camera.setDpr(dpr);
    this.centerOnMap();
  }

  getSelectedHeroScreen(): Axial | null {
    const id = this.state.selectedHeroId;
    if (!id) return null;
    const h = this.state.heroes[id];
    if (!h) return null;
    return { q: h.q, r: h.r };
  }
}

export { axialToPixel };
