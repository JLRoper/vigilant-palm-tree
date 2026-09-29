import type { GameState, HeroBattleVerdict, HeroState, SettlementState } from "@heroes/contracts";
import { hexDistance, MOVEMENT_PER_TURN } from "@heroes/contracts";
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
): SettlementState | null {
  let nearest: SettlementState | null = null;
  let nearestDist = Number.POSITIVE_INFINITY;
  for (const settlement of Object.values(state.settlements)) {
    if (settlement.ownerId !== hero.ownerId) continue;
    const dist = hexDistance(hero, settlement);
    if (dist < nearestDist) {
      nearest = settlement;
      nearestDist = dist;
    }
  }
  return nearest;
}

// Pure retreat/surrender relocation copy: hero lands on the settlement tile
// with movement bookkeeping reset to a fresh-turn state (resetHeroMovement's
// shape from hero/move.ts, inlined because that helper resets heroes in
// place rather than moving them to a target tile). stacks stay AS-IS: the
// caller zeroes them for retreat (surrender keeps them) before/after.
export function relocateHeroToSettlement(
  hero: HeroState,
  settlement: { q: number; r: number },
): HeroState {
  return {
    ...hero,
    q: settlement.q,
    r: settlement.r,
    movementRemaining: MOVEMENT_PER_TURN,
    previousQ: null,
    previousR: null,
    previousMovementRemaining: null,
    trail: [{ q: settlement.q, r: settlement.r }],
  };
}
