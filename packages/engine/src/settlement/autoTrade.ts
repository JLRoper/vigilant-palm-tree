import type { GameState, SettlementId } from "@heroes/contracts";

export function setAutoTrade(state: GameState, settlementId: SettlementId, autoTrade: boolean): GameState {
  const s = state.settlements[settlementId];
  if (!s) return state;
  if ((s.autoTrade ?? true) === autoTrade) return state;
  return {
    ...state,
    settlements: { ...state.settlements, [settlementId]: { ...s, autoTrade } },
    dirty: true,
  };
}
