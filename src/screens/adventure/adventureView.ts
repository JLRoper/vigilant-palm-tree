import { Axial, axialToPixel } from "../../core/hex";
import { Camera } from "../../render/camera";
import { GameMap } from "../../map/gameMap";
import { MapRenderer } from "../../render/renderer";
import { Hero } from "../../entities/hero";
import { findPath } from "../../map/pathfinding";
import type { GameState } from "../../state/gameState";
import type { TurnController } from "../../state/turnController";
import type { PathPreviewLock } from "../../managers/GameStateManager";
import {
  MinimapCamera,
  getFovFrameScreenPolygon,
  getMinimapGeometry,
  isPointInMinimap,
  isPointInPolygon,
} from "../../render/minimap";
import { DragTracker } from "./dragTracker";
import { resolveAdventureClick, type ClickIntent } from "./clickIntent";
import { openCharterModal } from "./charterModal";

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

const DRAG_MOVE_THRESHOLD = 4;

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

  private drag = new DragTracker();
  private minimapDrag = new DragTracker();
  private frameDrag = new DragTracker();

  private pendingPointer: { x: number; y: number } | null = null;
  private pointerFrameRequested = false;

  private minimapTouch: MinimapTouchState | null = null;

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
    this.drag.reset();
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
        this.frameDrag.begin(e.clientX, e.clientY);
        return;
      }
      this.minimapDrag.begin(e.clientX, e.clientY);
      return;
    }
    this.drag.begin(e.clientX, e.clientY);
  }

  private onMouseUp(): void {
    this.drag.end();
    this.minimapDrag.end();
    this.frameDrag.end();
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
    if (this.frameDrag.isActive()) {
      const fromX = this.frameDrag.lastX;
      const fromY = this.frameDrag.lastY;
      this.frameDrag.moveTo(e.clientX, e.clientY);
      this.panMainCameraByFrameDrag(fromX, fromY, e.clientX, e.clientY);
      this.opts.onRedraw();
      return;
    }

    if (this.minimapDrag.isActive()) {
      const fromX = this.minimapDrag.lastX;
      const fromY = this.minimapDrag.lastY;
      this.minimapDrag.moveTo(e.clientX, e.clientY);
      const geo = getMinimapGeometry(this.opts.map);
      this.opts.minimapCamera.panBy(fromX, fromY, e.clientX, e.clientY, geo, this.opts.map);
      this.opts.onRedraw();
      return;
    }

    if (this.drag.isActive()) {
      const { dx, dy } = this.drag.moveTo(e.clientX, e.clientY);
      this.opts.camera.pan(dx, dy);
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
    if (this.drag.isActive() || !this.hover || !this.isPlayerTurn()) {
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
    const minimapMoved = this.minimapDrag.consumeMoved();
    const frameMoved = this.frameDrag.consumeMoved();

    if (inMinimap) {
      if (minimapMoved || this.drag.moved || frameMoved) {
        this.lastClickDebug.reason = "minimap_drag";
        return;
      }
      const world = this.opts.minimapCamera.screenToWorld(e.clientX, e.clientY, minimapGeo);
      this.centerOn(world.q, world.r);
      this.lastClickDebug.reason = "minimap_navigate";
      this.opts.onRedraw();
      return;
    }

    if (minimapMoved || frameMoved) {
      this.lastClickDebug.reason = "minimap_drag";
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

    const intent = resolveAdventureClick({
      map: this.opts.map,
      heroes: this.opts.heroes(),
      state: this.state,
      hover: t,
      movedDuringDrag: this.drag.moved,
      isPlayerTurn: this.isPlayerTurn(),
      charterMode: this.opts.getCharterMode?.() ?? false,
      validCharterHexes: this.opts.getValidCharterHexes?.() ?? null,
    });
    this.applyClickIntent(intent);
  }

  private applyClickIntent(intent: ClickIntent): void {
    if (intent.kind === "none") {
      if (intent.debugPath) this.lastClickDebug.path = intent.debugPath;
      this.lastClickDebug.reason = intent.reason;
      return;
    }

    const tc = this.opts.getTurnController();

    if (intent.kind === "select-hero") {
      tc.selectHero(intent.heroId);
      this.opts.onStateChanged?.();
      this.lastClickDebug.moved = false;
      this.lastClickDebug.reason = "select";
      this.opts.onHudUpdate();
      return;
    }

    if (intent.kind === "select-settlement") {
      tc.selectSettlement(intent.settlementId);
      this.opts.onStateChanged?.();
      this.lastClickDebug.moved = false;
      this.lastClickDebug.reason = "settlement_select";
      this.opts.onHudUpdate();
      return;
    }

    if (intent.kind === "open-charter") {
      openCharterModal(intent.targetQ, intent.targetR, {
        onConfirm: (finalName) => {
          if (this.opts.onStartCharter) {
            const ok = this.opts.onStartCharter(intent.targetQ, intent.targetR, finalName);
            if (ok) {
              this.lastClickDebug.reason = "charter_started";
              this.opts.setCharterMode?.(false);
              this.opts.onStateChanged?.();
              this.opts.onHudUpdate();
              this.opts.onRedraw();
            }
          }
        },
        onCancel: () => {
          this.lastClickDebug.reason = "charter_cancelled";
        },
      });
      this.lastClickDebug.reason = "charter_modal_opened";
      return;
    }

    this.opts.setPathPreviewLock({ heroId: intent.heroId, waypoint: intent.dest, reachableIdx: intent.reachableIdx });
    const ok = tc.requestMove(intent.heroId, intent.dest, intent.cost, intent.trailExtension);
    if (!ok) {
      this.opts.setPathPreviewLock(null);
    }
    this.opts.onStateChanged?.();
    this.path = intent.remainingPath;
    this.opts.onPathChanged(this.path);
    this.lastClickDebug.moved = ok;
    if (intent.kind === "move") {
      this.lastClickDebug.path = intent.debugPath;
    }
    this.lastClickDebug.reason = ok
      ? intent.clamped
        ? intent.kind === "attack"
          ? `attack clamped to ${intent.dest.q},${intent.dest.r}`
          : `clamped to ${intent.dest.q},${intent.dest.r}`
        : intent.kind === "attack"
        ? "attack"
        : ""
      : "requestMove rejected";
    this.opts.onHudUpdate();
    this.opts.onRedraw();
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
    const { x: wx, y: wy } = axialToPixel(q, r);
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
