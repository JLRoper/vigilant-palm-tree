import type {
  Axial,
  FactionId,
  GameState,
  PlayerSeat,
  SettlementId,
  WorkerTransitId,
  WorkerTransitState,
} from "@heroes/contracts";
import type { GameMap } from "../map/gameMap";
import { ROAD_COST_MULTIPLIER, findPath } from "../map/pathfinding";
import { constructionWorkerUnitId } from "../buildingRegistry";
import { normalizePlatoons, removeUnitsByType, settlementStacks } from "../units";

// Construction Worker transport (faction-construction plan, section 6) and
// its road-building side action (section 7).
//
// The "merged into a hero's platoon" half of section 6 needs none of this
// file: it already works today through the existing TransferUnits command
// (packages/contracts/src/commands/transferUnits.ts) moving a
// construction_worker_* unit between a hero's stack and a garrison like any
// other unit.
//
// SCOPE NOTE (flagged in the PR description): this file wires the LONE-walk
// transport end to end at the engine/state level (startWorkerTransit,
// advanceWorkerTransits -- called from turn/round.ts every day, persisted
// on GameState.workerTransits/roadedTiles, a real StartWorkerTransit
// command and server command-handler case, a WorkerTransitAdvanced
// EngineEvent). What it does NOT ship is the player-facing UI: selecting a
// Construction Worker on the map, clicking a destination settlement, and
// toggling "build roads" are all new map-interaction surfaces with no
// existing equivalent to extend, and were judged out of scope for a first
// draft alongside the other seven sections of this spec. The command can be
// driven directly (and is, by this file's and the server test's own
// coverage) -- only the click-to-drive-it panel is the follow-up.
//
// Ambush: a lone worker transit has NO existing "attack a non-hero map
// entity" mechanism to hook into (grepped: caravans/trade routes trigger no
// combat today either), so this file does not invent a parallel
// combat-trigger system, per the spec's own instruction. `workerTransitIsVulnerable`/
// `resolveWorkerTransitAmbush` are the predicate and the (auto-resolved,
// not a full battle-screen simulation) resolution a future hero-movement
// trigger would call; nothing in today's move/battle code calls them yet --
// that wiring is the other half of the UI follow-up above.

/** Gold spent per tile when "build roads along the way" is toggled on for a trip. Named constant, not a locked decision -- a tuning knob to revisit with a human. */
export const ROAD_BUILD_GOLD_COST_PER_TILE = 15;

/** The tile a transit currently occupies. */
export function workerTransitTile(transit: WorkerTransitState, origin: Axial): Axial {
  return transit.pathIndex > 0 ? transit.path[transit.pathIndex - 1] : origin;
}

export function workerTransitArrived(transit: WorkerTransitState): boolean {
  return transit.pathIndex >= transit.path.length;
}

export function workerTransitsOf(state: GameState): WorkerTransitState[] {
  return state.workerTransits ?? [];
}

export interface StartWorkerTransitResult {
  ok: boolean;
  state: GameState;
  reason: string;
  transit?: WorkerTransitState;
}

/**
 * Sends one Construction Worker of the origin settlement's own founding
 * faction walking alone toward `destinationSettlementId`. Removes exactly
 * one worker unit from the origin's garrison and computes the walking path
 * now, the same way a trade route's loading leg does (logistics.ts).
 * `buildRoads` charges `ROAD_BUILD_GOLD_COST_PER_TILE * path.length` gold
 * from the origin settlement's treasury up front.
 */
