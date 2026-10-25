import type { BuildingDef, GameMode, GenerationStyle, HeroState, Warehouse } from "@heroes/contracts";
import { gameModeSettings } from "@heroes/contracts";
import { foodRequiredForPopulation } from "../economy/consumption";
import { cityViewSizeFor } from "../settlement/citySpots";
import { buildStarterLayout, starterFarmsNeeded } from "../settlement/starterLayout";

// What a settlers settlement starts with (SETTLERS-PLAN.md §3 answer 3, §4 W2).
//
// One place owns both halves of "the wagon carries the starting supplies":
// what a fresh wagon is loaded with (the mode's `wagonSupplies`), what a
// founder is carrying at the moment it founds, and whether the new town is
// handed the classic starter building layout (`freeStarterBuildings`).
// Everything reads the mode's settings keys -- a second literal here would be
// exactly the drift SETTLERS-PLAN.md §1 calls a bug.

/** A warehouse with every resource materialized, so callers never see `undefined`. */
function concrete(warehouse: Warehouse | undefined): Warehouse {
  return {
    wood: warehouse?.wood ?? 0,
    stone: warehouse?.stone ?? 0,
    iron: warehouse?.iron ?? 0,
    arcane: warehouse?.arcane ?? 0,
    food: warehouse?.food ?? 0,
  };
}

/**
 * The load a seat's starting covered wagon carries: the mode's `wagonSupplies`
 * verbatim (a fresh copy, so a caller can never mutate the constant).
 * All-zero for a mode that carries nothing.
 */
export function wagonSuppliesFor(mode: GameMode): Warehouse {
  return concrete(gameModeSettings(mode).wagonSupplies);
}

/**
 * What a founding entity is carrying RIGHT NOW -- its cargo. This, not the
 * mode constant, is what the new settlement's warehouse receives: a player who
 * spent or traded away the wagon's stock before founding founds a poorer town,
 * which is the whole point of the stockpile being cargo.
 */
export function carriedSupplies(founder: HeroState): Warehouse {
  return concrete(founder.resources);
}

/** True when a stockpile holds anything at all (the result's `suppliesGranted`). */
export function hasStock(warehouse: Warehouse): boolean {
  return (
    (warehouse.wood ?? 0) > 0 ||
    (warehouse.stone ?? 0) > 0 ||
    (warehouse.iron ?? 0) > 0 ||
    (warehouse.arcane ?? 0) > 0 ||
    (warehouse.food ?? 0) > 0
  );
}

/**
 * An all-zero stockpile, every key materialized.
 *
 * The town's warehouse when the cargo stays aboard the surviving founder
 * (`cargoStaysWithFounderHero`): one load cannot be in two places, so whichever
 * end keeps it, the other end starts empty.
 */
export function emptyWarehouse(): Warehouse {
  return concrete(undefined);
}

/**
 * The buildings a founded settlement starts with. `freeStarterBuildings` is the
 * mode's key: settlers mode answers NO (the city view's existing free starter
 * commit on first open is the only grant, so a founder cannot plant a fully
 * equipped town for free), while classic's YES reproduces the seeding
 * settlement/* use -- buildStarterLayout sized against the town's own food
 * bill, exactly as init.ts's seedStarterBuildings prices it.
 */
export function foundedSettlementBuildings(mode: GameMode, population: number): BuildingDef[] {
  if (!gameModeSettings(mode).freeStarterBuildings) return [];
  return buildStarterLayout({
    size: cityViewSizeFor(1),
    style: "pixel" as GenerationStyle,
    farms: starterFarmsNeeded(foodRequiredForPopulation(population)),
  });
}
