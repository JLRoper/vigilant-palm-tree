import type { HeroId, HeroState } from "@heroes/contracts";

export function applyHeroUpkeep(heroes: Record<HeroId, HeroState>): Record<HeroId, HeroState> {
  const newHeroes: Record<HeroId, HeroState> = { ...heroes };
  for (const hero of Object.values(newHeroes)) {
    const cost = hero.troops * 1;
    if (hero.gold >= cost) {
      newHeroes[hero.id] = { ...hero, gold: hero.gold - cost };
    } else {
      newHeroes[hero.id] = { ...hero, gold: 0, troops: hero.gold };
    }
  }
  return newHeroes;
}
