import type { HeroId, HeroState, SettlementId, SettlementState } from "@heroes/contracts";
import { platoonTroopTotal, type UnitType } from "../units";
import {
  evaluateTroopUpkeep,
  resolveTroopUpkeep,
  type TroopUpkeepEvaluation,
  type TroopUpkeepOptions,
} from "../economy/troopUpkeep";

export type HeroUpkeepOptions = TroopUpkeepOptions;

/** Food a settlement handed to the heroes standing on it during one weekly charge. */
export interface HeroFoodDraw {
  settlementId: SettlementId;
  /** Food removed from the settlement's warehouse: never negative, never more than it held. */
  food: number;
}

export interface SuppliedHeroUpkeepResult {
  heroes: Record<HeroId, HeroState>;
  /** The settlements, with each one's warehouse reduced by what it fed. Untouched settlements keep their identity. */
  settlements: Record<SettlementId, SettlementState>;
  /** One entry per settlement that actually paid, in the order it was drawn from. */
  draws: HeroFoodDraw[];
}

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

// ── Settlement-funded food upkeep ──────────────────────────────────────────
// A hero's larder is only ever filled by a manual "unload at a settlement"
// action (logistics.ts's transferResources), so an army that never got that
// action faced a food bill no default game ever paid: `hero.resources.food`
// starts at 0 (init.ts) and the bill is charged in full every week, so
// `unpaidMoraleLoss` returned its 25-point cap every charge forever -- morale 0
// by day 28, troops deserting from turn 22, in a game where the hero never
// attacks anything to refill the larder. Gold was never the constraint; 3,000
// gold still left the army fully unfed.
//
// The rule: a hero standing on one of its OWN settlements draws its weekly
// food bill out of its owner's settlement warehouses -- the hero's larder
// first, then the pool, never more than the pool actually holds. Standing on a
// neutral or enemy town, or in the field, funds nothing and the charge simply
// goes unpaid exactly as before.
//
// The pool is the OWNER's, not one settlement's, and deliberately so: a
// player's settlements already share one bill and one pool of everything else
// (economy/consumption.ts's foodRequiredForPopulations,
// settlement/starterLayout.ts's starterFarmsNeeded, economy/trade.ts's
// auto-trade), and the default 1-player game's hero starts on the level-1 keep
// -- which held 0..4 food at the day-7 charge across 10 seeded games, because
// auto-trade tops it up to exactly foodRequired(pop) and the same turn's
// consumption spends it, while the 5-farm level-2 town of the same owner held
// tens to several hundred. A per-settlement draw would leave the hero's
// 40-food bill ~90% unfunded and the spiral exactly as it is.
//
// Ordering: `turn/endTurn.ts`'s production/trade/consumption pass runs BEFORE
// this charge (turn/round.ts's advanceRound runs it on the day-7 branch), so
// the warehouses drawn from are already net of the turn's population food bill
// -- a settlement can never pay out food it was about to consume itself. What
// the hero takes is genuinely gone: it is deducted from the settlement, and the
// next turn's auto-trade/production has to earn it back.

// What a hero at this hex may draw on, in the order it is drawn: the
// settlement under it first, then the rest of the owner's holdings by id so the
// split never depends on the record's insertion order. `available` is what is
// left of that settlement's food after the heroes charged before this one.
interface FoodSource {
  id: SettlementId;
  available: number;
  /** True for the settlement the hero is standing on: it pays before any other. */
  underHero: boolean;
}

// The settlements that may fund `hero`'s food bill, or [] when it may not be
// funded at all (in the field, or on someone else's town). Mutates nothing.
function foodSources(
  hero: HeroState,
  settlements: Record<SettlementId, SettlementState>,
  drawnSoFar: Record<string, number>,
): FoodSource[] {
  let standingOnOwn = false;
  const sources: FoodSource[] = [];
  for (const s of Object.values(settlements)) {
    // A neutral settlement (ownerId null) is nobody's bill and nobody's larder
    // (turn/endTurn.ts's consumption loop and trade.ts both skip it), so it can
    // never fund an army.
    if (s.ownerId === null || s.ownerId !== hero.ownerId) continue;
    const underHero = s.q === hero.q && s.r === hero.r;
    if (underHero) standingOnOwn = true;
    const available = Math.max(0, (s.warehouse.food ?? 0) - (drawnSoFar[s.id] ?? 0));
    if (available > 0) sources.push({ id: s.id, available, underHero });
  }
  if (!standingOnOwn) return [];
  sources.sort((a, b) => {
    if (a.underHero !== b.underHero) return a.underHero ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return sources;
}

export function applySuppliedHeroUpkeep(
  heroes: Record<HeroId, HeroState>,
  settlements: Record<SettlementId, SettlementState>,
  options: HeroUpkeepOptions = {},
): SuppliedHeroUpkeepResult {
  const unitTypes = options.unitTypes ?? {};
  const newHeroes: Record<HeroId, HeroState> = { ...heroes };
  const newSettlements: Record<SettlementId, SettlementState> = { ...settlements };
  const draws: HeroFoodDraw[] = [];
  // Food already handed out this charge, per settlement: two heroes standing on
  // the SAME settlement share one warehouse, they do not each get the full stock.
  const drawnSoFar: Record<string, number> = {};
  for (const hero of Object.values(heroes)) {
    const larder = hero.resources?.food ?? 0;
    const sources = foodSources(hero, settlements, drawnSoFar);
    const pool = sources.reduce((total, source) => total + source.available, 0);
    // The bill is a pure function of the stacks -- availableGold/availableFood
    // only decide `unfed` -- so this call is just the cheapest way to size the
    // draw before the real charge below.
    const bill = evaluateTroopUpkeep(hero.stacks, unitTypes, hero.gold, larder + pool).costFood;
    let owed = Math.max(0, bill - larder);
    let drawn = 0;
    for (const source of sources) {
      if (owed <= 0) break;
      const take = Math.min(source.available, owed);
      if (take <= 0) continue;
      source.available -= take;
      drawnSoFar[source.id] = (drawnSoFar[source.id] ?? 0) + take;
      const from = newSettlements[source.id];
      newSettlements[source.id] = {
        ...from,
        warehouse: { ...from.warehouse, food: Math.max(0, (from.warehouse.food ?? 0) - take) },
      };
      draws.push({ settlementId: source.id, food: take });
      drawn += take;
      owed -= take;
    }
    // Charge the hero against larder + what the pool just handed over. If the
    // pool could not cover the rest, `resolveTroopUpkeep` sees the shortfall and
    // charges the morale bleed / desertion exactly as it always has.
    const resolved = resolveTroopUpkeep(
      {
        id: hero.id,
        stacks: hero.stacks,
        gold: hero.gold,
        food: larder + drawn,
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
  return { heroes: newHeroes, settlements: newSettlements, draws };
}

// The field-only charge: no settlement may fund this hero, so the bill comes
// out of its purse and its larder alone. Kept as the narrow entry point for
// callers that hold no settlement context -- and as the exact behaviour
// `applySuppliedHeroUpkeep` degrades to with an empty settlement record.
export function applyHeroUpkeep(
  heroes: Record<HeroId, HeroState>,
  options: HeroUpkeepOptions = {},
): Record<HeroId, HeroState> {
  return applySuppliedHeroUpkeep(heroes, {}, options).heroes;
}