export function startWorkerTransit(
  state: GameState,
  actor: PlayerSeat,
  originSettlementId: SettlementId,
  destinationSettlementId: SettlementId,
  map: GameMap,
  opts: { buildRoads?: boolean } = {},
): StartWorkerTransitResult {
  const origin = state.settlements[originSettlementId];
  if (!origin) return { ok: false, state, reason: "no_settlement" };
  if (origin.ownerId !== actor) return { ok: false, state, reason: "forbidden_not_your_settlement" };
  const destination = state.settlements[destinationSettlementId];
  if (!destination) return { ok: false, state, reason: "no_destination" };
  if (originSettlementId === destinationSettlementId) return { ok: false, state, reason: "same_settlement" };

  const ownerFactionId: FactionId = state.players.find((p) => p.id === actor)?.factionId ?? "human";
  const unitTypeId = constructionWorkerUnitId(ownerFactionId);
  const normalizedStacks = normalizePlatoons(settlementStacks(origin));
  const hasWorker = normalizedStacks.some((p) => p.entries.some((e) => e.unitTypeId === unitTypeId && e.count > 0));
  if (!hasWorker) return { ok: false, state, reason: "no_construction_worker_present" };

  const roadedTiles = new Set(state.roadedTiles ?? []);
  const path = findPath(map, { q: origin.q, r: origin.r }, { q: destination.q, r: destination.r }, undefined, roadedTiles);
  if (path.length === 0) return { ok: false, state, reason: "no_path" };

  const buildRoads = opts.buildRoads === true;
  const toll = buildRoads ? ROAD_BUILD_GOLD_COST_PER_TILE * path.length : 0;
  if (toll > origin.gold) return { ok: false, state, reason: "not_enough_gold" };

  const id: WorkerTransitId = `wt${state.nextWorkerTransitId ?? 0}`;
  const transit: WorkerTransitState = {
    id,
    ownerId: actor,
    factionId: ownerFactionId,
    unitTypeId,
    originSettlementId,
    destinationSettlementId,
    path,
    pathIndex: 0,
    buildRoads,
  };

  return {
    ok: true,
    reason: "",
    transit,
    state: {
      ...state,
      settlements: {
        ...state.settlements,
        [originSettlementId]: {
          ...origin,
          gold: origin.gold - toll,
          stacks: removeUnitsByType(normalizedStacks, unitTypeId, 1),
        },
      },
      workerTransits: [...workerTransitsOf(state), transit],
      nextWorkerTransitId: (state.nextWorkerTransitId ?? 0) + 1,
      dirty: true,
    },
  };
}

/** Tiles walked per day for an unescorted worker, before the road-building halving. Mirrors CARAVAN_TILES_PER_DAY's magnitude (logistics.ts) -- a worker walks like a caravan, not like a hero. */
export const WORKER_TRANSIT_TILES_PER_DAY = 7;

export interface AdvanceWorkerTransitResult {
  transit: WorkerTransitState;
  /** New "q,r" keys paved this step (only non-empty while transit.buildRoads is true). */
  newlyRoadedTiles: string[];
  arrived: boolean;
}

/**
 * One day's movement for a single lone worker transit. "Build roads along
 * the way" halves the day's walking budget (ROAD_COST_MULTIPLIER's own
 * 0.5 magnitude restated here, not imported, since pathfinding.ts's
 * constant is a terrain-cost multiplier and this is a mover-speed
 * multiplier -- the spec's single "50%" figure happens to apply to both,
 * but they are different concepts and this file keeps its own copy rather
 * than coupling them through one export). Every tile actually stepped onto
 * while buildRoads is true is reported in `newlyRoadedTiles`; this
 * function is pure and never mutates a shared set (same discipline as
 * findPath) -- advanceWorkerTransits below folds the result into
 * GameState.roadedTiles.
 */
export function advanceWorkerTransit(transit: WorkerTransitState): AdvanceWorkerTransitResult {
  if (workerTransitArrived(transit)) {
    return { transit, newlyRoadedTiles: [], arrived: true };
  }
  const budget = transit.buildRoads
    ? Math.floor(WORKER_TRANSIT_TILES_PER_DAY * ROAD_COST_MULTIPLIER)
    : WORKER_TRANSIT_TILES_PER_DAY;
  let steps = Math.max(1, budget);
  let pathIndex = transit.pathIndex;
  const newlyRoadedTiles: string[] = [];
  while (steps > 0 && pathIndex < transit.path.length) {
    pathIndex += 1;
    if (transit.buildRoads) {
      const tile = transit.path[pathIndex - 1];
      newlyRoadedTiles.push(`${tile.q},${tile.r}`);
    }
    steps -= 1;
  }
  const next: WorkerTransitState = { ...transit, pathIndex };
  return { transit: next, newlyRoadedTiles, arrived: workerTransitArrived(next) };
}

