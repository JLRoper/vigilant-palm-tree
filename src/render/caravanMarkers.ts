import type {
  Axial,
  CaravanState,
  GameState,
  HeroId,
  HeroState,
  SettlementId,
  SettlementState,
  TradeRouteId,
  TradeRouteState,
} from "@heroes/contracts";
import { caravanTile, findPath, hexDistance } from "@heroes/engine";
import { axialToPixel } from "../core/hex";
import { directionFromDelta, type HeroDirection } from "../entities/hero";
import { settings } from "../state/settings";
import { viewSeat } from "../state/viewSeat";
import type { CaravanMarkerSpec } from "./renderTypes";

type PathfindableMap = Parameters<typeof findPath>[0];

function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function cloneCaravan(c: CaravanState | null): CaravanState | null {
  if (!c) return null;
  return {
    phase: c.phase,
    cargo: c.cargo,
    pathIndex: c.pathIndex,
    path: c.path.map((p) => ({ q: p.q, r: p.r })),
  };
}

function isContiguousHexPath(path: readonly Axial[]): boolean {
  if (path.length < 2) return false;
  for (let i = 1; i < path.length; i++) {
    if (hexDistance(path[i - 1], path[i]) !== 1) return false;
  }
  return true;
}

function resolveOrigin(
  route: TradeRouteState,
  settlements: Readonly<Record<SettlementId, SettlementState>>,
  heroes: Readonly<Record<HeroId, HeroState>>,
): { q: number; r: number; ownerId: number } | null {
  const origin =
    route.from.kind === "settlement"
      ? settlements[route.from.id]
      : heroes[route.from.id];
  if (!origin || origin.ownerId === null) return null;
  return { q: origin.q, r: origin.r, ownerId: origin.ownerId };
}

function initialFacingForCaravan(caravan: CaravanState, currentTile: Axial): HeroDirection {
  const nextStep = caravan.path[caravan.pathIndex];
  if (nextStep && (nextStep.q !== currentTile.q || nextStep.r !== currentTile.r)) {
    return directionFromDelta(nextStep.q - currentTile.q, nextStep.r - currentTile.r);
  }
  if (caravan.pathIndex > 0) {
    const prevStep = caravan.path[caravan.pathIndex - 1];
    if (prevStep && (currentTile.q !== prevStep.q || currentTile.r !== prevStep.r)) {
      return directionFromDelta(currentTile.q - prevStep.q, currentTile.r - prevStep.r);
    }
  }
  return "e";
}

export function computeCaravanWalkPath(
  prevCaravan: CaravanState | null,
  start: Axial,
  nextCaravan: CaravanState | null,
  end: Axial,
  map?: PathfindableMap,
): Axial[] {
  if (start.q === end.q && start.r === end.r) return [];

  if (nextCaravan) {
    if (
      prevCaravan &&
      prevCaravan.phase === nextCaravan.phase &&
      nextCaravan.pathIndex > prevCaravan.pathIndex
    ) {
      const candidate = [
        start,
        ...nextCaravan.path.slice(prevCaravan.pathIndex, nextCaravan.pathIndex),
      ];
      const last = candidate[candidate.length - 1];
      if (last.q === end.q && last.r === end.r && isContiguousHexPath(candidate)) {
        return candidate;
      }
    }

    if (
      prevCaravan &&
      prevCaravan.phase === "toDestination" &&
      nextCaravan.phase === "toHome"
    ) {
      const candidate = [start, ...prevCaravan.path.slice(prevCaravan.pathIndex)];
      const last = candidate[candidate.length - 1];
      if (last.q === end.q && last.r === end.r && isContiguousHexPath(candidate)) {
        return candidate;
      }
    }

    if (!prevCaravan && nextCaravan.pathIndex > 0) {
      const candidate = [start, ...nextCaravan.path.slice(0, nextCaravan.pathIndex)];
      const last = candidate[candidate.length - 1];
      if (last.q === end.q && last.r === end.r && isContiguousHexPath(candidate)) {
        return candidate;
      }
    }
  } else if (prevCaravan) {
    const candidate = [start, ...prevCaravan.path.slice(prevCaravan.pathIndex)];
    const last = candidate[candidate.length - 1];
    if (last.q === end.q && last.r === end.r && isContiguousHexPath(candidate)) {
      return candidate;
    }
  }

  if (map) {
    const found = findPath(map, start, end);
    if (found.length > 0) {
      return [start, ...found];
    }
  }

  return [start, end];
}

