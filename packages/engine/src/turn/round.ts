import type { GameState, HeroId, HeroState } from "@heroes/contracts";
import { resetHeroMovement } from "../hero/move";
import { applyHeroUpkeep } from "../hero/upkeep";
import { applyPopulationGrowth } from "../settlement/populationGrowth";
import { advanceCharters } from "../charter/advance";
import { advanceSettlementUpgrades } from "../settlement/advance";

export function applyWeeklyUpkeep(state: GameState, growthRate: number): GameState {
  const newHeroes = applyHeroUpkeep(state.heroes);
  const newSettlements = applyPopulationGrowth(state.settlements, growthRate);
  return { ...state, heroes: newHeroes, settlements: newSettlements, dirty: true };
}

export function advanceRound(state: GameState, growthRate: number): GameState {
  const newHeroes: Record<HeroId, HeroState> = resetHeroMovement(state.heroes);
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
  if (nextDay % 7 === 0) return applyWeeklyUpkeep(withDay, growthRate);
  return withDay;
}
