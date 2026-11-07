import type { GameState, PlayerId, SettlementState } from "@heroes/contracts";
import { buildingSettlementEffects } from "../buildingRegistry";
import { produceSettlementResources } from "../settlement/produceResources";
import { isDistrictBlockedByHero } from "../settlement/producers";
import { effortFraction } from "../settlement/workforce";
import { applyMoraleDecay, effectiveIncome } from "./consumption";
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
 * The total gold a settlement pays per turn AT ITS OWN morale: the
 * morale-scaled population tax (via `effectiveIncome`) PLUS building
 * goldPerTurn scaled by each building's staffing effort. Unlike
 * `settlementIncome` (gross, no morale), this applies morale scaling to the
 * population-tax half only.
 *
 * Deliberately a pure function of the settlement: "what will the day tick
 * actually pay THIS settlement" is `projectedSettlementIncome`, which runs the
 * tick's own morale step first. Reading the tax at the current morale where the
 * tick pays it after the step was ledger #9 (500 projected against 495
 * credited); the callers that DISPLAY income go through the projection.
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
 * The gold a settlement's next day tick will credit it, run through the
 * payment pass's OWN steps in its own order (`turn/endTurn.ts`): produce
 * first -- which refills the larder and the upkeep stock the morale step
 * reads -- then the morale step, then the morale-scaled tax, plus the building
 * gold that pass pays.
 *
 * The production half is not optional. The pass evaluates the shortfall on the
 * POST-production settlement, so a projection that skipped it would charge a
 * farm-fed settlement a decay the tick never applies: the same defect, mirrored.
 * `state` supplies the seed, the hero positions and the seat faction the pass
 * reads, so this is the pass's own arithmetic rather than a second rule.
 */
export function projectedSettlementIncome(state: GameState, s: SettlementState): number {
  const seat = s.ownerId === null || s.ownerId === undefined ? undefined : state.players?.[s.ownerId];
  const produced =
    produceSettlementResources({ [s.id]: s }, state.castleSeed, state.heroes, state.players)[s.id] ?? s;
  // The tick's own morale step, reused rather than re-derived: one rule, so the
  // projection cannot drift from the payment.
  return effectiveSettlementIncome(applyMoraleDecay(produced), state.heroes, seat);
}

/**
 * Sum of `projectedSettlementIncome` across all settlements owned by
 * `playerId`. This is the player-facing "Empire Income" figure: the gold their
 * settlements will actually pay on the next day tick (morale-scaled tax +
 * building income), at their own faction's economy modifier. Before, it read
 * the tax at each settlement's CURRENT morale while the tick pays it after the
 * morale step had run, so a decaying settlement was advertised above its credit
 * (ledger #9: 500 projected against 495 credited).
 */
export function playerEffectiveSettlementIncome(state: GameState, playerId: PlayerId): number {
  let total = 0;
  for (const s of Object.values(state.settlements)) {
    if (s.ownerId === playerId) total += projectedSettlementIncome(state, s);
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
