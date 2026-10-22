import type { GameState, HeroBattleVerdict, HeroState, SettlementState } from "@heroes/contracts";
import { hexDistance } from "@heroes/contracts";
import { RETREAT_MOVEMENT_LOCK_DAYS } from "../combatConfig";
import { platoonTroopTotal } from "../units";
import type { CombatantOutcome } from "./types";

export type { HeroBattleVerdict };

// Maps a side's CombatantOutcome (+ the concession only the manual-arena
// path knows) to the hero-outcomes verdict:
//   lost_all_troops                        -> "defeated"
//   retreated_hero / retreated_self
//     + conceded "surrender"               -> "surrendered"
//     + conceded "retreat" / no concession -> "retreated" (auto path never
//                                             concedes; the missing flag is
//                                             the defensive default)
//   won / survived                         -> "stood"
export function deriveHeroVerdict(
  sideOutcome: CombatantOutcome,
  conceded?: "retreat" | "surrender",
): HeroBattleVerdict {
  if (sideOutcome === "lost_all_troops") return "defeated";
  if (sideOutcome === "retreated_hero" || sideOutcome === "retreated_self") {
    return conceded === "surrender" ? "surrendered" : "retreated";
  }
  return "stood";
}

// Nearest settlement owned by the hero's owner, by hexDistance. Null when
// the owner holds nothing (D1: retreat/surrender then keeps the hero at its
// post-cancel battle position). Ties resolve to the first-encountered
// settlement in record order.
export function nearestOwnedSettlement(
  state: Pick<GameState, "settlements">,
  hero: Pick<HeroState, "q" | "r" | "ownerId">,
  avoid: ReadonlyArray<{ q: number; r: number }> = [],
): SettlementState | null {
  let nearest: SettlementState | null = null;
  let nearestDist = Number.POSITIVE_INFINITY;
  for (const settlement of Object.values(state.settlements)) {
    if (settlement.ownerId !== hero.ownerId) continue;
    if (avoid.some((p) => p.q === settlement.q && p.r === settlement.r)) continue;
    const dist = hexDistance(hero, settlement);
    if (dist < nearestDist) {
      nearest = settlement;
      nearestDist = dist;
    }
  }
  return nearest;
}

// Pure retreat/surrender relocation copy: hero lands on the settlement tile
// with the move bookkeeping cleared and NO movement left this day — the
// concession ends the hero's day (plan/2026-10-21-battle-retreat-rules.md;
// a fresh MOVEMENT_PER_TURN here was a free teleport home with a full
// move). stacks stay AS-IS.
export function relocateHeroToSettlement(
  hero: HeroState,
  settlement: { q: number; r: number },
): HeroState {
  return {
    ...hero,
    q: settlement.q,
    r: settlement.r,
    movementRemaining: 0,
    previousQ: null,
    previousR: null,
    previousMovementRemaining: null,
    trail: [{ q: settlement.q, r: settlement.r }],
  };
}

// The conceding hero after a retreat or surrender, shared by the hero-battle
// (server) and settlement-battle (engine reducer) appliers. Stacks are the
// battle's survivors as given — for a retreat, the starting-edge escapees.
// Both concessions relocate to the nearest owned settlement (or stay at the
// post-battle position when the owner holds none, plan D1) with 0 movement
// left today; a retreat also stuns the hero through `day` +
// RETREAT_MOVEMENT_LOCK_DAYS. Any other verdict returns the hero unchanged.
// `avoid` lists hexes held by the enemy (the opposing hero's position): a
// conceding hero never falls back into a settlement the enemy is standing
// on, which the enemy is about to capture.
export function applyHeroConcession(
  hero: HeroState,
  verdict: HeroBattleVerdict,
  state: Pick<GameState, "settlements">,
  day: number,
  avoid: ReadonlyArray<{ q: number; r: number }> = [],
): HeroState {
  if (verdict !== "retreated" && verdict !== "surrendered") return hero;
  const counted: HeroState = { ...hero, troops: platoonTroopTotal(hero.stacks) };
  const nearest = nearestOwnedSettlement(state, counted, avoid);
  const moved: HeroState = nearest
    ? relocateHeroToSettlement(counted, nearest)
    : { ...counted, movementRemaining: 0, previousQ: null, previousR: null, previousMovementRemaining: null };
  return verdict === "retreated" ? { ...moved, movementLockedThroughDay: day + RETREAT_MOVEMENT_LOCK_DAYS } : moved;
}
