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

const DRAG_MOVE_THRESHOLD = 4;

function hoverChanged(a: Axial | null, b: Axial | null): boolean {
  if (a === b) return false;
  if (!a || !b) return true;
  return a.q !== b.q || a.r !== b.r;
}

function pathsEqual(a: Axial[], b: Axial[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].q !== b[i].q || a[i].r !== b[i].r) return false;
  }
  return true;
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

  private pendingPointer: { x: number; y: number } | null = null;
  private pointerFrameRequested = false;

  /** When set, the committed destination tile pins the start of the proposed yellow route while the hero is still moving. The rest of the route follows hover as normal. */
  private lockedMove: { heroId: HeroId; waypoint: Axial; reachableIdx: number } | null = null;

  private readonly boundMouseUp = () => this.onMouseUp();
  private readonly boundMouseMove = (e: MouseEvent) => this.onMouseMove(e);
  private readonly boundMouseDown = (e: MouseEvent) => this.onMouseDown(e);
  private readonly boundClick = (e: MouseEvent) => this.onClick(e);
  private readonly boundWheel = (e: WheelEvent) => this.onWheel(e);

  constructor(private opts: AdventureViewOptions) {
    this.attach();
  }

  private get state(): GameState {
    return this.opts.getGameState();
  }

  private isPlayerTurn(): boolean {
    return this.state.phase.kind === "PLAYER_TURN" && this.state.activePlayerId === 0;
  }

  setMap(map: GameMap): void {
    this.opts.map = map;
  }

  getPath(): Axial[] {
    this.maybeClearLock();
    return this.path;
  }

  getReachableIdx(): number | null {
    this.maybeClearLock();
    return this.lockedMove?.reachableIdx ?? null;
  }

  getWaypoint(): Axial | null {
    this.maybeClearLock();
    return this.lockedMove?.waypoint ?? null;
  }

  private maybeClearLock(): void {
    if (!this.lockedMove) return;
    const hero = this.opts.heroes()[this.lockedMove.heroId];
    if (
      this.state.selectedHeroId !== this.lockedMove.heroId ||
      !hero ||
      !hero.moving
    ) {
      this.lockedMove = null;
    }
  }

  private freezeMove(heroId: HeroId, waypoint: Axial, reachableIdx: number): void {
    this.lockedMove = { heroId, waypoint, reachableIdx };
  }

  detach(): void {
    window.removeEventListener("mouseup", this.boundMouseUp);
    window.removeEventListener("mousemove", this.boundMouseMove);
    this.opts.canvas.removeEventListener("mousedown", this.boundMouseDown);
    this.opts.canvas.removeEventListener("click", this.boundClick);
    this.opts.canvas.removeEventListener("wheel", this.boundWheel as EventListener);
  }

  private attach(): void {
    this.opts.canvas.addEventListener("mousedown", this.boundMouseDown);
    window.addEventListener("mouseup", this.boundMouseUp);
    window.addEventListener("mousemove", this.boundMouseMove);
    this.opts.canvas.addEventListener("click", this.boundClick);
    this.opts.canvas.addEventListener(
      "wheel",
      this.boundWheel as EventListener,
      { passive: false }
    );
  }

  private onMouseDown(e: MouseEvent): void {
    this.dragging = true;
    this.movedDuringDrag = false;
    this.dragStartX = e.clientX;
    this.dragStartY = e.clientY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  }

  private onMouseUp(): void {
    this.dragging = false;
  }

  private onMouseMove(e: MouseEvent): void {
    if (this.dragging) {
      this.opts.camera.pan(e.clientX - this.lastX, e.clientY - this.lastY);
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      if (
        Math.abs(e.clientX - this.dragStartX) + Math.abs(e.clientY - this.dragStartY) >
        DRAG_MOVE_THRESHOLD
      ) {
        this.movedDuringDrag = true;
      }
    }

    // Ignore pointer updates when hovering over HTML UI overlays.
    if (e.target !== this.opts.canvas) return;

    this.pendingPointer = { x: e.clientX, y: e.clientY };
    if (!this.pointerFrameRequested) {
      this.pointerFrameRequested = true;
      requestAnimationFrame(() => this.flushPointerState());
    }
  }

  private flushPointerState(): void {
    this.pointerFrameRequested = false;
    if (!this.pendingPointer) return;

    const { x, y } = this.pendingPointer;
    this.pendingPointer = null;

    const nextHover = this.opts.renderer.hoverFromScreen(x, y);
    if (!hoverChanged(this.hover, nextHover)) {
      return;
    }

    this.hover = nextHover;
    this.updatePath();
    this.opts.onHudUpdate();
    this.opts.onRedraw();
  }

  private updatePath(): void {
    if (this.dragging || !this.hover || !this.isPlayerTurn()) {
      this.setPath([]);
      return;
    }

    this.maybeClearLock();

    const start: Axial = this.lockedMove
      ? this.lockedMove.waypoint
      : this.state.selectedHeroId && this.state.heroes[this.state.selectedHeroId]
      ? { q: this.state.heroes[this.state.selectedHeroId].q, r: this.state.heroes[this.state.selectedHeroId].r }
      : { q: -1, r: -1 };

    if (start.q < 0) {
      this.setPath([]);
      return;
    }

    if (!this.opts.map.isPassable(this.hover.q, this.hover.r)) {
      this.setPath([]);
      return;
    }

    this.setPath(findPath(this.opts.map, start, this.hover));
  }

  private setPath(path: Axial[]): void {
    if (pathsEqual(this.path, path)) return;
    this.path = path;
    this.opts.onPathChanged(this.path);
  }

  private onClick(e: MouseEvent): void {
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

    const clickedSettlement = Object.values(this.state.settlements).find(
      (s) => s.q === t.q && s.r === t.r
    );
    if (clickedSettlement) {
      const tc = this.opts.getTurnController();
      tc.selectSettlement(clickedSettlement.id);
      this.opts.onStateChanged?.();
      this.lastClickDebug.moved = false;
      this.lastClickDebug.reason = "settlement_select";
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
    let cumulative = 0;
    let reachableIdx = 0;
    let actualCost = 0;
    let clamped = false;
    for (let i = 0; i < newPath.length; i++) {
      const step = newPath[i];
      const terrain = this.opts.map.get(step.q, step.r);
      const stepCost = terrain ? TERRAIN_COST[terrain] : 1;
      if (!Number.isFinite(stepCost) || stepCost <= 0) break;
      if (cumulative + stepCost > startTile.movementRemaining) {
        clamped = true;
        break;
      }
      cumulative += stepCost;
      reachableIdx = i + 1;
      actualCost = cumulative;
    }
    this.path = newPath;
    this.opts.onPathChanged(this.path);
    if (reachableIdx === 0) {
      this.lastClickDebug.reason = "impassable first step";
      return;
    }
    const dest = newPath[reachableIdx - 1];
    const tc = this.opts.getTurnController();
    // Record every reachable tile (incl. destination) so the trail line in
    // the renderer follows the actual hex path instead of cutting diagonally
    // through it as the crow flies.
    const trailExtension = newPath.slice(0, reachableIdx);
    this.freezeMove(selectedId, dest, reachableIdx);
    const ok = tc.requestMove(selectedId, dest, actualCost, trailExtension);
    if (!ok) {
      this.lockedMove = null;
    }
    this.opts.onStateChanged?.();
    this.lastClickDebug.moved = ok;
    this.lastClickDebug.reason = ok
      ? clamped
        ? `clamped to ${dest.q},${dest.r}`
        : ""
      : "requestMove rejected";
    this.opts.onHudUpdate();
    this.opts.onRedraw();
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    this.opts.camera.zoomAt(e.clientX, e.clientY, factor);
    this.opts.onRedraw();
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
