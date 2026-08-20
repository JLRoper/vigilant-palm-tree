import { Axial, axialToPixel } from "../../core/hex";
import { Camera } from "../../render/camera";
import { GameMap } from "../../map/gameMap";
import { MapRenderer } from "../../render/renderer";
import { Hero } from "../../entities/hero";
import { findPath, computePathCost, NEIGHBOR_DIRS } from "../../map/pathfinding";
import type { GameState, HeroId } from "../../state/gameState";
import type { TurnController } from "../../state/turnController";
import { computeReachableSplit } from "../../render/overlays/pathOverlay";
import type { PathPreviewLock } from "../../managers/GameStateManager";
import { openCenteredModal, styleButton, styleInput } from "@screens/shared/menu";
import {
  MinimapCamera,
  getFovFrameScreenPolygon,
  getMinimapGeometry,
  isPointInMinimap,
  isPointInPolygon,
} from "../../render/minimap";

export const MAP_SEED = 42;

export interface LastClickDebug {
  hover: Axial | null;
  path: Axial[];
  reason: string;
  moved: boolean;
}

export interface AdventureViewOptions {
  canvas: HTMLCanvasElement;
  renderer: MapRenderer;
  map: GameMap;
  camera: Camera;
  minimapCamera: MinimapCamera;
  heroes: () => Record<string, Hero>;
  getGameState: () => GameState;
  getTurnController: () => TurnController;
  onStateChanged?: () => void;
  onPathChanged: (path: Axial[]) => void;
  onHudUpdate: () => void;
  onRedraw: () => void;
  getPathPreviewLock: () => PathPreviewLock | null;
  setPathPreviewLock: (lock: PathPreviewLock | null) => void;
  onStartCharter?: (targetQ: number, targetR: number, name: string) => boolean;
  getCharterMode?: () => boolean;
  setCharterMode?: (v: boolean) => void;
  getValidCharterHexes?: () => Set<string> | null;
  onTileInspect?: (tile: Axial | null) => void;
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

function touchDist(a: Touch, b: Touch): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function touchAngle(a: Touch, b: Touch): number {
  return Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX);
}

type MinimapDragTouchState = {
  id: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  moved: boolean;
};

type MinimapTouchState =
  | ({ mode: "tap" } & MinimapDragTouchState)
  | ({ mode: "frameDrag" } & MinimapDragTouchState)
  | {
      mode: "gesture";
      id1: number;
      id2: number;
      startDist: number;
      startAngle: number;
      startZoom: number;
      startRotation: number;
      anchor: { q: number; r: number };
    };

export class AdventureView {
  hover: Axial | null = null;
  path: Axial[] = [];
  lastClickDebug: LastClickDebug = { hover: null, path: [], reason: "", moved: false };

  private inspectedTile: Axial | null = null;

  private dragging = false;
  private movedDuringDrag = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private lastX = 0;
  private lastY = 0;

  private pendingPointer: { x: number; y: number } | null = null;
  private pointerFrameRequested = false;

  private minimapTouch: MinimapTouchState | null = null;

  private minimapDragging = false;
  private minimapDragMoved = false;
  private minimapDragStartX = 0;
  private minimapDragStartY = 0;
  private minimapLastX = 0;
  private minimapLastY = 0;

  private frameDragging = false;
  private frameDragMoved = false;
  private frameDragStartX = 0;
  private frameDragStartY = 0;
  private frameLastX = 0;
  private frameLastY = 0;