export class CaravanVisual {
  readonly routeId: TradeRouteId;
  ownerId: number;
  wagons: number;
  payloadKind: "resource" | "gold";
  tile: Axial;
  fromTile: Axial;
  toTile: Axial;
  animationPath: Axial[] = [];
  segIdx = 0;
  moveProgress = 1;
  moving = false;
  pixelOffset = { x: 0, y: 0 };
  facingDirection: HeroDirection = "e";
  retiringAfterMove = false;
  lastCaravan: CaravanState | null = null;

  constructor(
    routeId: TradeRouteId,
    ownerId: number,
    wagons: number,
    payloadKind: "resource" | "gold",
    tile: Axial,
    facingDirection: HeroDirection,
    lastCaravan: CaravanState | null,
  ) {
    this.routeId = routeId;
    this.ownerId = ownerId;
    this.wagons = wagons;
    this.payloadKind = payloadKind;
    this.tile = { ...tile };
    this.fromTile = { ...tile };
    this.toTile = { ...tile };
    this.facingDirection = facingDirection;
    this.lastCaravan = cloneCaravan(lastCaravan);
  }

  startMoveToPath(path: Axial[]): void {
    if (path.length < 2) return;
    this.animationPath = path.map((p) => ({ q: p.q, r: p.r }));
    this.segIdx = 0;
    this.tile = { ...this.animationPath[0] };
    this.fromTile = { ...this.animationPath[0] };
    this.toTile = { ...this.animationPath[1] };
    this.moveProgress = 0;
    this.moving = true;
    this.pixelOffset = { x: 0, y: 0 };
    const dq = this.toTile.q - this.fromTile.q;
    const dr = this.toTile.r - this.fromTile.r;
    if (dq !== 0 || dr !== 0) {
      this.facingDirection = directionFromDelta(dq, dr);
    }
  }

  update(dtMs: number): boolean {
    if (!this.moving) return false;
    const s = settings();
    const duration = this.ownerId === viewSeat() ? s.moveDurationMs : s.enemyMoveDurationMs;
    this.moveProgress = Math.min(1, this.moveProgress + dtMs / Math.max(1, duration));
    const t = easeInOutQuad(this.moveProgress);
    const from = axialToPixel(this.fromTile.q, this.fromTile.r);
    const to = axialToPixel(this.toTile.q, this.toTile.r);
    this.pixelOffset = {
      x: (to.x - from.x) * t,
      y: (to.y - from.y) * t,
    };

    if (this.moveProgress >= 1) {
      this.segIdx++;
      if (this.segIdx >= this.animationPath.length - 1) {
        const last = this.animationPath[this.animationPath.length - 1];
        this.tile = { ...last };
        this.fromTile = { ...last };
        this.toTile = { ...last };
        this.moving = false;
        this.pixelOffset = { x: 0, y: 0 };
        this.animationPath = [];
      } else {
        this.tile = { ...this.animationPath[this.segIdx] };
        this.fromTile = { ...this.animationPath[this.segIdx] };
        this.toTile = { ...this.animationPath[this.segIdx + 1] };
        this.moveProgress = 0;
        this.pixelOffset = { x: 0, y: 0 };
        const dq = this.toTile.q - this.fromTile.q;
        const dr = this.toTile.r - this.fromTile.r;
        if (dq !== 0 || dr !== 0) {
          this.facingDirection = directionFromDelta(dq, dr);
        }
      }
    }
    return true;
  }

