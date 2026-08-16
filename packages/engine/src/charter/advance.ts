import type { CharterState, GameState, HeroState, SettlementState } from "@heroes/contracts";
import { MOVEMENT_PER_TURN } from "@heroes/contracts";

export const CHARTER_SETTLEMENT_POPULATION = 50;

export function advanceCharters(state: GameState): GameState {
  let result = state;
  let completed: CharterState[] = [];

  for (const charter of state.activeCharters) {
    if (charter.phase === "constructing") {
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
  }

  for (const charter of completed) {
    result = completeCharter(result, charter);
  }

  return result;
}

function completeCharter(state: GameState, charter: CharterState): GameState {
  const hero = state.heroes[charter.heroId];
  const updatedHero: HeroState = hero
    ? {
        ...hero,
        isChartering: false,
        charterId: null,
        movementRemaining: MOVEMENT_PER_TURN,
        previousQ: null,
        previousR: null,
        previousMovementRemaining: null,
      }
    : null as unknown as HeroState;

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
    autoTrade: false,
    castleVariant: 0,
    buildings: [],
  };

  const newHeroes = hero
    ? { ...state.heroes, [charter.heroId]: updatedHero }
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
