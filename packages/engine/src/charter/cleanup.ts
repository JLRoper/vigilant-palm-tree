import type { GameState, HeroId } from "@heroes/contracts";

export function cleanupDefeatedHeroCharters(state: GameState, defeatedHeroId: HeroId): GameState {
  const hero = state.heroes[defeatedHeroId];
  if (!hero || !hero.isChartering || hero.charterId === null) return state;

  return {
    ...state,
    activeCharters: state.activeCharters.filter((c) => c.id !== hero.charterId),
    dirty: true,
  };
}