  toMarkerSpec(): CaravanMarkerSpec {
    return {
      q: this.tile.q,
      r: this.tile.r,
      ownerId: this.ownerId,
      wagons: this.wagons,
      payloadKind: this.payloadKind,
      ...(this.moving || this.pixelOffset.x !== 0 || this.pixelOffset.y !== 0
        ? {
            pixelOffset: { x: this.pixelOffset.x, y: this.pixelOffset.y },
            moving: this.moving,
            moveProgress: this.moveProgress,
          }
        : {}),
      facingDirection: this.facingDirection,
    };
  }
}

export class CaravanVisualTracker {
  private visuals = new Map<TradeRouteId, CaravanVisual>();
  private initialized = false;

  reset(): void {
    this.visuals.clear();
    this.initialized = false;
  }

  getVisual(routeId: TradeRouteId): CaravanVisual | undefined {
    return this.visuals.get(routeId);
  }

  syncFromState(
    state: Pick<GameState, "tradeRoutes" | "settlements" | "heroes">,
    map?: PathfindableMap,
  ): void {
    const routes = state.tradeRoutes ?? [];
    const settlements = state.settlements ?? {};
    const heroes = state.heroes ?? {};

    if (!this.initialized) {
      this.initialized = true;
      for (const route of routes) {
        if (!route.caravan) continue;
        const origin = resolveOrigin(route, settlements, heroes);
        if (!origin) continue;
        const tile = caravanTile(route.caravan, { q: origin.q, r: origin.r });
        const facing = initialFacingForCaravan(route.caravan, tile);
        this.visuals.set(
          route.id,
          new CaravanVisual(
            route.id,
            origin.ownerId,
            route.wagons,
            route.payload.kind,
            tile,
            facing,
            route.caravan,
          ),
        );
      }
      return;
    }

    const activeRouteIds = new Set<TradeRouteId>();
    for (const route of routes) {
      activeRouteIds.add(route.id);
      const origin = resolveOrigin(route, settlements, heroes);
      const existing = this.visuals.get(route.id);

      if (!origin) {
        if (existing) this.visuals.delete(route.id);
        continue;
      }

      const originTile = { q: origin.q, r: origin.r };
      const nextCaravan = route.caravan;

      if (!existing) {
        if (!nextCaravan) continue;
        const end = caravanTile(nextCaravan, originTile);
        const facing = initialFacingForCaravan(nextCaravan, end);
        const visual = new CaravanVisual(
          route.id,
          origin.ownerId,
          route.wagons,
          route.payload.kind,
          nextCaravan.pathIndex > 0 ? originTile : end,
          facing,
          nextCaravan,
        );
        if (nextCaravan.pathIndex > 0 && (originTile.q !== end.q || originTile.r !== end.r)) {
          const walkPath = computeCaravanWalkPath(null, originTile, nextCaravan, end, map);
          if (walkPath.length >= 2) {
            visual.startMoveToPath(walkPath);
          } else {
            visual.tile = { ...end };
            visual.fromTile = { ...end };
            visual.toTile = { ...end };
          }
        }
        this.visuals.set(route.id, visual);
        continue;
      }

      existing.ownerId = origin.ownerId;
      existing.wagons = route.wagons;
      existing.payloadKind = route.payload.kind;

      if (nextCaravan) {
        const end = caravanTile(nextCaravan, originTile);
        const currentTarget =
          existing.moving && existing.animationPath.length > 0
            ? existing.animationPath[existing.animationPath.length - 1]
            : existing.tile;

        if (existing.moving) {
          if (currentTarget.q === end.q && currentTarget.r === end.r && !existing.retiringAfterMove) {
            existing.lastCaravan = cloneCaravan(nextCaravan);
            continue;
          }
          const moreSteps = computeCaravanWalkPath(existing.lastCaravan, currentTarget, nextCaravan, end, map);
          if (moreSteps.length >= 2) {
            existing.animationPath.push(...moreSteps.slice(1).map((p) => ({ q: p.q, r: p.r })));
          }
          existing.retiringAfterMove = false;
          existing.lastCaravan = cloneCaravan(nextCaravan);
          continue;
        }

        existing.retiringAfterMove = false;
        if (existing.tile.q !== end.q || existing.tile.r !== end.r) {
          const walkPath = computeCaravanWalkPath(existing.lastCaravan, existing.tile, nextCaravan, end, map);
          if (walkPath.length >= 2) {
            existing.startMoveToPath(walkPath);
          } else {
            existing.tile = { ...end };
            existing.fromTile = { ...end };
            existing.toTile = { ...end };
          }
        } else {
          existing.facingDirection = initialFacingForCaravan(nextCaravan, end);
        }
        existing.lastCaravan = cloneCaravan(nextCaravan);
      } else {
        // Route's caravan became null (completed return leg to origin and unloaded).
        if (existing.moving && existing.retiringAfterMove) {
          continue;
        }
        const prevCaravan = existing.lastCaravan;
        const end =
          (prevCaravan && prevCaravan.path.length > 0
            ? prevCaravan.path[prevCaravan.path.length - 1]
            : null) ?? originTile;
        const currentTarget =
          existing.moving && existing.animationPath.length > 0
            ? existing.animationPath[existing.animationPath.length - 1]
            : existing.tile;

        if (currentTarget.q !== end.q || currentTarget.r !== end.r) {
          const walkPath = computeCaravanWalkPath(prevCaravan, currentTarget, null, end, map);
          if (walkPath.length >= 2) {
            if (existing.moving) {
              existing.animationPath.push(...walkPath.slice(1).map((p) => ({ q: p.q, r: p.r })));
            } else {
              existing.startMoveToPath(walkPath);
            }
            existing.retiringAfterMove = true;
            existing.lastCaravan = null;
            continue;
          }
        }
        this.visuals.delete(route.id);
      }
    }

    for (const routeId of Array.from(this.visuals.keys())) {
      if (!activeRouteIds.has(routeId)) {
        this.visuals.delete(routeId);
      }
    }
  }

