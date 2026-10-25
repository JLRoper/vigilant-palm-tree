import type {
  GameState,
  HeroState,
  Player,
  SettlementId,
  SettlementState,
} from "@heroes/contracts";
import {
  coveredWagonHeroIdFor,
  gameModeSettings,
  hexDistance,
  isCoveredWagonId,
  resolveGameMode,
} from "@heroes/contracts";
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
  emptyWarehouse,
  foundedSettlementBuildings,
  hasStock,
} from "./supplies";

// Founding a settlement in settlers mode (SETTLERS-PLAN.md §2, §4 W2).
//
// This is the mode's own path, NOT a rewrite of the charter path: charters keep
// their rules (gold, warehouse, travel, construction days) untouched. Here the
// founding entity is a covered wagon that is already standing where it wants to
// settle, founding is immediate, and the WAGON BECOMES the settlement's first
// hero (design answer 1) -- the same entity, renamed from `p<seat>-wagon` to
// `p<seat>-hero`, never deleted.

/**
 * Why founding was refused. ONE vocabulary: the engine returns these strings,
 * the server relays them, and the client shows the sentence it maps to -- a
 * second spelling anywhere is how the panel and the rule drift apart.
 *
 * - `not_settlers_mode` -- the game is classic; founding goes through the
 *   charter path instead.
 * - `founder_not_at_tile` -- the founding wagon/hero is not standing on the
 *   target hex.
 * - `founder_not_a_wagon` -- the founder is a recruited/starting hero, not a
 *   covered wagon: only a wagon founds in this mode. Unreachable from any
 *   shipped surface (the client offers the gesture for a selected wagon, the
 *   brain only for wagon ids), and the reason the rule is safe to hand a
 *   CONVERTED hero -- a wagon that already founded is `p<seat>-hero` and must
 *   never found again.
 * - `tile_impassable` -- the target hex cannot hold a settlement (water,
 *   dense forest, a river, a resource deposit's own rules).
 * - `occupied` -- a settlement already stands on the target hex.
 * - `too_close_to_settlement` -- within `minFoundingDistance` of a settlement,
 *   neutral castles included (design answer 2).
 */
export const FOUND_SETTLEMENT_REFUSALS = [
  "not_settlers_mode",
  "founder_not_at_tile",
  "founder_not_a_wagon",
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
   * The founding entity (the wagon), by id. Also the id its start was placed
   * with, so `settlersStreamRng(seed, founderId)` replays it.
   */
  founderId: string;
  /**
   * The target hex. There is no tile-selection step in this mode -- the only
   * hex the rule admits is the one the founder stands on -- so a server
   * caller derives these from the founder's own row when the command carries
   * none (server/app/commandHandler.ts). Integers here, always: the engine
   * refuses a non-hex before anything else.
   */
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
      /**
       * True when the founder was CONSUMED (the mode's `wagonBecomesFirstHero`
       * false). False -- the shipped settlers rule -- means the wagon survived
       * as the settlement's first hero, under `settlerHeroIdFor(seat)`.
       */
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
 * the founder's identity and position, then the target hex's occupancy and
 * terrain, then the spacing rule. A missing founder reads as
 * `founder_not_at_tile` -- the vocabulary has no "no such entity", and the
 * server's own case refuses a missing or foreign founder with `no_hero` /
 * `forbidden_not_your_hero` before this rule is ever consulted.
 *
 * "Founding happens in place" is expressed here and nowhere else: the only hex
 * this rule admits is the founder's OWN hex, so there is no reach to tune and
 * no second tile-selection gesture a client could ask for.
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

  // Wagon-only. Without this a recruited hero (or a converted founder that has
  // already planted its town) standing on a legal hex would be admitted, and
  // the mode's whole promise -- one wagon, one settlement, and the wagon is the
  // town's first hero -- would be one command away from a second free town.
  if (!isCoveredWagonId(founder.id)) {
    return { ok: false, reason: "founder_not_a_wagon" };
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
 * not a rewrite of it. The wagon is renamed into the seat's hero id (design
 * answer 1, `wagonBecomesFirstHero`) and stays the seat's mobile entity; its
 * cargo becomes the new town's warehouse (unless `cargoStaysWithFounderHero`
 * says the crew keeps it aboard), and the starter layout is left to the
 * existing `freeStarterBuildings` rule -- which is false for this mode, so a
 * founded town starts empty and is not handed a city at founding or by its
 * city view (settlement/starterLayout.ts, settlement/placeBuildings.ts).
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

  // The cargo fork, in one place: ONE stockpile in the town (the default) or
  // the crew rides on with it. Everything that reads it below -- the town's
  // warehouse, the surviving founder's own `resources` -- comes from these two
  // locals, so the two can never disagree about who holds the load.
  const cargoStaysAboard = settings.cargoStaysWithFounderHero;
  const founderCargo = carriedSupplies(founder);
  const warehouse = cargoStaysAboard ? emptyWarehouse() : founderCargo;
  const founderResources = cargoStaysAboard ? founderCargo : emptyWarehouse();

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
    // freeStarterBuildings is false for this mode: a founded settlement never
    // comes with prebuilt buildings.
    buildings: foundedSettlementBuildings(mode, population),
  };

  // The founder's own fate: the wagon BECOMES the town's first hero. The two
  // are the same entity -- the record is a HeroState either way -- so this is a
  // rename plus the roster rewrite, not a delete and a create. The id is the
  // only carrier that survives a reload (the granular heroes table has fixed
  // columns and the mode may not add one, §2.5), and the conversion is
  // collision-free: `p<seat>-hero` is allocated only by init.ts's makeHeroes,
  // which never runs in this mode.
  const consumedFounder = !settings.wagonBecomesFirstHero;
  const convertedId = consumedFounder ? null : coveredWagonHeroIdFor(founderId);
  const heroes: Record<string, HeroState> = { ...state.heroes };
  if (convertedId) {
    delete heroes[founderId];
    heroes[convertedId] = { ...founder, id: convertedId, resources: founderResources };
  } else {
    delete heroes[founderId];
  }

  const players: Player[] = state.players.map((p) => {
    if (p.id !== founder.ownerId) return p;
    return {
      ...p,
      settlementIds: [...p.settlementIds, settlementId],
      // The seat's roster follows the entity: it names the town's first hero
      // after a conversion, and drops the founder entirely when it was
      // consumed. Either way `playerHeroId`-style lookups never resolve to an
      // id that no longer exists.
      heroIds: consumedFounder
        ? p.heroIds.filter((id) => id !== founderId)
        : p.heroIds.map((id) => (id === founderId ? convertedId ?? id : id)),
    };
  });

  // Charters: a founder that was CONSUMED takes its charter with it, the same
  // rule the battle path applies to a defeated hero -- otherwise
  // activeCharters would keep an entry naming a hero that is gone. A CONVERTED
  // founder is alive, so its charter follows the rename instead (a wagon
  // cannot charter in this mode today, which is why this is belt to that
  // brace rather than the point).
  const folded: GameState = consumedFounder
    ? cleanupDefeatedHeroCharters(state, founderId)
    : convertedId === null
      ? state
      : {
          ...state,
          activeCharters: state.activeCharters.map((c) =>
            c.heroId === founderId ? { ...c, heroId: convertedId } : c,
          ),
        };

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
