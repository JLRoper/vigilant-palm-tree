import type { GameState, PlayerId, SettlementState } from "../state/gameState";

export function settlementIncome(s: SettlementState): number {
  return s.population * s.goldTax;
}

export function playerIncome(state: GameState, playerId: PlayerId): number {
  let total = 0;
  for (const s of Object.values(state.settlements)) {
    if (s.ownerId === playerId) total += settlementIncome(s);
  }
  return total;
}

export function playerWealth(state: GameState, playerId: PlayerId): number {
  let total = 0;
  for (const h of Object.values(state.heroes)) {
    if (h.ownerId === playerId) total += h.gold;
  }
  for (const s of Object.values(state.settlements)) {
    if (s.ownerId === playerId) total += s.gold;
  }
  return total;
}