/**
 * Daily advance for EVERY in-flight worker transit (turn/round.ts's
 * advanceRound, alongside advanceTradeRoutes): walks each one, folds any
 * newly-paved tiles into GameState.roadedTiles, and on arrival deposits the
 * worker into the destination settlement's garrison and removes the
 * transit from the list. A destination that no longer exists or changed
 * owner away from the transit's own owner strands the transit in place
 * (cargo-never-lost precedent from the trade-route advance) rather than
 * depositing into a settlement the owner no longer controls; a human can
 * still recover the situation since the worker is not consumed by sitting
 * idle.
 */
export function advanceWorkerTransits(state: GameState): GameState {
  const transits = workerTransitsOf(state);
  if (transits.length === 0) return state;

  const roaded = new Set(state.roadedTiles ?? []);
  const settlements = { ...state.settlements };
  let changed = false;
  const remaining: WorkerTransitState[] = [];

  for (const transit of transits) {
    const stepped = advanceWorkerTransit(transit);
    for (const key of stepped.newlyRoadedTiles) roaded.add(key);
    if (stepped.newlyRoadedTiles.length > 0) changed = true;

    if (!stepped.arrived) {
      if (stepped.transit !== transit) changed = true;
      remaining.push(stepped.transit);
      continue;
    }

    changed = true;
    const destination = settlements[transit.destinationSettlementId];
    if (!destination || destination.ownerId !== transit.ownerId) {
      // Stranded: keep the transit parked at path end rather than lose the
      // worker or hand it to a settlement the owner no longer controls.
      remaining.push(stepped.transit);
      continue;
    }
    // Deposit the worker (depositIntoGarrison lives in recruitUnits.ts;
    // importing it here would create settlement/workerTransit.ts <->
    // settlement/recruitUnits.ts coupling for a single call, so the merge
    // is inlined with the same entries-array logic instead).
    const destStacks = normalizePlatoons(settlementStacks(destination));
    let target = destStacks.find((p) => p.entries.some((e) => e.unitTypeId === transit.unitTypeId));
    if (!target) target = destStacks.find((p) => p.entries.length < 3);
    if (target) {
      const entry = target.entries.find((e) => e.unitTypeId === transit.unitTypeId);
      if (entry) entry.count += 1;
      else target.entries.push({ unitTypeId: transit.unitTypeId, count: 1 });
      settlements[transit.destinationSettlementId] = { ...destination, stacks: destStacks };
    } else {
      // Garrison full: the transit holds at the destination's doorstep
      // rather than discard the worker.
      remaining.push({ ...stepped.transit, pathIndex: stepped.transit.pathIndex - 1 });
    }
  }

  if (!changed) return state;
  return {
    ...state,
    settlements,
    workerTransits: remaining,
    roadedTiles: [...roaded].sort(),
    dirty: true,
  };
}

/**
 * Ambush eligibility (section 6): true whenever a lone worker transit is
 * currently standing on the open map (not yet arrived). See this file's
 * header comment for why no trigger wiring calls this yet.
 */
export function workerTransitIsVulnerable(transit: WorkerTransitState): boolean {
  return !workerTransitArrived(transit);
}

export interface WorkerTransitAmbushResult {
  /** The worker is always lost: minimal attack/defence stats (buildingRegistry's non-combat design) make a real fight a foregone conclusion, so this auto-resolves rather than running a full combat simulation for one unit. */
  workerLost: true;
}

/**
 * Auto-resolves an enemy hero landing on a vulnerable worker transit's
 * tile. Judgment call (flagged in the PR description): a real combat
 * simulation (the Construction Worker's own tiny platoon vs. the
 * attacker's stacks) was in scope for a "full" implementation, but wiring
 * a brand-new map entity through the existing hero-vs-hero battle screen
 * end-to-end was not, for a first draft -- the worker's own stats
 * (attack 1 / defence 1, see server/migrations/034_construction_workers.sql)
 * make the outcome a foregone conclusion in every realistic case anyway.
 */
export function resolveWorkerTransitAmbush(): WorkerTransitAmbushResult {
  return { workerLost: true };
}
