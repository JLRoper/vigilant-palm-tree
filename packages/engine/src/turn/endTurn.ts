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
  // 1. Produce resources for ALL settlements (tile rates + producer mines)
  let newSettlements: Record<SettlementId, SettlementState> = produceSettlementResources(state.settlements, state.castleSeed);
  // 2. Auto-trade for active player's settlements
  const autoTrade = runAutoTrade(newSettlements, playerId);
  newSettlements = autoTrade.settlements;
  // 3. Morale decay + consumption + effective income for active player's settlements
  for (const s of Object.values(newSettlements)) {
    if (s.ownerId !== playerId) continue;
    // Morale is evaluated on the PRE-consumption settlement: a settlement holding
    // exactly foodRequired(population) is fully fed that turn, and reading the
    // post-consumption (now zero) warehouse charged it a full -10 for being fed.
    const moraleAfter = applyMoraleDecay(s);
    const consumed = applySettlementConsumption(moraleAfter);
    newSettlements[s.id] = applyEffectiveIncome(consumed);
  }
  return {
    state: { ...state, heroes: newHeroes, settlements: newSettlements, dirty: true },
    transfers: autoTrade.transfers,
  };
}
