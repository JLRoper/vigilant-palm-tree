import type { GameState, HeroId, SettlementId, TransferDirection, TransferResult } from "@heroes/contracts";

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
    const amount = settlement.gold;
    return {
      state: {
        ...state,
        heroes: { ...state.heroes, [heroId]: { ...hero, gold: hero.gold + amount } },
        settlements: { ...state.settlements, [settlementId]: { ...settlement, gold: 0 } },
        dirty: true,
      },
      ok: true,
      reason: "",
    };
  }
  return { state, ok: false, reason: "invalid_direction" };
}
