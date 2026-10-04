import type { BuildingDef, GameState, PlayerSeat, SettlementId, SettlementState } from "@heroes/contracts";
import { buildingBuildDays, buildingPlacementCost } from "../buildingRegistry";

// The server-side (and optimistic client-side) commit of the city view's
// working cart -- the F4 gap closer. Mirrors the client's own net-cost model
// (buildingPlacer.ts's computeNetCost): placements charge full cost, removals
// refund ceil(cost * 50%). Affordability is revalidated against the
// settlement's own treasury/warehouse, so a modified client can't place
// what it can't pay for.
const DESTROY_REFUND_PCT = 0.5;

export interface PlaceBuildingsResult {
  ok: boolean;
  state: GameState;
  reason: string;
}

export type CityBuildNetCost = Partial<Record<"gold" | "wood" | "stone" | "iron" | "arcane", number>>;

export function cityBuildNetCost(previous: BuildingDef[], next: BuildingDef[]): CityBuildNetCost {
  const net: CityBuildNetCost = {};
  const bump = (resource: keyof CityBuildNetCost, amount: number): void => {
    net[resource] = (net[resource] ?? 0) + amount;
  };
  const prevKeys = new Set(previous.map((b) => `${b.gx},${b.gy}`));
  const nextKeys = new Set(next.map((b) => `${b.gx},${b.gy}`));
  for (const b of next) {
    if (prevKeys.has(`${b.gx},${b.gy}`)) continue;
    const cost = buildingPlacementCost(b.kind);
    for (const r of ["gold", "wood", "stone", "iron", "arcane"] as const) {
      const v = cost[r] ?? 0;
      if (v > 0) bump(r, v);
    }
  }
  for (const b of previous) {
    if (nextKeys.has(`${b.gx},${b.gy}`)) continue;
    const cost = buildingPlacementCost(b.kind);
    for (const r of ["gold", "wood", "stone", "iron", "arcane"] as const) {
      const v = cost[r] ?? 0;
      if (v > 0) bump(r, -Math.ceil(v * DESTROY_REFUND_PCT));
    }
  }
  return net;
}

function sanitize(
  previous: BuildingDef[],
  incoming: BuildingDef,
  stampTimers: boolean,
): BuildingDef {
  // New placements get their construction timer recomputed server-side (a
  // modified client can't ship a 0-day build); existing buildings keep the
  // server's own construction state verbatim -- the array round-trips
  // through the client cart between commits. A settlement's free starter set
  // (freeInitialLayout) commits ALREADY CONSTRUCTED: those buildings are the
  // town the player starts with, not new work, so no timers are stamped.
  const prev = previous.find((b) => b.gx === incoming.gx && b.gy === incoming.gy && b.kind === incoming.kind);
  const construction = prev
    ? prev.construction
    : stampTimers
      ? { daysRemaining: buildingBuildDays(incoming.kind) }
      : undefined;
  const merged: BuildingDef = { ...incoming };
  if (construction) merged.construction = construction;
  else delete merged.construction;
  return merged;
}

export function applyPlaceBuildings(
  state: GameState,
  settlementId: SettlementId,
  actor: PlayerSeat,
  buildings: BuildingDef[],
  initialLayout = false,
): PlaceBuildingsResult {
  const s = state.settlements[settlementId];
  if (!s) return { ok: false, state, reason: "no_settlement" };
  if (s.ownerId !== actor) return { ok: false, state, reason: "forbidden_not_your_settlement" };

  // A previously-empty settlement's starter set (buildStarterLayout's town
  // hall + farm + 2 houses + 2 wood producers + stone mine + farmhouse) is
  // free by design and arrives ALREADY CONSTRUCTED — no build timers, no cost. Any later
  // commit pays full net cost and stamps timers on the genuinely new
  // placements only.
  const freeInitialLayout = initialLayout && s.buildings.length === 0;
  const net: CityBuildNetCost = freeInitialLayout ? {} : cityBuildNetCost(s.buildings, buildings);

  if ((net.gold ?? 0) > s.gold) return { ok: false, state, reason: "not_enough_gold" };
  for (const r of ["wood", "stone", "iron", "arcane"] as const) {
    if ((net[r] ?? 0) > (s.warehouse[r] ?? 0)) return { ok: false, state, reason: `not_enough_${r}` };
  }

  const sanitized = buildings.map((b) => sanitize(s.buildings, b, !freeInitialLayout));
  const newSettlements: Record<SettlementId, SettlementState> = {
    ...state.settlements,
    [settlementId]: {
      ...s,
      buildings: sanitized,
      gold: s.gold - (net.gold ?? 0),
      warehouse: {
        ...s.warehouse,
        wood: Math.max(0, s.warehouse.wood - (net.wood ?? 0)),
        stone: Math.max(0, s.warehouse.stone - (net.stone ?? 0)),
        iron: Math.max(0, s.warehouse.iron - (net.iron ?? 0)),
        arcane: Math.max(0, s.warehouse.arcane - (net.arcane ?? 0)),
        food: s.warehouse.food,
      },
    },
  };
  return {
    ok: true,
    state: { ...state, settlements: newSettlements, dirty: true },
    reason: "",
  };
}
