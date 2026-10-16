import type { GameState, HeroId, SettlementId, TransferDirection, TransferResult } from "@heroes/contracts";
import { heroGoldCap } from "../settlement/capacity";

export function transferGold(
  state: GameState,
  heroId: HeroId,
  settlementId: SettlementId,
  direction: TransferDirection,
): TransferResult {
  const hero = state.heroes[heroId];
  const settlement = state.settlements[settlementId];
  if (!hero) return { state, ok: false, reason: "no_hero" };
  if (!settlement) return { state, ok: false, reason: "no_settlement" };
  if (hero.q !== settlement.q || hero.r !== settlement.r) {
    return { state, ok: false, reason: "hero_not_at_settlement" };
  }
  if (settlement.ownerId === null || settlement.ownerId !== hero.ownerId) {
    return { state, ok: false, reason: "not_owned_settlement" };
  }
  if (direction === "deposit") {
    if (hero.gold <= 0) return { state, ok: false, reason: "nothing_to_deposit" };
    const amount = hero.gold;
    return {
      state: {
        ...state,
        heroes: { ...state.heroes, [heroId]: { ...hero, gold: 0 } },
        settlements: { ...state.settlements, [settlementId]: { ...settlement, gold: settlement.gold + amount } },
        dirty: true,
      },
      ok: true,
      reason: "",
    };
  }
  if (direction === "withdraw") {
    if (settlement.gold <= 0) return { state, ok: false, reason: "nothing_to_withdraw" };
    // Phase 1 heroGoldCap enforcement: the withdraw is clamped to the
    // hero's treasury-cart purse headroom -- the excess STAYS in the
    // settlement treasury (never destroyed). This was one of the two
    // uncapped sites (the deposit side is safe: it moves all of
    // hero.gold). All-or-nothing semantics are otherwise unchanged.
    const headroom = Math.max(0, heroGoldCap(hero) - hero.gold);
    const amount = Math.min(settlement.gold, headroom);
    if (amount <= 0) return { state, ok: false, reason: "purse_full" };
    return {
      state: {
        ...state,
        heroes: { ...state.heroes, [heroId]: { ...hero, gold: hero.gold + amount } },
        settlements: { ...state.settlements, [settlementId]: { ...settlement, gold: settlement.gold - amount } },
        dirty: true,
      },
      ok: true,
      reason: "",
    };
  }
  return { state, ok: false, reason: "invalid_direction" };
}
