import type { Platoon } from "@heroes/contracts";
import { evaluateTroopUpkeep, platoonTroopTotal, type UnitType } from "@heroes/engine";
import { cachedUnitTypes } from "../../data/unitCatalog";

// The weekly troop bill, as the player is shown it. Every surface that used to
// interpolate raw troop HEADCOUNT into an "upkeep" line goes through here.
//
// Why a helper at all: the real bill is `Σ count × unitUpkeepGold/Food(unit)`
// from the catalog (economy/troopUpkeep.ts), so a panel cannot re-derive it from
// headcount -- the old readout told a 24-troop army it cost "24g + 24 food" when
// it is charged 76g + 40. Re-deriving the tier math client-side would guarantee
// the drift; asking the engine for it cannot. The formatting lives here too, so
// the three surfaces are testable without a DOM (the bankRows.ts /
// treasuryCap.ts precedent).

export interface UpkeepBill {
  /** Headcount the bill was computed from -- platoonTroopTotal(stacks). */
  troops: number;
  /** Weekly gold. */
  gold: number;
  /** Weekly food. */
  food: number;
}

const EMPTY_BILL = (): UpkeepBill => ({ troops: 0, gold: 0, food: 0 });

/**
 * One hero's weekly bill, straight from the engine's own `evaluateTroopUpkeep`.
 *
 * `unitTypes` is the unit catalog (data/unitCatalog.ts's `cachedUnitTypes()`).
 * An empty record is the sanctioned catalog-less fallback -- units.ts's flat
 * 1 gold / 1 food per troop -- so an empty catalog reads as "N troops cost N gold
 * and N food", which is what the old headcount readout coincidentally showed.
 */
export function heroUpkeepCost(stacks: readonly Platoon[], unitTypes: Record<string, UnitType>): UpkeepBill {
  // availableGold/availableFood only decide `unfed`; costGold/costFood are pure
  // functions of the stacks, so 0/0 prices the bill without implying a purse.
  const bill = evaluateTroopUpkeep(stacks, unitTypes, 0, 0);
  return {
    troops: platoonTroopTotal(stacks),
    gold: Math.round(bill.costGold),
    food: Math.round(bill.costFood),
  };
}

/** The same bill summed over several heroes -- the HUD's "Empire Upkeep" row. */
export function empireUpkeepCost(
  heroes: readonly { stacks: readonly Platoon[] }[],
  unitTypes: Record<string, UnitType>,
): UpkeepBill {
  let bill = EMPTY_BILL();
  for (const hero of heroes) {
    const next = heroUpkeepCost(hero.stacks, unitTypes);
    bill = { troops: bill.troops + next.troops, gold: bill.gold + next.gold, food: bill.food + next.food };
  }
  return bill;
}

// The catalog is a process-lifetime singleton (data/unitCatalog.ts loads it once
// at startup and never reloads), and both callers update per frame, so the
// record is memoized on the first non-empty read rather than rebuilt each frame.
// Before the catalog lands this falls through to `cachedUnitTypes()`'s own
// catalog-less `{}`, which the engine prices at 1g/1f per troop.
let liveCatalog: Record<string, UnitType> | null = null;

function unitCatalog(): Record<string, UnitType> {
  const live = cachedUnitTypes();
  if (liveCatalog === null && Object.keys(live).length > 0) liveCatalog = live;
  return liveCatalog ?? live;
}

/** `heroUpkeepCost` against the live catalog, for per-frame UI callers. */
export function liveHeroUpkeepCost(stacks: readonly Platoon[]): UpkeepBill {
  return heroUpkeepCost(stacks, unitCatalog());
}

/** `empireUpkeepCost` against the live catalog, for per-frame UI callers. */
export function liveEmpireUpkeepCost(heroes: readonly { stacks: readonly Platoon[] }[]): UpkeepBill {
  return empireUpkeepCost(heroes, unitCatalog());
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/**
 * The hero panel's troop row: headcount, then the real bill.
 *
 * The numbers come from the engine's catalog, not from headcount, so this string
 * is a pure function of the bill -- `heroUpkeepLabel(heroUpkeepCost(stacks, CATALOG))`
 * is exactly what the panel renders, with no DOM in the loop.
 */
export function heroUpkeepLabel(bill: UpkeepBill): string {
  return `${bill.troops} \u00B7 Upkeep: ${bill.gold}g + ${bill.food} food/wk`;
}

/**
 * The same row's tooltip, describing where each half actually comes from.
 *
 * Gold is the hero's purse alone -- gold is not a warehouse resource, so a wagon
 * never carries any. Food is the wagon LARDER first, then the owner's
 * settlement warehouses, and only while the hero is standing on one of them
 * (hero/upkeep.ts's applySuppliedHeroUpkeep): in the field, or on a neutral or
 * enemy town, nothing funds the food bill at all.
 */
export function heroUpkeepTitle(bill: UpkeepBill): string {
  return (
    `Weekly upkeep: ${bill.gold}g from the purse + ${bill.food} food, paid from the wagon larder first ` +
    `and then from your own settlements' food while this hero stands on one of them; ` +
    `unpaid gold makes troops desert`
  );
}

/** The HUD's empire-wide row: the same bill summed over every owned hero. */
export function empireUpkeepLabel(bill: UpkeepBill): string {
  return `Empire Upkeep: ${bill.gold}g + ${bill.food} food/wk (${count(bill.troops, "troop")})`;
}

/** The HUD economy tooltip's troop clause -- see heroUpkeepTitle for the rule. */
export function empireUpkeepTitleClause(bill: UpkeepBill): string {
  return (
    `Upkeep: troops ${bill.gold}g + ${bill.food} food/wk ` +
    `(hero purse; larder first, then your own settlements' food while standing on one)`
  );
}