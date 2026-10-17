import type { GameState, PlayerId, SettlementState } from "@heroes/contracts";
import { buildingSettlementEffects } from "../buildingRegistry";
import { isDistrictBlockedByHero } from "../settlement/producers";
import { effectiveIncome } from "./consumption";

export function settlementIncome(
  s: SettlementState,
  heroes?: Iterable<{ ownerId: PlayerId; q: number; r: number }> | Record<string, { ownerId: PlayerId; q: number; r: number }>,
): number {
  let total = s.population * s.goldTax;
  for (const b of s.buildings) {
    total += buildingSettlementEffects(b.kind, b.level).goldPerTurn;
  }
  for (const d of Object.values(s.districts ?? {})) {
    if (isDistrictBlockedByHero(s.ownerId, d.q, d.r, heroes)) continue;
    for (const b of d.buildings) {
      if (b.construction) continue;
      total += buildingSettlementEffects(b.kind, b.level).goldPerTurn;
    }
  }
  return total;
}

export function playerIncome(state: GameState, playerId: PlayerId): number {
  let total = 0;
  for (const s of Object.values(state.settlements)) {
    if (s.ownerId === playerId) total += settlementIncome(s, state.heroes);
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
export function effectiveSettlementIncome(
  s: SettlementState,
  heroes?: Iterable<{ ownerId: PlayerId; q: number; r: number }> | Record<string, { ownerId: PlayerId; q: number; r: number }>,
): number {
  let total = effectiveIncome(s);
  for (const b of s.buildings) {
    total += buildingSettlementEffects(b.kind, b.level).goldPerTurn;
  }
  for (const d of Object.values(s.districts ?? {})) {
    if (isDistrictBlockedByHero(s.ownerId, d.q, d.r, heroes)) continue;
    for (const b of d.buildings) {
      if (b.construction) continue;
      total += buildingSettlementEffects(b.kind, b.level).goldPerTurn;
    }
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
    if (s.ownerId === playerId) total += effectiveSettlementIncome(s, state.heroes);
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
