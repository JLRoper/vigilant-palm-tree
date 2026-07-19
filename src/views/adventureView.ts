import { Axial } from "../core/hex";
import { Camera } from "../render/camera";
import { GameMap } from "../map/gameMap";
import { Renderer } from "../render/renderer";
import { Hero } from "../entities/hero";
import { findPath } from "../map/pathfinding";

export const GAME_NAME = "default";
export const MAP_SEED = 42;
export const ENEMY_START: { q: number; r: number }[] = [
  { q: 18, r: 4 },
  { q: 20, r: 10 },
];

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
  player: Hero;
  isInCombat: () => boolean;
  onPathChanged: (path: Axial[]) => void;
  onHudUpdate: () => void;
  onRedraw: () => void;
  onMoveStarted: (path: Axial[]) => void;
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
      if (!this.dragging && this.hover) {
        this.path = findPath(this.opts.map, this.opts.player.tile, this.hover);
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
      if (this.opts.isInCombat()) {
        this.lastClickDebug.reason = "combat";
        return;
      }
      const t = this.opts.renderer.hoverFromScreen(e.clientX, e.clientY);
      this.lastClickDebug.hover = t;
      if (!t) {
        this.lastClickDebug.reason = "no hover";
        return;
      }
      const newPath = findPath(this.opts.map, this.opts.player.tile, t);
      this.lastClickDebug.path = newPath;
      if (newPath.length === 0) {
        this.lastClickDebug.reason = "empty path";
        return;
      }
      this.path = newPath;
      this.opts.player.startMoveTo(newPath[newPath.length - 1]);
      this.lastClickDebug.moved = true;
      this.opts.onMoveStarted(newPath);
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

  centerOnMap(): void {
    const map = this.opts.map;
    const camera = this.opts.camera;
    const cx = (map.width - 1) / 2;
    const cy = (map.height - 1) / 2;
    const SQRT3 = Math.sqrt(3);
    const size = 32;
    const wx = size * (SQRT3 * cx + (SQRT3 / 2) * cy);
    const wy = size * (1.5 * cy);
    camera.x = window.innerWidth / 2 - wx * camera.zoom;
    camera.y = window.innerHeight / 2 - wy * camera.zoom;
  }

  resize(dpr: number): void {
    const canvas = this.opts.canvas;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    this.opts.camera.setDpr(dpr);
    this.centerOnMap();
  }
}
