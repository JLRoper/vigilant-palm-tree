import type { GameState, PlayerId, SettlementState } from "@heroes/contracts";
import { buildingSettlementEffects } from "../buildingRegistry";
import { isDistrictBlockedByHero } from "../settlement/producers";
import { effortFraction } from "../settlement/workforce";
import { effectiveIncome } from "./consumption";
import { factionOutputScale, type FactionEconomySeat } from "./factionEconomy";

/**
 * One building's gold for one turn: the registry's `goldPerTurn`, the seat's
 * faction modifier for gold, and the building's staffing effort, rounded the
 * way both the display and the payout round it. `goldScale === 1` (the neutral
 * modifier) evaluates the pre-faction expression exactly -- the multiply is
 * skipped rather than performed with 1.0.
 */
function buildingGoldPaid(
  kind: SettlementState["buildings"][number]["kind"],
  level: number,
  effortOf: number,
  goldScale: number,
): number {
  const flat = buildingSettlementEffects(kind, level).goldPerTurn;
  const scaled = goldScale === 1 ? flat : flat * goldScale;
  return Math.round(scaled * effortOf * 100) / 100;
}

export function settlementIncome(
  s: SettlementState,
  heroes?: Iterable<{ ownerId: PlayerId; q: number; r: number }> | Record<string, { ownerId: PlayerId; q: number; r: number }>,
  seat?: FactionEconomySeat,
): number {
  // `goldScale` is the seat's faction modifier for gold (1 when the seat has
  // none). It scales only the BUILDING half: the population tax below is a
  // morale-scaled headcount levy, not one of the 18 buildings' outputs.
  const goldScale = factionOutputScale(seat, "gold");
  let total = s.population * s.goldTax;
  for (const b of s.buildings) {
    // Same rule as the district loop below and as produceSettlementResources:
    // a building that is still under construction pays nothing yet, so the HUD
    // projection must not advertise gold the End Turn will not credit.
    if (b.construction) continue;
    total += buildingGoldPaid(b.kind, b.level, effortFraction(b), goldScale);
  }
  for (const d of Object.values(s.districts ?? {})) {
    if (isDistrictBlockedByHero(s.ownerId, d.q, d.r, heroes)) continue;
    for (const b of d.buildings) {
      if (b.construction) continue;
      total += buildingGoldPaid(b.kind, b.level, effortFraction(b), goldScale);
    }
  }
  return total;
}

export function playerIncome(state: GameState, playerId: PlayerId): number {
  let total = 0;
  for (const s of Object.values(state.settlements)) {
    if (s.ownerId === playerId) total += settlementIncome(s, state.heroes, state.players?.[playerId]);
  }
  return total;
}

export function playerPopulation(state: GameState, playerId: PlayerId): number {
  let total = 0;
  for (const s of Object.values(state.settlements)) {
    if (s.ownerId === playerId) total += s.population;
  }
  return total;
}

/**
 * The total gold a settlement actually receives per turn: the morale-scaled
 * population tax (via `effectiveIncome`) PLUS building goldPerTurn scaled by
 * each building's staffing effort. This mirrors what `applyEndOfTurn` pays —
 * `produceSettlementResources` credits building goldPerTurn scaled by effort
 * the same way, while `applyEffectiveIncome` credits the morale-scaled tax.
 * Unlike `settlementIncome` (gross, no morale), this function applies morale
 * scaling to the population-tax half only.
 */
export function effectiveSettlementIncome(
  s: SettlementState,
  heroes?: Iterable<{ ownerId: PlayerId; q: number; r: number }> | Record<string, { ownerId: PlayerId; q: number; r: number }>,
  seat?: FactionEconomySeat,
): number {
  const goldScale = factionOutputScale(seat, "gold");
  let total = effectiveIncome(s);
  for (const b of s.buildings) {
    if (b.construction) continue;
    total += buildingGoldPaid(b.kind, b.level, effortFraction(b), goldScale);
  }
  for (const d of Object.values(s.districts ?? {})) {
    if (isDistrictBlockedByHero(s.ownerId, d.q, d.r, heroes)) continue;
    for (const b of d.buildings) {
      if (b.construction) continue;
      total += buildingGoldPaid(b.kind, b.level, effortFraction(b), goldScale);
    }
  }
  return total;
}

/**
 * Sum of `effectiveSettlementIncome` across all settlements owned by `playerId`.
 * This is the player-facing "Empire Income" figure: the gold their settlements
 * actually pay per turn (morale-scaled tax + building income), at their own
 * faction's economy modifier.
 */
export function playerEffectiveSettlementIncome(state: GameState, playerId: PlayerId): number {
  let total = 0;
  for (const s of Object.values(state.settlements)) {
    if (s.ownerId === playerId) total += effectiveSettlementIncome(s, state.heroes, state.players?.[playerId]);
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
