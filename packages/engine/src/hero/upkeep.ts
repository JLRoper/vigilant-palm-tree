import type { HeroId, HeroState } from "@heroes/contracts";
import { platoonTroopTotal, trimPlatoonsFromEnd } from "../units";

export function applyHeroUpkeep(heroes: Record<HeroId, HeroState>): Record<HeroId, HeroState> {
  const newHeroes: Record<HeroId, HeroState> = { ...heroes };
  for (const hero of Object.values(newHeroes)) {
    const total = platoonTroopTotal(hero.stacks);
    const cost = total * 1;
    if (hero.gold >= cost) {
      newHeroes[hero.id] = { ...hero, troops: total, gold: hero.gold - cost };
    } else {
      const survivors = Math.max(0, hero.gold);
      newHeroes[hero.id] = {
        ...hero,
        stacks: trimPlatoonsFromEnd(hero.stacks, total - survivors),
        troops: survivors,
        gold: 0,
      };
    }
    const fed = newHeroes[hero.id];
    const foodStock = fed.resources?.food ?? 0;
    if (foodStock > 0) {
      const res = fed.resources;
      newHeroes[hero.id] = {
        ...fed,
        resources: {
          wood: res?.wood ?? 0,
          stone: res?.stone ?? 0,
          iron: res?.iron ?? 0,
          arcane: res?.arcane ?? 0,
          food: Math.max(0, foodStock - total),
        },
      };
    }
  }
  return newHeroes;
}
