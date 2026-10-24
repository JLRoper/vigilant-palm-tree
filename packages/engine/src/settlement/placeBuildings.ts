import type {
  BuildingDef,
  DistrictState,
  GameState,
  PlayerSeat,
  SettlementId,
  SettlementState,
} from "@heroes/contracts";
import {
  buildingBuildDays,
  buildingFootprintFromRegistry,
  buildingPlacementCost,
  constructionWorkerUnitId,
  normalizeFactionId,
} from "../buildingRegistry";
import { buildingConstructionGate } from "./constructionWorkers";
import { districtKey } from "../control";
import { disconnectedDistrictKeys } from "./districtConnectivity";
import { type CitySpot } from "./citySpots";
import { hasExplicitStaffing } from "./workforce";
import { depositIntoGarrison } from "./recruitUnits";
import { settlementStacks } from "../units";

// The server-side (and optimistic client-side) commit of the city view's
// working cart -- the F4 gap closer. Mirrors the client's own net-cost model
// (buildingPlacer.ts's computeNetCost): placements charge full cost, removals
// refund ceil(cost * 50%). Affordability is revalidated against the
// settlement's own treasury/warehouse, so a modified client can't place
// what it can't pay for.
const DESTROY_REFUND_PCT = 0.5;

export interface PlaceBuildingsDistrictTarget {
  q: number;
  r: number;
  citySpots?: CitySpot[];
}

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
  newPlacementWorkers: number | undefined,
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
  if (prev) {
    merged.level = prev.level;
    if (prev.w !== undefined) merged.w = prev.w;
    else delete merged.w;
    if (prev.h !== undefined) merged.h = prev.h;
    else delete merged.h;
    if (prev.bank) {
      merged.bank = { ...prev.bank, pendingOut: prev.bank.pendingOut.map((p) => ({ ...p })) };
    } else {
      delete merged.bank;
    }
    // workers/draft are server-owned staffing state (assignWorkers/recruit
    // commands own them); a modified client can't rewrite them through the
    // placeBuildings round-trip.
    if (prev.workers !== undefined) merged.workers = prev.workers;
    else delete merged.workers;
    if (prev.draft) merged.draft = { ...prev.draft };
    else delete merged.draft;
  } else {
    merged.level = 1;
    delete merged.w;
    delete merged.h;
    delete merged.bank;
    if (newPlacementWorkers === undefined) delete merged.workers;
    else merged.workers = newPlacementWorkers;
    delete merged.draft;
  }
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
  district?: PlaceBuildingsDistrictTarget,
): PlaceBuildingsResult {
  const s = state.settlements[settlementId];
  if (!s) return { ok: false, state, reason: "no_settlement" };
  if (s.ownerId !== actor) return { ok: false, state, reason: "forbidden_not_your_settlement" };

  const ownerFactionId = normalizeFactionId(state.players.find((p) => p.id === s.ownerId)?.factionId) ?? "human";
  const previous = district ? s.districts?.[districtKey(district.q, district.r)]?.buildings ?? [] : s.buildings;
  // A previously-empty settlement's free starter-layout commit (below) is a
  // pre-built starting state, not a player action -- district placements are
  // never free, only the main-city starter set is.
  const freeInitialLayout = !district && initialLayout && s.buildings.length === 0;

  // Construction-worker-gated faction-building feature (section 4): this
  // REPLACES PR #252's pure seat-vs-building-tag check
  // (buildingAllowedForFaction(b.kind, ownerFactionId)), which is what let a
  // "neutral"-faction seat's own free starter commit reject itself forever
  // (buildingRegistry.ts's normalizeFactionId comment has the bug history).
  // Placing a NEW building tagged faction F now requires an F Construction
  // Worker currently present in THIS settlement's garrison/stacks --
  // independent of the owner's own seat faction (buildingConstructionGate).
  // Untagged (economy) buildings are always allowed, same as before. The
  // free starter commit is exempt, same reasoning as the cost/timer
  // exemptions below: it is the town the player starts with, not new work.
  if (!freeInitialLayout) {
    for (const b of buildings) {
      if (previous.some((p) => p.gx === b.gx && p.gy === b.gy && p.kind === b.kind)) continue;
      const gate = buildingConstructionGate(b.kind, s);
      if (!gate.ok) return { ok: false, state, reason: gate.reason ?? "missing_construction_worker" };
    }
  }

  // Per-settlement, per-turn construction cap (section 5): a settlement may
  // commit at most one PlaceBuildings OR DemolishBuilding per turn --
  // whichever happens first blocks the other until the next turn (reset in
  // turn/round.ts's advanceRound, alongside the other per-day resets). This
  // is the "cap concurrent construction per settlement" option the spec
  // for this feature cited from a "docs/income-rebalancing-plan.md" --
  // that file does not exist in this repository; see
  // SettlementState.constructionActionUsedThisTurn's own comment and the
  // PR description for the full note. The free starter commit is exempt
  // for the same reason as the construction-worker gate above.
  if (!freeInitialLayout && s.constructionActionUsedThisTurn) {
    return { ok: false, state, reason: "construction_action_already_used_this_turn" };
  }

  const newPlacementWorkers = hasExplicitStaffing(s) ? 0 : undefined;

  if (district) {
    if (buildings.some((b) => b.kind === "townHall")) {
      return { ok: false, state, reason: "town_hall_forbidden_in_district" };
    }
    const key = districtKey(district.q, district.r);
    const prevDistrict = s.districts?.[key];
    const prevBuildings = prevDistrict?.buildings ?? [];
    const sanitized = buildings.map((b) => sanitize(prevBuildings, b, true, newPlacementWorkers));

    const occupied = new Set<string>();
    for (const b of sanitized) {
      const fp = buildingFootprintFromRegistry(b.kind, b.level);
      const w = Math.max(1, Math.ceil(b.w ?? fp.w));
      const h = Math.max(1, Math.ceil(b.h ?? fp.h));
      if (
        !Number.isInteger(b.gx) ||
        !Number.isInteger(b.gy) ||
        b.gx < 0 ||
        b.gy < 0 ||
        b.gx + w > 5 ||
        b.gy + h > 5
      ) {
        return { ok: false, state, reason: "invalid_district_placement" };
      }
      for (let dy = 0; dy < h; dy++) {
        for (let dx = 0; dx < w; dx++) {
          const cellKey = `${b.gx + dx},${b.gy + dy}`;
          if (occupied.has(cellKey)) {
            return { ok: false, state, reason: "invalid_district_placement" };
          }
          occupied.add(cellKey);
        }
      }
    }

    const net: CityBuildNetCost = cityBuildNetCost(prevBuildings, sanitized);

    if ((net.gold ?? 0) > s.gold) return { ok: false, state, reason: "not_enough_gold" };
    for (const r of ["wood", "stone", "iron", "arcane"] as const) {
      if ((net[r] ?? 0) > (s.warehouse[r] ?? 0)) return { ok: false, state, reason: `not_enough_${r}` };
    }

    const nextDistricts: Record<string, DistrictState> = { ...(s.districts ?? {}) };
    if (sanitized.length > 0) {
      // The authoritative spot set is map-derived (terrain + the hex's resource
      // deposit), so it is computed by the callers that hold the GameMap
      // (server/app/commandHandler.ts, src/managers/UIManager.ts) and passed in.
      // Fabricating one here would use the grass default bias and a random
      // first spot, silently breaking the deposit guarantee of D2.
      const citySpots = district.citySpots ?? prevDistrict?.citySpots;
      if (!citySpots) return { ok: false, state, reason: "district_spots_required" };
      nextDistricts[key] = {
        q: district.q,
        r: district.r,
        citySpots,
        buildings: sanitized,
      };
    } else {
      delete nextDistricts[key];
    }

    // No floating districts. This runs on the RESULT, not just on the new hex,
    // so it also catches the other direction: clearing the buildings out of a
    // water district that was the only bridge to a district across the water
    // strands that far district, and the commit is refused rather than leaving
    // the settlement with an unreachable district. Map-free by design -- the
    // chain is centre -> district -> district, all of it hex arithmetic.
    if (disconnectedDistrictKeys(s, nextDistricts).length > 0) {
      return { ok: false, state, reason: "district_not_connected" };
    }

    const { districts: _prevDistricts, ...sWithoutDistricts } = s;
    const updatedSettlement: SettlementState = {
      ...sWithoutDistricts,
      ...(Object.keys(nextDistricts).length > 0 ? { districts: nextDistricts } : {}),
      gold: s.gold - (net.gold ?? 0),
      warehouse: {
        ...s.warehouse,
        wood: Math.max(0, s.warehouse.wood - (net.wood ?? 0)),
        stone: Math.max(0, s.warehouse.stone - (net.stone ?? 0)),
        iron: Math.max(0, s.warehouse.iron - (net.iron ?? 0)),
        arcane: Math.max(0, s.warehouse.arcane - (net.arcane ?? 0)),
        food: s.warehouse.food,
      },
      // District commits are never the free initial layout -- always consume
      // the per-turn cap.
      constructionActionUsedThisTurn: true,
    };

    return {
      ok: true,
      state: {
        ...state,
        settlements: { ...state.settlements, [settlementId]: updatedSettlement },
        dirty: true,
      },
      reason: "",
    };
  }

  // A previously-empty settlement's starter set (buildStarterLayout's town
  // hall + farm + 2 houses + 2 wood producers + stone mine + faction troop producer) is
  // free by design and arrives ALREADY CONSTRUCTED — no build timers, no cost. Any later
  // commit pays full net cost and stamps timers on the genuinely new
  // placements only. (freeInitialLayout is computed above, shared with the
  // construction-worker gate and the per-turn cap.)
  const net: CityBuildNetCost = freeInitialLayout ? {} : cityBuildNetCost(s.buildings, buildings);

  if ((net.gold ?? 0) > s.gold) return { ok: false, state, reason: "not_enough_gold" };
  for (const r of ["wood", "stone", "iron", "arcane"] as const) {
    if ((net[r] ?? 0) > (s.warehouse[r] ?? 0)) return { ok: false, state, reason: `not_enough_${r}` };
  }

  const sanitized = buildings.map((b) => sanitize(s.buildings, b, !freeInitialLayout, newPlacementWorkers));
  // Starter Construction Worker seeding, extended to the free starter commit
  // (not just world-gen's seedStarterBuildings in init.ts): without one, a
  // settlement founded mid-game by a charter could never place a second
  // faction building either (buildingConstructionGate above would reject
  // its very first one). One worker of the settlement's OWNER's own faction,
  // deposited straight into the garrison -- never consumed, just standing
  // proof of residence.
  const seededStacks = freeInitialLayout
    ? depositIntoGarrison(settlementStacks(s), constructionWorkerUnitId(ownerFactionId), 1).stacks
    : s.stacks;
  const newSettlements: Record<SettlementId, SettlementState> = {
    ...state.settlements,
    [settlementId]: {
      ...s,
      buildings: sanitized,
      stacks: seededStacks,
      gold: s.gold - (net.gold ?? 0),
      warehouse: {
        ...s.warehouse,
        wood: Math.max(0, s.warehouse.wood - (net.wood ?? 0)),
        stone: Math.max(0, s.warehouse.stone - (net.stone ?? 0)),
        iron: Math.max(0, s.warehouse.iron - (net.iron ?? 0)),
        arcane: Math.max(0, s.warehouse.arcane - (net.arcane ?? 0)),
        food: s.warehouse.food,
      },
      constructionActionUsedThisTurn: freeInitialLayout ? s.constructionActionUsedThisTurn : true,
    },
  };
  return {
    ok: true,
    state: { ...state, settlements: newSettlements, dirty: true },
    reason: "",
  };
}
