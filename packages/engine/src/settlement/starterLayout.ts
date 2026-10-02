import type { BuildingDef, BuildingKind, GenerationStyle, Platoon } from "@heroes/contracts";
import { buildingFootprintFromRegistry, buildingSettlementEffects } from "../buildingRegistry";
import { evaluateTroopUpkeep, UPKEEP_CHARGE_DAYS } from "../economy/troopUpkeep";
import type { UnitType } from "../units";
import type { CityViewSize } from "./citySpots";
import { CELL_MULTIPLIER_PEAK } from "./cityMultipliers";

// The starter city of a brand-new settlement: town hall, farm, two houses, and
// one wood and one stone producer. This is the ONE definition of that set --
// init.ts seeds EVERY settlement with it at game creation, and the city view's
// empty-settlement commit calls the same function rather than re-deriving a
// layout of its own.
//
// Its farm count is a function of the food bill it has to feed
// (starterFarmsNeeded), sized against the WHOLE owner's holdings rather than
// one settlement's population: a 1-player game starts with a level-1 keep (500,
// 5 food/turn) AND a level-2 town (1,500, 15/turn), and both eat out of one
// pool of farm fields. That pool also feeds the owner's HEROES, whose weekly
// troop bill (heroFoodPerTurn -- the engine's own evaluateTroopUpkeep) is drawn
// out of these same warehouses on every weekly upkeep tick. See init.ts's
// seedStarterBuildings for the allocation.
//
// It replaces the old behavior: a previously-empty settlement was handed the
// DENSE PROCEDURAL city (cityBuildingGen's denseUrban pattern, ~14 buildings
// including a level-2 town hall) for free and already constructed. That layout
// charged roughly 24 wood + 14 stone per turn in upkeep against a 300/300
// starting stock -- bankruptcy by roughly turn 12, before the player had done
// anything -- while containing no producer at all. The set below costs 8 wood
// + 2 stone per turn (townHall L1 3+2, house L1 1+0 twice, woodcutterHut L1
// 1+0, stoneMine L1 2+0, farmField L1 0+0 each), and the two producers return
// 3 wood and 3 stone per turn -- each scaled by its OWN cell multiplier
// (settlement/cityMultipliers.ts), and truncated to whole units because
// consumption floors the whole stock every turn, so a producer really banks
// floor(3 x multiplier) per turn.
//
// THE SET IS NET WOOD-NEGATIVE. It does not pay for itself. Per turn:
//   wood  = floor(3 x m_wood) - 8  = -7..-4, median -5  (m_wood 0.60..1.51)
//   stone = floor(3 x m_stone) - 2 = 0..+3, median  0
// (both measured over 10 seeds with produceSettlementResources +
// applySettlementConsumption and no map income). So a starter settlement on a
// map with no wood or stone tiles at all drains its 300 wood start at ~5 wood
// per turn -- roughly 60 turns of runway, ~50 at the worst measured cell -- and
// the map's own resource tiles are what keeps it solvent in practice. On the
// default map those tiles are still a lottery for wood: 3 of 10 seeded
// 1-player games had a wood-yielding map (15..45 wood/turn) and their level-1
// keep ran +9/turn, while the other 7 ran the set's own -5/turn.
//
// What the producers actually buy is the stone line: it stops draining, and the
// wood line does not get any worse than it was without them. The pre-producer
// set (townHall + 2 houses, 5w + 2s upkeep, no production) also ran -5 wood /
// -2 stone per turn. The woodcutterHut (+1w upkeep) and the stoneMine (+2w)
// together cost exactly the 3 wood/turn the hut brings back, so wood lands on
// the same -5 and the mine lifts stone from -2 to ~0. That is what removed the
// ~24 wood/turn dense layout and the bankruptcy by turn 12 (measured: a
// `{gold: 40}` seed drained 300 -> 195 wood over 22 turns, a `{wood: 180}` seed
// did not) -- it is not, and is not meant to be, where the wood balance is
// settled. Whether a starter city should be wood-positive is a separate balance
// call; the numbers above are what it does today.
//
// Placement is deterministic and seed-free: the town hall takes its registry
// footprint over the centre cell (the cell the placer reserves as
// non-destroyable), and the rest sit at fixed offsets around it. Every cell is
// verified before use, so a footprint change in the registry degrades to "the
// next free cell" instead of producing an illegal layout.
//
// src/render/cityBuildingGen.ts keeps its procedural layouts for the design
// box's Generate button and for previewing generation styles; it is no longer
// the source of a settlement's starting city.

/** Level 1 throughout: a free level-2 town hall would unlock settlement upgrades on turn 0. */
export const STARTER_BUILDING_LEVEL = 1;

