import type { CharterState, GameState, SettlementState } from "@heroes/contracts";
import { MOVEMENT_PER_TURN } from "@heroes/contracts";
import type { GameMap } from "../map/gameMap";
import { findPath } from "../map/pathfinding";
import { stepTravelCharter } from "./travel";

export const CHARTER_SETTLEMENT_POPULATION = 50;

/**
 * The day tick's charter pass. Two things happen per day:
 *
 * 1. TRAVEL, when a map is available: every charter in the `traveling` phase
 *    whose hero hasn't reached its target takes ONE hex-step toward it. Before
 *    this existed a traveling charter was moved exclusively by the client's
 *    hex-by-hex AdvanceCharterTravel commands (src/state/turnController.ts's
 *    advanceAutoTravel), so a charter whose client stopped sending them -- a
 *    reload that lost the charter (C-BLOCKER-1), a closed tab, a rejected step
 *    -- could never reach its target and the chartering hero stayed locked
 *    (and starved) for good. Advancing the route on the day tick is what makes
 *    a traveling charter recoverable with no client cooperation at all; the
 *    client's own walk still runs inside a turn's movement budget and simply
 *    gets there sooner. The step goes through stepTravelCharter(), so arrival
 *    still flips the phase to `constructing` and the movement/terrain rules
 *    stay the engine's own rather than a second implementation of them.
 *
 * 2. CONSTRUCTION COUNTDOWN: charters that were ALREADY `constructing` when
 *    the day started lose a day, and reaching zero founds the settlement. That
 *    set is read off the ENTRY state, so a charter arriving on its target
 *    during this pass (step 1) starts its countdown tomorrow instead of losing
 *    a day it never had -- the same timing as a client-side arrival.
 */
export function advanceCharters(state: GameState, map?: GameMap | null): GameState {
  const traveled = advanceTravelingCharters(state, map);
  const constructingIds = new Set(
    state.activeCharters.filter((c) => c.phase === "constructing").map((c) => c.id),
  );

  let result = traveled;
  const completed: CharterState[] = [];

  for (const charter of traveled.activeCharters) {
    if (!constructingIds.has(charter.id)) continue;
    const newDays = charter.daysRemaining - 1;
    if (newDays <= 0) {
      completed.push(charter);
    } else {
      result = {
        ...result,
        activeCharters: result.activeCharters.map((c) =>
          c.id === charter.id ? { ...c, daysRemaining: newDays } : c,
        ),
      };
    }
  }

  for (const charter of completed) {
    result = completeCharter(result, charter);
  }

  return result;
}

/**
 * One hex-step per traveling charter toward its target, pathfound on the
 * caller's constructed map with every other hero's hex blocked (heroes never
 * stack). A null/absent map (map-less callers, offline fixtures) makes this a
 * reference-stable no-op, so that pass keeps behaving exactly as it did for
 * callers that never had a map to path with.
 */
function advanceTravelingCharters(state: GameState, map?: GameMap | null): GameState {
  if (!map) return state;
  let result = state;
  for (const charter of state.activeCharters) {
    if (charter.phase !== "traveling") continue;
    const hero = result.heroes[charter.heroId];
    if (!hero) continue;
    if (hero.q === charter.targetQ && hero.r === charter.targetR) continue;
    const occupied = new Set<string>();
    for (const [id, other] of Object.entries(result.heroes)) {
      if (id !== charter.heroId) occupied.add(`${other.q},${other.r}`);
    }
    const path = findPath(map, { q: hero.q, r: hero.r }, { q: charter.targetQ, r: charter.targetR }, occupied);
    if (path.length === 0) continue;
    const next = path[0];
    const cost = map.cost(next.q, next.r);
    if (!Number.isFinite(cost) || cost < 0) continue;
    const stepped = stepTravelCharter(result, charter.heroId, next.q, next.r, cost);
    if (stepped.ok) result = stepped.state;
  }
  return result;
}

function completeCharter(state: GameState, charter: CharterState): GameState {
  const hero = state.heroes[charter.heroId];

  const newSettlement: SettlementState = {
    id: charter.settlementId,
    name: charter.settlementName,
    ownerId: charter.ownerId,
    q: charter.targetQ,
    r: charter.targetR,
    level: 1,
    population: CHARTER_SETTLEMENT_POPULATION,
    goldTax: 1,
    resourceRates: { ...charter.resourceRates },
    foundedOnResource: charter.foundedOnResource,
    gold: 0,
    warehouse: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 },
    citySpots: charter.citySpots.slice(),
    cityMines: [],
    morale: 50,
    // Garrison upkeep shortfall (weekly upkeep pass): a freshly founded
    // charter town starts paid up.
    garrisonUnpaidSinceDay: null,
    garrisonUnpaidTroops: 0,
    garrisonUnpaidGold: 0,
    autoTrade: false,
    castleVariant: 0,
    buildings: [],
  };

  const newHeroes = hero
    ? {
        ...state.heroes,
        [charter.heroId]: {
          ...hero,
          isChartering: false,
          charterId: null,
          movementRemaining: MOVEMENT_PER_TURN,
          previousQ: null,
          previousR: null,
          previousMovementRemaining: null,
        },
      }
    : state.heroes;

  return {
    ...state,
    heroes: newHeroes,
    settlements: { ...state.settlements, [charter.settlementId]: newSettlement },
    activeCharters: state.activeCharters.filter((c) => c.id !== charter.id),
    players: state.players.map((p) =>
      p.id === charter.ownerId
        ? { ...p, settlementIds: [...p.settlementIds, charter.settlementId] }
        : p,
    ),
    dirty: true,
  };
}
