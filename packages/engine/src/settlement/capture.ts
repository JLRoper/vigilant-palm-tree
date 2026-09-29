import type { CaptureResult, GameState, HeroId, HeroState, PlayerId, SettlementId, SettlementState } from "@heroes/contracts";

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

// Inverse of captureSettlement(): undoes an optimistic client-side capture
// after the server rejected the serialized CaptureSettlement command. Guarded
// so it only fires while the capture is still in place locally (the
// settlement must still be owned by the capturing hero's seat) -- a
// multiplayer sync merge that already corrected ownership makes this a
// reference-stable no-op. Gold subtraction is clamped at 0 because the hero
// may have spent the reward between the capture and the rejection.
export function rollbackCaptureSettlement(
  state: GameState,
  heroId: HeroId,
  settlementId: SettlementId,
  previousOwnerId: PlayerId | null,
): GameState | null {
  const hero = state.heroes[heroId];
  const settlement = state.settlements[settlementId];
  if (!hero || !settlement) return null;
  if (settlement.ownerId !== hero.ownerId) return null;
  const newSettlements: Record<SettlementId, SettlementState> = {
    ...state.settlements,
    [settlementId]: { ...settlement, ownerId: previousOwnerId },
  };
  const newPlayers = state.players.map((p) => {
    if (p.id === hero.ownerId) {
      return { ...p, settlementIds: p.settlementIds.filter((id) => id !== settlementId) };
    }
    if (p.id === previousOwnerId && !p.settlementIds.includes(settlementId)) {
      return { ...p, settlementIds: [...p.settlementIds, settlementId] };
    }
    return p;
  });
  const newHeroes: Record<HeroId, HeroState> = {
    ...state.heroes,
    [heroId]: { ...hero, gold: Math.max(0, hero.gold - CAPTURE_GOLD_REWARD) },
  };
  return { ...state, settlements: newSettlements, players: newPlayers, heroes: newHeroes, dirty: true };
}
