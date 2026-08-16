import type { ApplyEndOfTurnResult, GameState, HeroId, HeroState, SettlementId, SettlementState } from "@heroes/contracts";
import { resetHeroMovement } from "../hero/move";
import { produceSettlementResources } from "../settlement/produceResources";
import { runAutoTrade } from "../economy/trade";
import { applySettlementConsumption, applyMoraleDecay, applyEffectiveIncome } from "../economy/consumption";

export function applyEndOfTurn(state: GameState): GameState {
  return applyEndOfTurnDetailed(state).state;
}

export function applyEndOfTurnDetailed(state: GameState): ApplyEndOfTurnResult {
  const playerId = state.activePlayerId;
  const newHeroes: Record<HeroId, HeroState> = resetHeroMovement(state.heroes, playerId);
  let newSettlements: Record<SettlementId, SettlementState> = produceSettlementResources(state.settlements);
  const autoTrade = runAutoTrade(newSettlements, playerId);
  newSettlements = autoTrade.settlements;
  for (const s of Object.values(newSettlements)) {
    if (s.ownerId !== playerId) continue;
    const consumed = applySettlementConsumption(s);
    const moraleAfter = applyMoraleDecay(consumed);
    newSettlements[s.id] = applyEffectiveIncome(moraleAfter);
  }
  return {
    state: { ...state, heroes: newHeroes, settlements: newSettlements, dirty: true },
    transfers: autoTrade.transfers,
  };
}