/**
 * The starter set's wood and stone producers. Both are the cheapest dedicated
 * producer for their resource in the registry (150g/5w and 250g/6w/4s to
 * place, 1+0 and 2+0 wood upkeep per level) and both produce 3/turn at L1 --
 * the shared producer magnitude -- so the set's stone line never drains and its
 * wood line drains no faster than it did without them (the arithmetic at the top
 * of this file). The wood line is still the map's to settle.
 *
 * Gold deliberately gets no producer: `applyEffectiveIncome` already pays
 * `population * goldTax * morale / 100` every turn regardless of the map (5/turn
 * at a 500-population keep, 30/turn at a 1,500-population town), so gold was
 * never the map-dependent resource.
 */
export const STARTER_WOOD_PRODUCER: BuildingKind = "woodcutterHut";
export const STARTER_STONE_PRODUCER: BuildingKind = "stoneMine";

/** The starter set's producer kinds, in commit order. */
export const STARTER_PRODUCER_KINDS: readonly BuildingKind[] = [STARTER_WOOD_PRODUCER, STARTER_STONE_PRODUCER];

/** The base set's contents, in commit order, at STARTER_BASE_FARMS. Farm before the houses so a footprint clash resolves onto a house cell, not the field; the producers come last for the same reason (they are 1x1, so they are the cheapest thing to displace). A food-hungry settlement repeats the farmField entry `farms - STARTER_BASE_FARMS` more times; derive the set with buildStarterLayout rather than from this list. */
export const STARTER_BUILDING_KINDS: readonly BuildingKind[] = [
  "townHall",
  "farmField",
  "house",
  "house",
  ...STARTER_PRODUCER_KINDS,
];

export interface StarterLayoutOptions {
  /** City grid edge length (5 = settlement, 10 = town, 15 = castle). */
  size: CityViewSize;
  /** Visual style stamped on every building in the set. */
  style: GenerationStyle;
  /** Farm fields in the set. Defaults to STARTER_BASE_FARMS (1). */
  farms?: number;
}

/** Farm fields in the base starter set: the one every starter city carries, on top of any pool its owner allocated. */
export const STARTER_BASE_FARMS = 1;

/**
 * Extra farm fields added on top of the count that exactly covers a food bill.
 * A farm's real output is its registry rate times a per-cell multiplier that is
 * Gaussian around the peak (cityMultipliers: peak + 0.25 * z), so a count sized
 * to land exactly on the requirement is short in roughly half of all seeded
 * cities -- measured over 4000 seeds for a 1500-population town (15 food/turn):
 * 3 farms cover it 51.1% of the time, 4 farms 98.0%, 5 farms 100%. One farm of
 * headroom is what turns a coin flip into a town that actually eats.
 *
 * Headroom is cheap and the headroom is not re-tuned per requirement: a
 * farmField's upkeep is 0 wood / 0 stone, so an extra field costs only four
 * grid cells. Measured again over 4000 seeded 1-player games (32,000 real farm
 * cells, multiplier min 0.02 / mean 1.062 / max 3.86) against the ~25.7 food/turn
 * a keep + town + demo hero actually eat (20 population + 40/7 hero), and
 * counting the keep's base farm alongside the pool host's fields:
 *
 * | pool host fields | covers the combined bill |
 * |---|---|
 * | 5 (population bill only — the pre-hero-bill count) | 94.25% |
 * | 6 | 99.83% |
 * | **7 (`starterFarmsNeeded(25.714)`)** | **99.98%** |
 * | 8 | 100% |
 *
 * so the derived count buys ~5.7 points over what one more farm would. The one
 * uncovered seed is short 1.56 food/turn (a 0.94 ratio), not a collapse.
 */
export const STARTER_FARM_VARIANCE_HEADROOM = 1;

/**
 * Farm cell offsets from the town hall's centre, in commit order. Offset 0 is
 * the original single starter farm, so a one-farm city is byte-identical to
 * before. Any farm past this list takes the first free cell instead.
 */
const STARTER_FARM_OFFSETS: readonly (readonly [number, number])[] = [
  [-2, 0],
  [-2, -2],
  [2, -2],
  [-2, 2],
  [2, 2],
  [0, 2],
];

/**
 * Producer cell offsets, in STARTER_PRODUCER_KINDS order, from the town hall's
 * centre. They sit two rows below the farm ring's deepest row so they never
 * collide with a farm field or a house on any grid size, and both are placed
 * LAST so a footprint change in the registry can only displace a producer --
 * never eat a farm or a house cell. On a 5x5 grid neither offset is in bounds
 * (centre + 3 = 5), so both degrade to "first free cell", deterministically.
 */
const STARTER_PRODUCER_OFFSETS: readonly (readonly [number, number])[] = [
  [2, 3],
  [-2, 3],
];

