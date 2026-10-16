import type { GameState, TradeRouteEndpoint, TradeRoutePayload, TradeRouteState } from "@heroes/contracts";
import {
  heroCargo,
  heroGoldCap,
  heroResourceCap,
  settlementResourceCap,
  settlementTreasuryCap,
} from "@heroes/engine";
import { hexDistance } from "../../core/hex";

export const STORAGE_GAUGE_FRAME_COUNT = 12;
export const STORAGE_GAUGE_HEIGHT = 40;

export type CapacityTone = "low" | "medium" | "high";

export interface EndpointStorage {
  storeName: string;
  resourceName: string;
  amount: number;
  capacity: number;
}

export interface StorageMeterState {
  percentage: number | null;
  fillPercentage: number;
  frameIndex: number;
  tone: CapacityTone;
}

export interface RouteProgressState {
  direction: "loading" | "outbound" | "returning";
  legPercentage: number;
  positionPercentage: number;
  waitingAtDestination: boolean;
}

type EndpointStorageState = Pick<GameState, "heroes" | "settlements">;

function clampUnit(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function storageGaugeFrame(percentage: number): number {
  if (percentage < 30) return Math.floor(percentage / 10);
  if (percentage < 70) return 3 + Math.floor((percentage - 30) / 10);
  if (percentage < 90) return 7 + Math.floor((percentage - 70) / 10);
  if (percentage < 95) return 9;
  if (percentage < 100) return 10;
  return 11;
}

export function getEndpointStorage(
  state: EndpointStorageState,
  endpoint: TradeRouteEndpoint,
  payload: TradeRoutePayload,
): EndpointStorage | null {
  const resourceName = payload.kind === "gold" ? "gold" : payload.resource;
  if (endpoint.kind === "hero") {
    const hero = state.heroes[endpoint.id];
    if (!hero) return null;
    if (payload.kind === "gold") {
      return { storeName: "Treasure", resourceName, amount: hero.gold, capacity: heroGoldCap(hero) };
    }
    const cargo = heroCargo(hero);
    return {
      storeName: payload.resource === "food" ? "Larder" : "Cargo",
      resourceName,
      amount: cargo[payload.resource],
      capacity: heroResourceCap(hero)[payload.resource],
    };
  }

  const settlement = state.settlements[endpoint.id];
  if (!settlement) return null;
  if (payload.kind === "gold") {
    return {
      storeName: "Treasury",
      resourceName,
      amount: settlement.gold,
      capacity: settlementTreasuryCap(settlement),
    };
  }
  return {
    storeName: "Warehouse",
    resourceName,
    amount: settlement.warehouse[payload.resource] ?? 0,
    capacity: settlementResourceCap(settlement)[payload.resource],
  };
}

export function getStorageMeterState(amount: number, capacity: number): StorageMeterState {
  const safeAmount = Number.isFinite(amount) ? Math.max(0, amount) : 0;
  const safeCapacity = Number.isFinite(capacity) ? Math.max(0, capacity) : 0;
  const percentage = safeCapacity > 0 ? (safeAmount / safeCapacity) * 100 : null;
  const fillPercentage = percentage === null ? 0 : Math.max(0, Math.min(100, percentage));
  const frameIndex = percentage === null ? 0 : storageGaugeFrame(fillPercentage);
  const tone: CapacityTone = percentage === null || percentage < 30 ? "low" : percentage < 70 ? "medium" : "high";

  return {
    percentage,
    fillPercentage,
    frameIndex,
    tone,
  };
}

export function formatStoragePercentage(percentage: number | null): string {
  if (percentage === null || !Number.isFinite(percentage)) return "N/A";
  const rounded = Number(percentage.toFixed(1));
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`;
}

export function formatStorageAmount(amount: number): string {
  return Number.isInteger(amount)
    ? amount.toLocaleString()
    : amount.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function endpointName(state: EndpointStorageState, endpoint: TradeRouteEndpoint): string {
  if (endpoint.kind === "hero") {
    return `Hero: ${state.heroes[endpoint.id]?.name ?? "Missing hero"}`;
  }
  return `Settlement: ${state.settlements[endpoint.id]?.name ?? "Missing settlement"}`;
}

function endpointStorageDescription(
  state: EndpointStorageState,
  endpoint: TradeRouteEndpoint,
  payload: TradeRoutePayload,
): string {
  const storage = getEndpointStorage(state, endpoint, payload);
  if (!storage) return "Storage unavailable";
  const percent = formatStoragePercentage(getStorageMeterState(storage.amount, storage.capacity).percentage);
  return `${storage.storeName} ${storage.resourceName}: ${formatStorageAmount(storage.amount)} / ${formatStorageAmount(storage.capacity)} (${percent} full)`;
}

export function getRouteTooltipText(state: EndpointStorageState, route: TradeRouteState): string {
  const payloadName = route.payload.kind === "gold" ? "gold" : route.payload.resource;
  const progress = getRouteProgress(route, state);
  const status = progress.waitingAtDestination
    ? "Waiting for destination space"
    : progress.direction === "loading"
      ? "Loading at source"
      : progress.direction === "outbound"
        ? "To destination"
        : "Returning home";
  const cargo = route.caravan
    ? `${formatStorageAmount(route.caravan.cargo)} ${payloadName} aboard`
    : "Waiting for cargo at source";

  return [
    `${route.wagons} wagon${route.wagons === 1 ? "" : "s"} carrying ${payloadName}`,
    `From: ${endpointName(state, route.from)}`,
    `Source storage: ${endpointStorageDescription(state, route.from, route.payload)}`,
    `To: ${endpointName(state, route.to)}`,
    `Destination storage: ${endpointStorageDescription(state, route.to, route.payload)}`,
    `Status: ${status}`,
    `Leg progress: ${formatStoragePercentage(progress.legPercentage)}`,
    `Caravan position: ${formatStoragePercentage(progress.positionPercentage)} from source`,
    `Cargo: ${cargo}`,
  ].join("\n");
}

function endpointPosition(
  state: EndpointStorageState,
  endpoint: TradeRouteEndpoint,
): { q: number; r: number } | null {
  if (endpoint.kind === "hero") {
    const hero = state.heroes[endpoint.id];
    return hero ? { q: hero.q, r: hero.r } : null;
  }
  const settlement = state.settlements[endpoint.id];
  return settlement ? { q: settlement.q, r: settlement.r } : null;
}

function routePositionFromEndpoints(
  route: TradeRouteState,
  state: EndpointStorageState | undefined,
): number | null {
  const caravan = route.caravan;
  if (!state || !caravan || (route.from.kind !== "hero" && route.to.kind !== "hero")) return null;
  const from = endpointPosition(state, route.from);
  const to = endpointPosition(state, route.to);
  if (!from || !to || caravan.pathIndex <= 0) return null;
  const current = caravan.path[Math.min(Math.floor(caravan.pathIndex), caravan.path.length) - 1];
  if (!current) return null;

  const fromDistance = hexDistance(current, from);
  const toDistance = hexDistance(current, to);
  const total = fromDistance + toDistance;
  return total > 0 ? (fromDistance / total) * 100 : caravan.phase === "toHome" ? 0 : 100;
}

export function getRouteProgress(
  route: TradeRouteState,
  state?: EndpointStorageState,
): RouteProgressState {
  const caravan = route.caravan;
  if (!caravan) {
    return {
      direction: "loading",
      legPercentage: 0,
      positionPercentage: 0,
      waitingAtDestination: false,
    };
  }

  const pathLength = caravan.path.length;
  const pathIndex = Number.isFinite(caravan.pathIndex) ? caravan.pathIndex : 0;
  if (caravan.phase === "toDestination") {
    const progress = clampUnit(pathLength > 0 ? pathIndex / pathLength : pathIndex > 0 ? 1 : 0);
    const endpointPositionPercent = routePositionFromEndpoints(route, state);
    const positionPercentage = endpointPositionPercent ?? progress * 100;
    // "Waiting for destination space" only applies when the exhausted path
    // actually ends on the live destination tile: a caravan trailing a moved
    // hero can sit at the end of a stale path (re-path budget spent or no
    // path found) while the hero is elsewhere with free capacity. When the
    // endpoint position is unavailable, the legacy predicate stands.
    let endsAtLiveDestination: boolean | null = null;
    if (state) {
      const toPos =
        route.to.kind === "hero"
          ? state.heroes[route.to.id]
          : state.settlements[route.to.id];
      if (toPos) {
        const last = pathLength > 0 ? caravan.path[pathLength - 1] : null;
        endsAtLiveDestination = last ? last.q === toPos.q && last.r === toPos.r : null;
      }
    }
    const waitingAtDestination =
      pathLength > 0 &&
      pathIndex >= pathLength &&
      caravan.cargo > 0 &&
      endsAtLiveDestination !== false;
    return {
      direction: "outbound",
      legPercentage: positionPercentage,
      positionPercentage,
      waitingAtDestination,
    };
  }

  const returnSteps = Math.max(0, pathLength - 1);
  const returnProgress = clampUnit(
    returnSteps > 0 ? (pathIndex - 1) / returnSteps : pathIndex > 0 ? 1 : 0,
  );
  const endpointPositionPercent = routePositionFromEndpoints(route, state);
  const positionPercentage = endpointPositionPercent ?? (1 - returnProgress) * 100;
  const legPercentage = 100 - positionPercentage;
  return {
    direction: "returning",
    legPercentage,
    positionPercentage,
    waitingAtDestination: false,
  };
}
