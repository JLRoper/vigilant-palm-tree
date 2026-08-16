import type { CaptureResult, GameState, HeroId, HeroState, SettlementId, SettlementState } from "@heroes/contracts";

export const CAPTURE_GOLD_REWARD = 100;

export function captureSettlement(
  state: GameState,
  heroId: HeroId,
  settlementId: SettlementId,
): CaptureResult {
  const hero = state.heroes[heroId];
  const settlement = state.settlements[settlementId];
  if (!hero || !settlement) return { state, captured: false, previousOwnerId: null };
  if (hero.ownerId === settlement.ownerId) {
    return { state, captured: false, previousOwnerId: settlement.ownerId };
  }
  const newOwnerId = hero.ownerId;
  const previousOwnerId = settlement.ownerId;
  const newSettlements: Record<SettlementId, SettlementState> = {
    ...state.settlements,
    [settlementId]: { ...settlement, ownerId: newOwnerId },
  };
  const newPlayers = state.players.map((p) => {
    if (p.id === newOwnerId) {
      if (p.settlementIds.includes(settlementId)) return p;
      return { ...p, settlementIds: [...p.settlementIds, settlementId] };
    }
    if (p.id === previousOwnerId) {
      return { ...p, settlementIds: p.settlementIds.filter((id) => id !== settlementId) };
    }
    return p;
  });
  const newHeroes: Record<HeroId, HeroState> = {
    ...state.heroes,
    [heroId]: { ...hero, gold: hero.gold + CAPTURE_GOLD_REWARD },
  };
  return {
    state: { ...state, settlements: newSettlements, players: newPlayers, heroes: newHeroes, dirty: true },
    captured: true,
    previousOwnerId,
  };
}