/**
 * The food/turn an owner's heroes add to their pool's food bill.
 *
 * `costFood` is the engine's own weekly troop bill — the exact call
 * `resolveTroopUpkeep` makes on the weekly charge (economy/troopUpkeep.ts) — so
 * the sizing cannot drift from what the game actually charges. It is divided by
 * UPKEEP_CHARGE_DAYS because farms produce per TURN while the charge lands once
 * every UPKEEP_CHARGE_DAYS turns: an owner whose only food source is farmland
 * has to earn the hero's bill as well as the population's.
 *
 * Measured for the default 1-player demo army (12 swordsman + 8 archer + 4
 * cavalry = 40 food/week under the catalog, ~5.7 food/turn): against the
 * population bill alone the pair produced 21-35 food/week of surplus, and the
 * pool was short from the FIRST charge (day 7) on 2 of 6 seeds, one of which
 * spiralled to hero morale 0 by turn 49.
 *
 * `unitTypes` is the unit catalog. Omitting it falls back to units.ts's flat
 * 1 gold / 1 food per troop, which UNDER-reports that army as 24 food/week --
 * so init.ts threads BuildInitialOptions.unitTypes through rather than relying
 * on the default (the same optional-catalog contract applyWeeklyUpkeep has).
 */
export function heroFoodPerTurn(stacks: readonly Platoon[], unitTypes: Record<string, UnitType> = {}): number {
  // availableGold/availableFood only decide `unfed`; costFood is a pure function
  // of the stacks, so 0/0 sizes the bill without implying anything about a purse
  // or a larder (hero/upkeep.ts's draw-sizing call reads the same way).
  const perWeek = evaluateTroopUpkeep(stacks, unitTypes, 0, 0).costFood;
  return perWeek / UPKEEP_CHARGE_DAYS;
}

/**
 * Farm fields needed to cover `foodRequiredPerTurn` food/turn, derived from the
 * registry rather than from a table of levels: the food requirement against one
 * farm field's PLAIN-CELL output (`foodPerTurn` from buildingRegistry times
 * CELL_MULTIPLIER_PEAK), floored at STARTER_BASE_FARMS and padded by
 * STARTER_FARM_VARIANCE_HEADROOM.
 *
 * The argument is a FOOD BILL (food/turn), not a population. A player's
 * holdings eat one bill between them, so init.ts passes
 * `foodRequiredForPopulations` over every settlement the owner holds PLUS
 * `heroFoodPerTurn` over the owner's heroes -- 20 + 40/7 = ~25.7 food/turn for
 * the keep + town + demo army a 1-player game starts with, which sizes to 7
 * farms. Passing a single settlement's population instead is the bug this
 * parameter change exists to make impossible to write twice: 15 food/turn
 * sized to 4 farms left the pair 5 food/turn short, measured across 29 of 60
 * seeded games with 11 reaching morale 0.
 */
export function starterFarmsNeeded(foodRequiredPerTurn: number): number {
  const perFarm = (buildingSettlementEffects("farmField", STARTER_BUILDING_LEVEL).foodPerTurn ?? 0) * CELL_MULTIPLIER_PEAK;
  const shortfall = foodRequiredPerTurn - perFarm * STARTER_BASE_FARMS;
  if (!(perFarm > 0) || shortfall <= 0) return STARTER_BASE_FARMS;
  return STARTER_BASE_FARMS + Math.ceil(shortfall / perFarm) + STARTER_FARM_VARIANCE_HEADROOM;
}

export interface StarterCityOnOpen {
  buildings: BuildingDef[];
  /** True when these are the free starter set a previously-empty settlement is handed at no cost. */
  free: boolean;
}

/**
 * What a settlement's city view shows the moment it opens, and whether that set
 * is the free starter commit.
 *
 * The rule that matters: a settlement that ALREADY has buildings is never free-
 * committed again. Its buildings were persisted by whoever put them there --
 * a PlaceBuildings command for a player-built city, or game creation for a
 * settlement too big for the base starter set to feed (init.ts seeds those) --
 * so re-committing would double its city, and charging for it would charge the
 * player for a city they already own. This is also why the seeded settlements
 * are seeded with the town hall included: skipping the free commit is only
 * correct if the set is complete.
 */
export function starterCityOnOpen(input: {
  size: CityViewSize;
  style: GenerationStyle;
  farms?: number;
  /** The settlement's persisted buildings, if it has any. */
  existing: BuildingDef[] | undefined;
}): StarterCityOnOpen {
  if (input.existing && input.existing.length > 0) {
    return { buildings: input.existing, free: false };
  }
  return {
    buildings: buildStarterLayout({ size: input.size, style: input.style, farms: input.farms }),
    free: true,
  };
}

