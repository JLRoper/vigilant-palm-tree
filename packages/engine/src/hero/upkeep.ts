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
// action (logistics.ts's transferResources) or by a caravan delivering to a
// hero endpoint (docs/wagons-stockpiles-trade-routes-plan.md §5.2), so an
// army that never got either faced a food bill no default game ever paid:
// `hero.resources.food` starts at 0 (init.ts) and the bill is charged in full
// every week, so `unpaidMoraleLoss` returned its 25-point cap every charge
// forever -- morale 0 by day 28, troops deserting from turn 22, in a game
// where the hero never attacks anything to refill the larder. Gold was never
// the constraint; 3,000 gold still left the army fully unfed.
//
// The rule (narrowed 2026-10-02): a hero standing on one of its OWN
// settlements draws its weekly food bill out of THAT settlement's warehouse
// -- the hero's larder first, then the city it stands on, never more than it
// holds. Standing on a neutral or enemy town, or in the field, funds nothing
// and the charge simply goes unpaid exactly as before. Nothing travels: the
// old owner-wide pool moved food up to 15+ hexes in a turn, which is exactly
// the teleport this pass removes.
//
// Why the narrow gate is survivable now (it was not when the pool landed):
// instant auto-trade drained every settlement down to exactly
// foodRequired(population) each turn, so the keep's stock read 0 at every
// weekly charge and only the owner's distant surplus could pay. With
// auto-trade OFF for new games (lobby.legacyAutoTrade, economy/trade.ts),
// each settlement ACCUMULATES its own production surplus instead -- the keep
// holds real stock at the charge (init.ts sizes its farmland against its own
// population bill plus the starting hero's weekly bill), and a hero that
// marched away from its food is the one that goes unfed. The caravan chain is
// the replacement logistics: the recommender (economy/tradeNeeds.ts) proposes
// routes, routes carry caravans (logistics.ts), caravans top up warehouses
// and hero larders, and the weekly charge draws on what physically arrived.
//
// Ordering: `turn/endTurn.ts`'s production/trade/consumption pass runs BEFORE
// this charge (turn/round.ts's advanceRound runs it on the day-7 branch), so
// the warehouse drawn from is already net of the turn's population food bill
// -- a settlement can never pay out food it was about to consume itself. What
// the hero takes is genuinely gone: it is deducted from the settlement, and
// the next turn's production (or a caravan) has to earn it back.

// The one settlement a hero may draw on beyond its larder: the city it stands
// on. `available` is what is left of its food after the heroes charged before
// this one. Kept as a list so the draw loop and the shared-warehouse
// bookkeeping below do not care that there is at most one entry.
interface FoodSource {
  id: SettlementId;
  available: number;
}

// The settlement that may fund `hero`'s food bill, or [] when it may not be
// funded at all (in the field, or on someone else's town): larder first
// (applied by the caller), then ONLY a settlement with the hero's hex AND the
// hero's owner -- the "picking it up at a city" mechanism, automated by
// physical presence. Mutates nothing.
function foodSources(
  hero: HeroState,
  settlements: Record<SettlementId, SettlementState>,
  drawnSoFar: Record<string, number>,
): FoodSource[] {
  const sources: FoodSource[] = [];
  for (const s of Object.values(settlements)) {
    // A neutral settlement (ownerId null) is nobody's bill and nobody's larder
    // (turn/endTurn.ts's consumption loop skips it), so it can never fund an
    // army -- and neither can another seat's town under the hero's boots.
    if (s.ownerId === null || s.ownerId !== hero.ownerId) continue;
    if (!(s.q === hero.q && s.r === hero.r)) continue;
    const available = Math.max(0, (s.warehouse.food ?? 0) - (drawnSoFar[s.id] ?? 0));
    if (available > 0) sources.push({ id: s.id, available });
  }
  // Insertion order of the settlement record is the only tie-break there can
  // be (one settlement per hex); sort by id so the split never depends on it.
  sources.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
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