  update(dtMs: number): boolean {
    let changed = false;
    for (const [routeId, visual] of Array.from(this.visuals.entries())) {
      const wasMoving = visual.moving;
      if (visual.update(dtMs)) {
        changed = true;
      }
      if (wasMoving && !visual.moving && visual.retiringAfterMove) {
        this.visuals.delete(routeId);
        changed = true;
      }
    }
    return changed;
  }

  getMarkerSpecs(): CaravanMarkerSpec[] {
    const specs: CaravanMarkerSpec[] = [];
    for (const visual of this.visuals.values()) {
      specs.push(visual.toMarkerSpec());
    }
    return specs;
  }
}

/**
 * Maps departed trade-route caravans to their adventure-map marker specs
 * (docs/wagons-stockpiles-trade-routes-plan.md §5.2). Routes with no
 * caravan yet (still loading at the origin) never become specs -- the
 * marker only ever represents the physical caravan, not the route.
 */
export function resolveCaravanMarkers(
  tradeRoutes: readonly TradeRouteState[] = [],
  settlements: Readonly<Record<SettlementId, SettlementState>>,
  heroes: Readonly<Record<HeroId, HeroState>> = {},
): CaravanMarkerSpec[] {
  const specs: CaravanMarkerSpec[] = [];
  for (const route of tradeRoutes) {
    const caravan = route.caravan;
    if (!caravan) continue;
    const origin = resolveOrigin(route, settlements, heroes);
    if (!origin) continue;
    const tile = caravanTile(caravan, { q: origin.q, r: origin.r });
    specs.push({
      q: tile.q,
      r: tile.r,
      ownerId: origin.ownerId,
      wagons: route.wagons,
      payloadKind: route.payload.kind,
    });
  }
  return specs;
}
