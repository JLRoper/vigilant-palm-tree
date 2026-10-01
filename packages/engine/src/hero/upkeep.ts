import type { HeroId, HeroState } from "@heroes/contracts";
import { platoonTroopTotal, type UnitType } from "../units";
import {
  evaluateTroopUpkeep,
  resolveTroopUpkeep,
  type TroopUpkeepEvaluation,
  type TroopUpkeepOptions,
} from "../economy/troopUpkeep";

export type HeroUpkeepOptions = TroopUpkeepOptions;

// The hero-side read of the shared weekly bill. Pure and exported so the
// shortfall math (unfed count, deficit cost, morale share) is unit-testable
// without wiring a catalog-backed command. A hero's purse is its gold and its
// larder is the wagon cargo's food -- that mapping is all this function adds.
export function evaluateHeroUpkeep(
  hero: Pick<HeroState, "stacks" | "gold" | "resources">,
  unitTypes: Record<string, UnitType> = {},
): TroopUpkeepEvaluation {
  return evaluateTroopUpkeep(hero.stacks, unitTypes, hero.gold, hero.resources?.food ?? 0);
}

export function applyHeroUpkeep(
  heroes: Record<HeroId, HeroState>,
  options: HeroUpkeepOptions = {},
): Record<HeroId, HeroState> {
  const newHeroes: Record<HeroId, HeroState> = { ...heroes };
  for (const hero of Object.values(newHeroes)) {
    const resolved = resolveTroopUpkeep(
      {
        id: hero.id,
        stacks: hero.stacks,
        gold: hero.gold,
        food: hero.resources?.food ?? 0,
        morale: hero.morale,
        unpaidSinceDay: hero.upkeepUnpaidSinceDay,
        unpaidTroops: hero.upkeepUnpaidTroops,
        unpaidGold: hero.upkeepUnpaidGold,
      },
      options,
    );
    // Cargo food is only rewritten when the hero already carries a larder, so
    // a wagon-less hero never grows a resources object it did not have.
    const resources = hero.resources ? { ...hero.resources, food: resolved.food } : hero.resources;
    newHeroes[hero.id] = {
      ...hero,
      // troops is a denormalized scalar kept CONSISTENT with the stacks: it is
      // recomputed from them on every charge, never decremented separately.
      troops: platoonTroopTotal(resolved.stacks),
      stacks: resolved.stacks,
      gold: resolved.gold,
      morale: resolved.morale,
      upkeepUnpaidSinceDay: resolved.unpaidSinceDay,
      upkeepUnpaidTroops: resolved.unpaidTroops,
      upkeepUnpaidGold: resolved.unpaidGold,
      resources,
    };
  }
  return newHeroes;
}