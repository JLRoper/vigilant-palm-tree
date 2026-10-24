import type {
  GameState,
  Player,
  SettlementId,
  SettlementState,
} from "@heroes/contracts";
import { gameModeSettings, hexDistance, resolveGameMode } from "@heroes/contracts";
import type { GameMap } from "../map/gameMap";
import { isPassable } from "../map/terrain";
import { cleanupDefeatedHeroCharters } from "../charter/cleanup";
import {
  computeSettlementRates,
  defaultPopulation,
  generateSettlementName,
  SETTLEMENT_GOLD_TAX,
} from "../economy/settlementRates";
import { cityViewSizeFor, foodBiasForTerrain, generateCitySpots } from "../settlement/citySpots";
import { settlersStreamRng } from "./startPlacement";
import {
  carriedSupplies,
  foundedSettlementBuildings,
  hasStock,
} from "./supplies";

// Founding a settlement in settlers mode (SETTLERS-PLAN.md §2, §4 W2).
//
// This is the mode's own path, NOT a rewrite of the charter path: charters keep
// their rules (gold, warehouse, travel, construction days) untouched. Here the
// founding entity is a covered wagon that is already standing where it wants to
// settle, and founding is immediate.

/**
 * Why founding was refused. ONE vocabulary: the engine returns these strings,
 * the server relays them, and the client shows the sentence it maps to -- a
 * second spelling anywhere is how the panel and the rule drift apart.
 *
 * - `not_settlers_mode` -- the game is classic; founding goes through the
 *   charter path instead.
 * - `founder_not_at_tile` -- the founding wagon/hero is not standing on the
 *   target hex.
 * - `tile_impassable` -- the target hex cannot hold a settlement (water,
 *   dense forest, a river, a resource deposit's own rules).
 * - `occupied` -- a settlement already stands on the target hex.
 * - `too_close_to_settlement` -- within `minFoundingDistance` of a settlement,
 *   neutral castles included (design answer 2).
 */
export const FOUND_SETTLEMENT_REFUSALS = [
  "not_settlers_mode",
  "founder_not_at_tile",
  "tile_impassable",
  "occupied",
  "too_close_to_settlement",
] as const;

// Derived from the array, never hand-spelled beside it (the MAP_SIZE_ORDER
// precedent): one list to extend, one list for a test to pin.
export type FoundSettlementRefusal = (typeof FOUND_SETTLEMENT_REFUSALS)[number];

export interface FoundSettlementRequest {
  state: GameState;
  /**
   * The founding entity (the wagon/hero), by id. Also the id its start was
   * placed with, so `settlersStreamRng(seed, founderId)` replays it.
   */
  founderId: string;
  /** The target hex. */
  q: number;
  r: number;
  /**
   * The game's map, so the rule can see terrain -- without it `tile_impassable`
   * is unanswerable and the new settlement would have no terrain-derived rates
   * or city spots. Added as an OPTIONAL field so the phase-0 seam's call shape
   * stays valid for a caller that has no map (a pure state-level test), but
   * every authoritative caller passes one: server/app/commandHandler.ts
   * reconstructs it exactly as its StartCharter case does.
   */
  map?: GameMap;
}

export type FoundSettlementResult =
  | {
      ok: true;
      state: GameState;
      settlementId: SettlementId;
      /** True when the founder was consumed (design answer 1). */
      consumedFounder: boolean;
      /** The supplies written into the new settlement's warehouse (answer 3). */
      suppliesGranted: boolean;
    }
  | { ok: false; state: GameState; reason: FoundSettlementRefusal };

/**
 * The engine predicate the client gesture and the AI both gate on -- exported
 * so neither re-derives the rule (the distance check is `hexDistance`, the
 * same metric map/castlePlacement.ts spaces castles with).
 *
 * Checked in this order, cheapest and most fundamental first: the mode, then
 * the founder's position, then the target hex's occupancy and terrain, then the
 * spacing rule. A missing founder reads as `founder_not_at_tile` -- the
 * vocabulary has no "no such entity", and the server's own case refuses a
 * missing or foreign founder with `no_hero` / `forbidden_not_your_hero` before
 * this rule is ever consulted.
 */
export function canFoundSettlement(
  request: FoundSettlementRequest,
): { ok: true } | { ok: false; reason: FoundSettlementRefusal } {
  const { state, founderId, q, r } = request;
  const mode = resolveGameMode(state.gameMode);
  if (mode !== "settlers") return { ok: false, reason: "not_settlers_mode" };

  const founder = state.heroes[founderId];
  if (!founder || founder.q !== q || founder.r !== r) {
    return { ok: false, reason: "founder_not_at_tile" };
  }

  const settlements = Object.values(state.settlements);
  if (settlements.some((s) => s.q === q && s.r === r)) {
    return { ok: false, reason: "occupied" };
  }

  const map = request.map;
  if (map) {
    const tile = map.get(q, r);
    if (!tile || !isPassable(tile) || map.riverAt(q, r) || map.resourceTileAt(q, r)) {
      return { ok: false, reason: "tile_impassable" };
    }
  }

  const minDistance = gameModeSettings(mode).minFoundingDistance;
  if (minDistance > 0) {
    for (const s of settlements) {
      if (hexDistance({ q, r }, { q: s.q, r: s.r }) < minDistance) {
        return { ok: false, reason: "too_close_to_settlement" };
      }
    }
  }
  return { ok: true };
}

