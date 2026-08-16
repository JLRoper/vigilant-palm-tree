import type { GameState, PlayerId, SettlementState } from "@heroes/contracts";
import { buildingSettlementEffects } from "../buildingRegistry";

export function settlementIncome(s: SettlementState): number {
  let total = s.population * s.goldTax;
  for (const b of s.buildings) {
    total += buildingSettlementEffects(b.kind, b.level).goldPerTurn;
  }
  return total;
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
