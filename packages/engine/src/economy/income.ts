import type { GameState, PlayerId, SettlementState } from "@heroes/contracts";
import { buildingSettlementEffects } from "../buildingRegistry";
import { effectiveIncome } from "./consumption";

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

/**
 * The total gold a settlement actually receives per turn: the morale-scaled
 * population tax (via `effectiveIncome`) PLUS building goldPerTurn. This mirrors
 * what `applyEndOfTurn` pays — `produceSettlementResources` credits building
 * goldPerTurn unconditionally, while `applyEffectiveIncome` credits the
 * morale-scaled tax. Unlike `settlementIncome` (gross, no morale), this
 * function applies morale scaling to the population-tax half only.
 */
export function effectiveSettlementIncome(s: SettlementState): number {
  let total = effectiveIncome(s);
  for (const b of s.buildings) {
    total += buildingSettlementEffects(b.kind, b.level).goldPerTurn;
  }
  return total;
}

/**
 * Sum of `effectiveSettlementIncome` across all settlements owned by `playerId`.
 * This is the player-facing "Empire Income" figure: the gold their settlements
 * actually pay per turn (morale-scaled tax + building income).
 */
export function playerEffectiveSettlementIncome(state: GameState, playerId: PlayerId): number {
  let total = 0;
  for (const s of Object.values(state.settlements)) {
    if (s.ownerId === playerId) total += effectiveSettlementIncome(s);
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