/**
 * The stream a founded settlement's own derived content is drawn from.
 *
 * `state.castleSeed` rather than the map seed because GameState carries no map
 * seed (the map seed is a creation-time input, and the start placement that
 * owns it takes it as a parameter). It is itself derived from the map seed
 * (hydrate.ts's defaultCastleSeedFromMapSeed) and persisted in the row, so it
 * is stable across a reload and a replay -- and it is a DIFFERENT stream from
 * every entity's start stream, so founding cannot move a start.
 */
function foundingStream(state: GameState, founderId: string, purpose: string): () => number {
  return settlersStreamRng(state.castleSeed, `${founderId}:${purpose}`);
}

/**
 * Found a settlement at `(q, r)`: the settlers-mode twin of the charter path,
 * not a rewrite of it. Consumes the founder when the mode's
 * `wagonConsumedOnFounding` says so, writes the founder's cargo into the new
 * settlement's warehouse, and leaves the starter layout to the existing
 * `freeStarterBuildings` rule.
 *
 * Everything the new settlement contains is derived here, from the state, the
 * map and the founder's own streams -- never from a client payload: the id is
 * `s<nextSettlementId>` (the StartCharter allocation rule), the name and the
 * city spots come from `settlers:<castleSeed>:<founderId>:*`, and the stock is
 * the founder's cargo. Two foundings by the same wagon therefore reproduce
 * identical content, and a replay cannot invent it.
 */
export function foundSettlement(request: FoundSettlementRequest): FoundSettlementResult {
  const check = canFoundSettlement(request);
  if (!check.ok) return { ok: false, state: request.state, reason: check.reason };

  const { state, founderId, q, r, map } = request;
  const founder = state.heroes[founderId];
  const mode = resolveGameMode(state.gameMode);
  const settings = gameModeSettings(mode);

  const settlementId = `s${state.nextSettlementId}`;
  const population = defaultPopulation(1);
  const name = generateSettlementName(foundingStream(state, founderId, "name"), founder.ownerId);
  // The terrain-derived half needs the map; without one (a state-level caller)
  // the town is founded with no rates yet rather than with invented ones -- the
  // same "do not guess" rule the seam's stubs followed.
  const computed = map
    ? computeSettlementRates(map, q, r, 1)
    : { rates: {} as SettlementState["resourceRates"], foundedOn: null };
  const spots = map
    ? generateCitySpots(cityViewSizeFor(1), foundingStream(state, founderId, "city"), {
        foodBias: foodBiasForTerrain(map.get(q, r) ?? ""),
      })
    : { spots: [], mines: [] };
  const warehouse = carriedSupplies(founder);

  const settlement: SettlementState = {
    id: settlementId,
    name,
    ownerId: founder.ownerId,
    q,
    r,
    level: 1,
    population,
    goldTax: SETTLEMENT_GOLD_TAX[1],
    resourceRates: computed.rates,
    foundedOnResource: computed.foundedOn,
    // The wagon's own purse moves into the treasury with it: founding is a
    // settlement being planted, not the wagon's gold going up in smoke.
    gold: founder.gold,
    warehouse,
    citySpots: spots.spots,
    cityMines: spots.mines,
    morale: 100,
    // Upkeep shortfall fields: a fresh town starts paid up (makeSettlements'
    // own starting values).
    garrisonUnpaidSinceDay: null,
    garrisonUnpaidTroops: 0,
    garrisonUnpaidGold: 0,
    // New settlements run their food through the caravan recommender, not the
    // legacy instant auto-trade (POST /games writes the same false for new
    // games).
    autoTrade: false,
    // Deterministic, not drawn: the wagon founds a plain tier-1 town, and a
    // random castle sprite is a draw this stream must not spend.
    castleVariant: 0,
    buildings: foundedSettlementBuildings(mode, population),
  };

  const consumedFounder = settings.wagonConsumedOnFounding;
  const heroes = { ...state.heroes };
  if (consumedFounder) delete heroes[founderId];

  const players: Player[] = state.players.map((p) => {
    if (p.id !== founder.ownerId) return p;
    return {
      ...p,
      settlementIds: [...p.settlementIds, settlementId],
      // A consumed founder leaves the seat's roster: the wagon IS the
      // settlement now, and playerHeroId-style lookups must not resolve to a
      // hero that no longer exists.
      heroIds: consumedFounder ? p.heroIds.filter((id) => id !== founderId) : p.heroIds,
    };
  });

  // A consumed founder takes its charter with it, the same rule the battle
  // path applies to a defeated hero -- otherwise activeCharters would keep an
  // entry naming a hero that is gone.
  const folded =
    consumedFounder ? cleanupDefeatedHeroCharters(state, founderId) : state;

  return {
    ok: true,
    state: {
      ...folded,
      heroes,
      settlements: { ...state.settlements, [settlementId]: settlement },
      players,
      nextSettlementId: state.nextSettlementId + 1,
      dirty: true,
    },
    settlementId,
    consumedFounder,
    suppliesGranted: hasStock(warehouse),
  };
}