/**
 * The free, already-constructed starting city of a settlement: one level-1 town
 * hall on the centre cell, `farms` 2x2 farm fields around it, two houses above
 * it, and one wood + one stone producer. Legal on every city size (5/10/15),
 * non-overlapping, and byte-identical on every call for a given `farms`.
 *
 * `farms` is the caller's allocation of the food bill, not the settlement's own
 * requirement: init.ts sizes the pool against everything its owner holds (a
 * 1-player game's keep + town eat 20 food/turn between them) and puts the pool
 * in one city, giving every other settlement of the same owner the base
 * STARTER_BASE_FARMS. A settlement created later -- by a charter, or as a test
 * fixture -- just calls this with the default, which is the same set the city
 * view's free commit hands it. See starterFarmsNeeded.
 */
export function buildStarterLayout(options: StarterLayoutOptions): BuildingDef[] {
  const { size, style } = options;
  const center = Math.floor(size / 2);
  const buildings: BuildingDef[] = [];
  const farms = Math.max(STARTER_BASE_FARMS, Math.floor(options.farms ?? STARTER_BASE_FARMS));

  const put = (kind: BuildingKind, gx: number, gy: number): void => {
    buildings.push({ gx, gy, kind, level: STARTER_BUILDING_LEVEL, style });
  };

  // The town hall's registry footprint is 2x2 at level 1 (the 1.5x1.5 override
  // is level-2 only), so it is placed with no explicit w/h: coversCell falls
  // back to the registry, and an explicit 2x2 here would go stale the moment
  // that footprint changes.
  put("townHall", center, center);
  for (let i = 0; i < farms; i++) {
    const offset = STARTER_FARM_OFFSETS[i];
    // A null offset (past the named ring) means "first free cell": a farm count
    // larger than the ring is honoured rather than silently truncated.
    placeAt(buildings, size, style, "farmField", offset ? center + offset[0] : null, offset ? center + offset[1] : null);
  }
  placeAt(buildings, size, style, "house", center, center - 2);
  placeAt(buildings, size, style, "house", center, center - 1);
  // Last, so a footprint change in the registry displaces a producer (1x1, the
  // cheapest thing to move) rather than a farm field or a house.
  for (let i = 0; i < STARTER_PRODUCER_KINDS.length; i++) {
    const offset = STARTER_PRODUCER_OFFSETS[i];
    placeAt(
      buildings,
      size,
      style,
      STARTER_PRODUCER_KINDS[i],
      offset ? center + offset[0] : null,
      offset ? center + offset[1] : null,
    );
  }
  return buildings;
}

/** Place `kind` at (gx, gy) -- or, for null coordinates, on the first free cell. Either way the footprint must fit in bounds and hit nothing, otherwise it degrades to the first free cell. */
function placeAt(
  buildings: BuildingDef[],
  size: number,
  style: GenerationStyle,
  kind: BuildingKind,
  gx: number | null,
  gy: number | null,
): void {
  const fp = buildingFootprintFromRegistry(kind, STARTER_BUILDING_LEVEL);
  const w = Math.max(1, Math.floor(fp.w));
  const h = Math.max(1, Math.floor(fp.h));
  const target = gx !== null && gy !== null && fitsAt(buildings, size, gx, gy, w, h)
    ? { gx, gy }
    : firstFreeCell(buildings, size, w, h);
  if (!target) return;
  buildings.push({ gx: target.gx, gy: target.gy, kind, level: STARTER_BUILDING_LEVEL, style });
}

function firstFreeCell(
  buildings: readonly BuildingDef[],
  size: number,
  w: number,
  h: number,
): { gx: number; gy: number } | null {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (fitsAt(buildings, size, x, y, w, h)) return { gx: x, gy: y };
    }
  }
  return null;
}

function fitsAt(
  buildings: readonly BuildingDef[],
  size: number,
  gx: number,
  gy: number,
  w: number,
  h: number,
): boolean {
  if (gx < 0 || gy < 0 || gx + w > size || gy + h > size) return false;
  for (let dx = 0; dx < w; dx++) {
    for (let dy = 0; dy < h; dy++) {
      if (buildings.some((b) => coversCell(b, gx + dx, gy + dy))) return false;
    }
  }
  return true;
}

/** Local twin of `coversCell` (src/render/cityBuildingDraw/primitives.ts), duplicated rather than imported: that module re-exports the `?url` PNG barrel, which plain node/tsx cannot load. */
function coversCell(b: BuildingDef, gx: number, gy: number): boolean {
  const fp = buildingFootprintFromRegistry(b.kind, b.level);
  const w = b.w ?? fp.w;
  const h = b.h ?? fp.h;
  return gx >= b.gx && gx < b.gx + w && gy >= b.gy && gy < b.gy + h;
}