  private readonly boundMouseUp = () => this.onMouseUp();
  private readonly boundMouseMove = (e: MouseEvent) => this.onMouseMove(e);
  private readonly boundMouseDown = (e: MouseEvent) => this.onMouseDown(e);
  private readonly boundClick = (e: MouseEvent) => this.onClick(e);
  private readonly boundWheel = (e: WheelEvent) => this.onWheel(e);
  private readonly boundTouchStart = (e: TouchEvent) => this.onTouchStart(e);
  private readonly boundTouchMove = (e: TouchEvent) => this.onTouchMove(e);
  private readonly boundTouchEnd = (e: TouchEvent) => this.onTouchEnd(e);

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
    this.setInspectedTile(null);
  }

  getPath(): Axial[] {
    return this.path;
  }

  getInspectedTile(): Axial | null {
    return this.inspectedTile;
  }

  clearInspectedTile(): void {
    this.setInspectedTile(null);
  }

  private setInspectedTile(tile: Axial | null): void {
    if (hoverChanged(this.inspectedTile, tile)) {
      this.inspectedTile = tile;
      this.opts.onTileInspect?.(tile);
    }
  }

  detach(): void {
    window.removeEventListener("mouseup", this.boundMouseUp);
    window.removeEventListener("mousemove", this.boundMouseMove);
    this.opts.canvas.removeEventListener("mousedown", this.boundMouseDown);
    this.opts.canvas.removeEventListener("click", this.boundClick);
    this.opts.canvas.removeEventListener("wheel", this.boundWheel as EventListener);
    this.opts.canvas.removeEventListener("touchstart", this.boundTouchStart as EventListener);
    this.opts.canvas.removeEventListener("touchmove", this.boundTouchMove as EventListener);
    this.opts.canvas.removeEventListener("touchend", this.boundTouchEnd as EventListener);
    this.opts.canvas.removeEventListener("touchcancel", this.boundTouchEnd as EventListener);
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
    this.opts.canvas.addEventListener(
      "touchstart",
      this.boundTouchStart as EventListener,
      { passive: false }
    );
    this.opts.canvas.addEventListener(
      "touchmove",
      this.boundTouchMove as EventListener,
      { passive: false }
    );
    this.opts.canvas.addEventListener("touchend", this.boundTouchEnd as EventListener);
    this.opts.canvas.addEventListener("touchcancel", this.boundTouchEnd as EventListener);
  }

  // --- Minimap gestures -----------------------------------------------
  // The minimap has its own local pan/zoom/rotation (opts.minimapCamera),
  // independent of the main game camera. A single tap/click jumps the main
  // camera to that spot; a two-finger pinch zooms the minimap's own view;
  // a two-finger twist rotates the minimap drawing around its center.

  private onTouchStart(e: TouchEvent): void {
    const geo = getMinimapGeometry(this.opts.map);

    if (e.touches.length === 1) {
      const t = e.touches[0];
      if (!isPointInMinimap(t.clientX, t.clientY, geo)) {
        this.minimapTouch = null;
        return;
      }
      const framePoly = getFovFrameScreenPolygon(
        this.opts.camera,
        this.opts.minimapCamera,
        geo,
        window.innerWidth,
        window.innerHeight,
      );
      this.minimapTouch = {
        mode: isPointInPolygon(t.clientX, t.clientY, framePoly) ? "frameDrag" : "tap",
        id: t.identifier,
        startX: t.clientX,
        startY: t.clientY,
        lastX: t.clientX,
        lastY: t.clientY,
        moved: false,
      };
      e.preventDefault();
      return;
    }

    if (e.touches.length === 2) {
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const startedInMinimap =
        this.minimapTouch !== null ||
        isPointInMinimap(t1.clientX, t1.clientY, geo) ||
        isPointInMinimap(t2.clientX, t2.clientY, geo);
      if (!startedInMinimap) {
        this.minimapTouch = null;
        return;
      }
      const midX = (t1.clientX + t2.clientX) / 2;
      const midY = (t1.clientY + t2.clientY) / 2;
      const camera = this.opts.minimapCamera;
      this.minimapTouch = {
        mode: "gesture",
        id1: t1.identifier,
        id2: t2.identifier,
        startDist: touchDist(t1, t2),
        startAngle: touchAngle(t1, t2),
        startZoom: camera.zoom,
        startRotation: camera.rotation,
        anchor: camera.screenToWorld(midX, midY, geo),
      };
      e.preventDefault();
      return;
    }

    this.minimapTouch = null;
  }

  private onTouchMove(e: TouchEvent): void {
    const mt = this.minimapTouch;
    if (!mt) return;

    if (mt.mode === "tap" || mt.mode === "frameDrag") {
      const t = Array.from(e.touches).find((touch) => touch.identifier === mt.id);
      if (!t) return;
      e.preventDefault();

      const dist = Math.hypot(t.clientX - mt.startX, t.clientY - mt.startY);
      if (!mt.moved) {
        if (dist <= DRAG_MOVE_THRESHOLD) return;
        mt.moved = true;
      }

      if (mt.mode === "frameDrag") {
        this.panMainCameraByFrameDrag(mt.lastX, mt.lastY, t.clientX, t.clientY);
      } else {
        const geo = getMinimapGeometry(this.opts.map);
        this.opts.minimapCamera.panBy(mt.lastX, mt.lastY, t.clientX, t.clientY, geo, this.opts.map);
      }
      mt.lastX = t.clientX;
      mt.lastY = t.clientY;
      this.opts.onRedraw();
      return;
    }

    const t1 = Array.from(e.touches).find((touch) => touch.identifier === mt.id1);
    const t2 = Array.from(e.touches).find((touch) => touch.identifier === mt.id2);
    if (!t1 || !t2) return;
    e.preventDefault();

    const geo = getMinimapGeometry(this.opts.map);
    const midX = (t1.clientX + t2.clientX) / 2;
    const midY = (t1.clientY + t2.clientY) / 2;
    const dist = touchDist(t1, t2);
    const factor = mt.startDist > 0 ? dist / mt.startDist : 1;
    const newZoom = mt.startZoom * factor;
    const newRotation = mt.startRotation + (touchAngle(t1, t2) - mt.startAngle);

    this.opts.minimapCamera.applyPinchRotate(midX, midY, newZoom, newRotation, mt.anchor, geo, this.opts.map);
    this.opts.onRedraw();
  }

  private onTouchEnd(e: TouchEvent): void {
    const mt = this.minimapTouch;
    if (!mt) return;

    if ((mt.mode === "tap" || mt.mode === "frameDrag") && !mt.moved) {
      const geo = getMinimapGeometry(this.opts.map);
      const world = this.opts.minimapCamera.screenToWorld(mt.startX, mt.startY, geo);
      this.centerOn(world.q, world.r);
      this.opts.onRedraw();
    }

    if (e.touches.length === 0 || (mt.mode === "gesture" && e.touches.length < 2)) {
      this.minimapTouch = null;
    }
  }

  private onMouseDown(e: MouseEvent): void {
    this.movedDuringDrag = false;
    const minimapGeo = getMinimapGeometry(this.opts.map);
    if (isPointInMinimap(e.clientX, e.clientY, minimapGeo)) {
      const framePoly = getFovFrameScreenPolygon(
        this.opts.camera,
        this.opts.minimapCamera,
        minimapGeo,
        window.innerWidth,
        window.innerHeight,
      );
      if (isPointInPolygon(e.clientX, e.clientY, framePoly)) {
        this.frameDragging = true;
        this.frameDragMoved = false;
        this.frameDragStartX = e.clientX;
        this.frameDragStartY = e.clientY;
        this.frameLastX = e.clientX;
        this.frameLastY = e.clientY;
        return;
      }
      this.minimapDragging = true;
      this.minimapDragMoved = false;
      this.minimapDragStartX = e.clientX;
      this.minimapDragStartY = e.clientY;
      this.minimapLastX = e.clientX;
      this.minimapLastY = e.clientY;
      return;
    }
    this.dragging = true;
    this.dragStartX = e.clientX;
    this.dragStartY = e.clientY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  }

  private onMouseUp(): void {
    this.dragging = false;
    this.minimapDragging = false;
    this.frameDragging = false;
  }

  private panMainCameraByFrameDrag(fromX: number, fromY: number, toX: number, toY: number): void {
    const geo = getMinimapGeometry(this.opts.map);
    const before = this.opts.minimapCamera.screenToWorld(fromX, fromY, geo);
    const after = this.opts.minimapCamera.screenToWorld(toX, toY, geo);
    const { x: dx, y: dy } = axialToPixel(after.q - before.q, after.r - before.r);
    const camera = this.opts.camera;
    camera.x -= dx * camera.zoom;
    camera.y -= dy * camera.zoom;
  }

  private onMouseMove(e: MouseEvent): void {
    if (this.frameDragging) {
      this.panMainCameraByFrameDrag(this.frameLastX, this.frameLastY, e.clientX, e.clientY);
      this.frameLastX = e.clientX;
      this.frameLastY = e.clientY;
      if (
        Math.abs(e.clientX - this.frameDragStartX) + Math.abs(e.clientY - this.frameDragStartY) >
        DRAG_MOVE_THRESHOLD
      ) {
        this.frameDragMoved = true;
      }
      this.opts.onRedraw();
      return;
    }

    if (this.minimapDragging) {
      const geo = getMinimapGeometry(this.opts.map);
      this.opts.minimapCamera.panBy(this.minimapLastX, this.minimapLastY, e.clientX, e.clientY, geo, this.opts.map);
      this.minimapLastX = e.clientX;
      this.minimapLastY = e.clientY;
      if (
        Math.abs(e.clientX - this.minimapDragStartX) + Math.abs(e.clientY - this.minimapDragStartY) >
        DRAG_MOVE_THRESHOLD
      ) {
        this.minimapDragMoved = true;
      }
      this.opts.onRedraw();
      return;
    }

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

    if (isPointInMinimap(e.clientX, e.clientY, getMinimapGeometry(this.opts.map))) {
      this.pendingPointer = null;
      if (this.hover) {
        this.hover = null;
        this.updatePath();
        this.opts.onHudUpdate();
        this.opts.onRedraw();
      }
      return;
    }

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

    const lock = this.opts.getPathPreviewLock();
    const previewHeroId = lock?.heroId ?? this.state.selectedHeroId;
    const start: Axial = lock
      ? lock.waypoint
      : previewHeroId && this.state.heroes[previewHeroId]
      ? { q: this.state.heroes[previewHeroId].q, r: this.state.heroes[previewHeroId].r }
      : { q: -1, r: -1 };

    if (start.q < 0) {
      this.setPath([]);
      return;
    }

    if (!this.opts.map.isPassable(this.hover.q, this.hover.r)) {
      this.setPath([]);
      return;
    }

    const occupiedHexes = new Set<string>();
    for (const [id, hero] of Object.entries(this.state.heroes)) {
      if (id !== previewHeroId) {
        occupiedHexes.add(`${hero.q},${hero.r}`);
      }
    }

    this.setPath(findPath(this.opts.map, start, this.hover, occupiedHexes));
  }

  private setPath(path: Axial[]): void {
    if (pathsEqual(this.path, path)) return;
    this.path = path;
    this.opts.onPathChanged(this.path);
  }

  private onClick(e: MouseEvent): void {
    this.lastClickDebug.reason = "";

    const minimapGeo = getMinimapGeometry(this.opts.map);
    const inMinimap = isPointInMinimap(e.clientX, e.clientY, minimapGeo);
    if (inMinimap) {
      if (this.minimapDragMoved || this.movedDuringDrag || this.frameDragMoved) {
        this.lastClickDebug.reason = "minimap_drag";
        this.minimapDragMoved = false;
        this.frameDragMoved = false;
        return;
      }
      const world = this.opts.minimapCamera.screenToWorld(e.clientX, e.clientY, minimapGeo);
      this.centerOn(world.q, world.r);
      this.lastClickDebug.reason = "minimap_navigate";
      this.opts.onRedraw();
      return;
    }

    if (this.minimapDragMoved || this.frameDragMoved) {
      this.lastClickDebug.reason = "minimap_drag";
      this.minimapDragMoved = false;
      this.frameDragMoved = false;
      return;
    }

    // Resolved once here (rather than separately per branch below) so tile
    // inspection -- a read-only side effect of the click -- always runs,
    // including during the AI's turn and inside the charter-placement branch.
    // A click outside the map (t === null) intentionally leaves the current
    // inspection alone rather than clearing it.
    const t = this.opts.renderer.hoverFromScreen(e.clientX, e.clientY);
    this.lastClickDebug.hover = t;
    if (t) this.setInspectedTile(t);

    if (this.opts.getCharterMode?.() && this.opts.getValidCharterHexes?.()) {
      if (t) {
        const key = `${t.q},${t.r}`;
        const validHexes = this.opts.getValidCharterHexes();
        if (validHexes && validHexes.has(key)) {
          const gs = this.opts.getGameState();
          const selectedId = gs.selectedHeroId;
          if (selectedId) {
            const hero = gs.heroes[selectedId];
            if (hero) {
              void this.startCharterModal(t.q, t.r);
              this.lastClickDebug.reason = "charter_modal_opened";
            }
          }
        }
      }
      this.lastClickDebug.reason = "charter_invalid";
      return;
    }

    if (this.movedDuringDrag) {
      this.lastClickDebug.reason = "movedDuringDrag";
      return;
    }
    if (!this.isPlayerTurn()) {
      this.lastClickDebug.reason = "not_player_turn";
      return;
    }
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
    const startTile = selectedId ? this.state.heroes[selectedId] : undefined;

    const occupiedHexes = new Set<string>();
    for (const [id, hero] of Object.entries(this.state.heroes)) {
      if (id !== selectedId) {
        occupiedHexes.add(`${hero.q},${hero.r}`);
      }
    }

    const clickedEnemy = Object.values(heroes).find(
      (h) => h.tile.q === t.q && h.tile.r === t.r && h.ownerId !== 0
    );
    if (clickedEnemy && selectedId && startTile) {
      const adjacentTiles: Axial[] = [];
      for (const dir of NEIGHBOR_DIRS) {
        const nq = clickedEnemy.tile.q + dir.q;
        const nr = clickedEnemy.tile.r + dir.r;
        if (!this.opts.map.isPassable(nq, nr)) continue;
        if (occupiedHexes.has(`${nq},${nr}`)) continue;
        adjacentTiles.push({ q: nq, r: nr });
      }

      let bestPath: Axial[] | null = null;
      let bestCost = Infinity;
      for (const adj of adjacentTiles) {
        const path = findPath(this.opts.map, { q: startTile.q, r: startTile.r }, adj, occupiedHexes);
        if (path.length === 0) continue;
        const cost = computePathCost(this.opts.map, [{ q: startTile.q, r: startTile.r }, ...path]);
        if (cost < bestCost) {
          bestCost = cost;
          bestPath = path;
        }
      }

      if (bestPath && bestPath.length > 0) {
        const reachableIdx = computeReachableSplit(bestPath, this.opts.map, startTile.movementRemaining);
        const clamped = reachableIdx < bestPath.length;
        const actualCost = Math.min(
          computePathCost(this.opts.map, [{ q: startTile.q, r: startTile.r }, ...bestPath.slice(0, reachableIdx)]),
          startTile.movementRemaining,
        );
        if (reachableIdx > 0) {
          const dest = bestPath[reachableIdx - 1];
          const tc = this.opts.getTurnController();
          const trailExtension = bestPath.slice(0, reachableIdx);
          this.opts.setPathPreviewLock({ heroId: selectedId, waypoint: dest, reachableIdx });
          const ok = tc.requestMove(selectedId, dest, actualCost, trailExtension);
          if (!ok) {
            this.opts.setPathPreviewLock(null);
          }
          this.opts.onStateChanged?.();
          this.path = bestPath.slice(reachableIdx);
          this.opts.onPathChanged(this.path);
          this.lastClickDebug.moved = ok;
          this.lastClickDebug.reason = ok
            ? clamped
              ? `attack clamped to ${dest.q},${dest.r}`
              : "attack"
            : "requestMove rejected";
          this.opts.onHudUpdate();
          this.opts.onRedraw();
          return;
        }
      }
      this.lastClickDebug.reason = "no attack path";
      return;
    }

    const clickedSettlement = Object.values(this.state.settlements).find(
      (s) => s.q === t.q && s.r === t.r
    );
    if (clickedSettlement && !selectedId) {
      const tc = this.opts.getTurnController();
      tc.selectSettlement(clickedSettlement.id);
      this.opts.onStateChanged?.();
      this.lastClickDebug.moved = false;
      this.lastClickDebug.reason = "settlement_select";
      this.opts.onHudUpdate();
      return;
    }

    if (!selectedId) {
      this.lastClickDebug.reason = "no selection";
      return;
    }
    if (!startTile) {
      this.lastClickDebug.reason = "no hero";
      return;
    }
    const newPath = findPath(this.opts.map, { q: startTile.q, r: startTile.r }, t, occupiedHexes);
    this.lastClickDebug.path = newPath;
    if (newPath.length === 0) {
      this.lastClickDebug.reason = "empty path";
      return;
    }
    const reachableIdx = computeReachableSplit(newPath, this.opts.map, startTile.movementRemaining);
    const clamped = reachableIdx < newPath.length;
    const actualCost = Math.min(
      computePathCost(this.opts.map, [{ q: startTile.q, r: startTile.r }, ...newPath.slice(0, reachableIdx)]),
      startTile.movementRemaining,
    );
    if (reachableIdx === 0) {
      this.lastClickDebug.reason = "impassable first step";
      return;
    }
    const dest = newPath[reachableIdx - 1];
    const tc = this.opts.getTurnController();
    const trailExtension = newPath.slice(0, reachableIdx);
    this.opts.setPathPreviewLock({ heroId: selectedId, waypoint: dest, reachableIdx });
    const ok = tc.requestMove(selectedId, dest, actualCost, trailExtension);
    if (!ok) {
      this.opts.setPathPreviewLock(null);
    }
    this.opts.onStateChanged?.();
    this.path = newPath.slice(reachableIdx);
    this.opts.onPathChanged(this.path);
    this.lastClickDebug.moved = ok;
    this.lastClickDebug.reason = ok
      ? clamped
        ? `clamped to ${dest.q},${dest.r}`
        : ""
      : "requestMove rejected";
    this.opts.onHudUpdate();
    this.opts.onRedraw();
  }

  private async startCharterModal(targetQ: number, targetR: number): Promise<void> {
    return new Promise<void>((_) => {
      let currentName = generateCharterName();
      const modal = openCenteredModal(document.body, "Charter Settlement", 320);

      const info = document.createElement("div");
      info.style.fontSize = "14px";
      info.style.opacity = "0.9";
      info.style.textAlign = "center";
      info.style.margin = "4px 0 12px";
      info.textContent = `Found settlement at (${targetQ}, ${targetR})`;
      modal.appendContent(info);

      const cost = document.createElement("div");
      cost.style.fontSize = "11px";
      cost.style.opacity = "0.7";
      cost.style.textAlign = "center";
      cost.style.marginBottom = "10px";
      cost.textContent = "Cost: 2500g + 20 wood + 15 stone";
      modal.appendContent(cost);

      const nameLabel = document.createElement("label");
      nameLabel.textContent = "Settlement name";
      nameLabel.style.fontSize = "11px";
      nameLabel.style.opacity = "0.7";
      modal.appendContent(nameLabel);

      const nameRow = document.createElement("div");
      nameRow.style.display = "flex";
      nameRow.style.gap = "6px";
      nameRow.style.alignItems = "center";

      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.value = currentName;
      styleInput(nameInput);
      nameInput.style.flex = "1";
      nameRow.appendChild(nameInput);

      const rerollBtn = document.createElement("button");
      rerollBtn.textContent = "↻";
      rerollBtn.title = "Re-roll name";
      styleButton(rerollBtn);
      rerollBtn.style.width = "32px";
      rerollBtn.style.height = "100%";
      rerollBtn.style.textAlign = "center";
      rerollBtn.style.padding = "6px 0";
      rerollBtn.addEventListener("click", () => {
        currentName = generateCharterName();
        nameInput.value = currentName;
      });
      nameRow.appendChild(rerollBtn);

      modal.appendContent(nameRow);

      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.justifyContent = "flex-end";
      row.style.gap = "8px";
      row.style.marginTop = "12px";

      const cancelBtn = document.createElement("button");
      cancelBtn.textContent = "Cancel";
      styleButton(cancelBtn);
      cancelBtn.addEventListener("click", () => {
        modal.close();
        this.lastClickDebug.reason = "charter_cancelled";
      });
      row.appendChild(cancelBtn);

      const confirmBtn = document.createElement("button");
      confirmBtn.textContent = "Confirm";
      styleButton(confirmBtn, true);
      confirmBtn.addEventListener("click", () => {
        const finalName = nameInput.value.trim() || currentName;
        modal.close();
        if (this.opts.onStartCharter) {
          const ok = this.opts.onStartCharter(targetQ, targetR, finalName);
          if (ok) {
            this.lastClickDebug.reason = "charter_started";
            this.opts.setCharterMode?.(false);
            this.opts.onStateChanged?.();
            this.opts.onHudUpdate();
            this.opts.onRedraw();
          }
        }
      });
      row.appendChild(confirmBtn);

      modal.appendContent(row);
      nameInput.focus();
      nameInput.select();
    });
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const minimapGeo = getMinimapGeometry(this.opts.map);
    if (isPointInMinimap(e.clientX, e.clientY, minimapGeo)) {
      this.opts.minimapCamera.zoomAt(e.clientX, e.clientY, factor, minimapGeo, this.opts.map);
      this.opts.onRedraw();
      return;
    }
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

const CHARTER_NAME_PREFIXES = [
  "Black", "Iron", "Silver", "Storm", "Frost",
  "Dragon", "Wolf", "Raven", "Stone", "Dawn",
  "Gold", "Ember", "Thorn", "Grim", "High",
];

const CHARTER_NAME_SUFFIXES = [
  "hold", "keep", "watch", "spire", "fall",
  "reach", "gate", "crest", "hollow", "rest",
  "guard", "pass", "mark",
];

function generateCharterName(): string {
  const p = CHARTER_NAME_PREFIXES[Math.floor(Math.random() * CHARTER_NAME_PREFIXES.length)];
  const s = CHARTER_NAME_SUFFIXES[Math.floor(Math.random() * CHARTER_NAME_SUFFIXES.length)];
  return `${p} ${s}`;
}
