import type { GameState, HeroId, HeroState } from "@heroes/contracts";
import type { UnitType } from "../units";
import { resetHeroMovement } from "../hero/move";
import { applyHeroUpkeep } from "../hero/upkeep";
import { applyPopulationGrowth } from "../settlement/populationGrowth";
import { applyGarrisonUpkeep } from "../settlement/garrisonUpkeep";
import { advanceCharters } from "../charter/advance";
import { advanceSettlementUpgrades, advanceBuildingConstructions } from "../settlement/advance";
import { advanceTradeRoutes } from "../logistics";
import type { GameMap } from "../map/gameMap";
import { regenerateHeroMana } from "../combat/spells";

// `unitTypes` is optional so catalog-less callers (legacy tests, any client
// reducer that hasn't loaded the catalog) keep working -- the upkeep helpers
// fall back to the per-unit 1g/1f defaults. The server path always passes
// EngineCtx.catalog.unitTypes, because per-unit upkeep is the rule.
export function applyWeeklyUpkeep(
  state: GameState,
  growthRate: number,
  unitTypes?: Record<string, UnitType>,
): GameState {
  // day/round/castleSeed ride along so the upkeep shortfall bookkeeping and the
  // deterministic desertion draw are both reproducible server-side.
  const upkeepOptions = {
    unitTypes,
    day: state.day,
    round: state.round,
    castleSeed: state.castleSeed,
  };
  const newHeroes = applyHeroUpkeep(state.heroes, upkeepOptions);
  const newSettlements = applyGarrisonUpkeep(
    applyPopulationGrowth(state.settlements, growthRate),
    upkeepOptions,
  );
  return { ...state, heroes: newHeroes, settlements: newSettlements, dirty: true };
}

export function advanceRound(
  state: GameState,
  growthRate: number,
  map: GameMap | null = null,
  unitTypes?: Record<string, UnitType>,
): GameState {
  // New day: movement resets and hero mana fully refills (spellcasting v1 —
  // locked decision: the day tick is the mana-regen cadence).
  const newHeroes: Record<HeroId, HeroState> = regenerateHeroMana(resetHeroMovement(state.heroes));
  const nextDay = state.day + 1;
  let withDay: GameState = {
    ...state,
    round: state.round + 1,
    day: nextDay,
    activePlayerId: 0,
    phase: { kind: "PLAYER_TURN", playerId: 0 },
    heroes: newHeroes,
    selectedHeroId: null,
    selectedSettlementId: null,
  };
  withDay = advanceCharters(withDay);
  withDay = advanceSettlementUpgrades(withDay);
  withDay = advanceBuildingConstructions(withDay);
  // Caravans need the (deterministically rebuilt) map for A*; without one
  // they simply wait at their current stop (docs plan §5.2).
  withDay = advanceTradeRoutes(withDay, map);
  if (nextDay % 7 === 0) return applyWeeklyUpkeep(withDay, growthRate, unitTypes);
  return withDay;
}
