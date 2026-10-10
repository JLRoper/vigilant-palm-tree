import type { BuildingDef, BuildingKind, GenerationStyle, Platoon } from "@heroes/contracts";
import { buildingFootprintFromRegistry, buildingSettlementEffects } from "../buildingRegistry";
import { evaluateTroopUpkeep, UPKEEP_CHARGE_DAYS } from "../economy/troopUpkeep";
import { pickStyleForBuilding } from "../styleResolver";
import type { UnitType } from "../units";
import type { CityViewSize } from "./citySpots";
import { CELL_MULTIPLIER_PEAK } from "./cityMultipliers";

// The starter city of a brand-new settlement: town hall, farm, two houses,
// two wood producers, one stone producer, and the troop producer (the
// farmhouse). This is the ONE definition of that set -- init.ts seeds EVERY
// settlement with it at game creation, and the city view's empty-settlement
// commit calls the same function rather than re-deriving a layout of its own.
//
// Its farm count is a function of the food bill it has to feed
// (starterFarmsNeeded), sized against the settlement's OWN bill -- its
// population, plus the weekly bill of the starting hero that stands on it,
// whose upkeep draw lands on exactly this settlement (hero/upkeep.ts's
// under-hero rule). Since instant auto-trade was gated off for new games
// (lobby.legacyAutoTrade, 2026-10-02) no settlement can borrow a sibling's
// surplus, so each city's farmland covers its own mouths. See init.ts's
// seedStarterBuildings for the per-settlement bill.
//
// It replaces the old behavior: a previously-empty settlement was handed the
// DENSE PROCEDURAL city (cityBuildingGen's denseUrban pattern, ~14 buildings
// including a level-2 town hall) for free and already constructed. That layout
// charged roughly 24 wood + 14 stone per turn in upkeep against a 300/300
// starting stock -- bankruptcy by roughly turn 12, before the player had done
// anything -- while containing no producer at all. The set below costs 10
// wood + 2 stone per turn (townHall L1 3+2, house L1 1+0 twice, woodcutterHut
// L1 1+0 twice, stoneMine L1 2+0, farmField L1 0+0 each, farmhouse L1 1+0),
// and the three producers
// return 6 wood (two huts) and 3 stone per turn -- each scaled by its OWN cell
// multiplier (settlement/cityMultipliers.ts), and truncated to whole units
// because consumption floors the whole stock every turn, so a producer really
// banks floor(3 x multiplier) per turn.
//
// THE SET IS STILL NET WOOD-NEGATIVE, but only just. Per turn:
//   wood  = floor(3 x m1) + floor(3 x m2) - 10 = -8..-2, median -4
//   stone = floor(3 x m_stone) - 2             = 0..+3, median  0
// (both over 400 seeded 1-player games with produceSettlementResources and the
// map's resource-tile rates zeroed, i.e. a settlement on a map with no wood or
// stone tiles at all; the wood figure includes the 2026-10-04 farmhouse, whose
// +1 upkeep moved the median from -3 -- before it the same measurement ran
// -7..-1, median -3). The farmhouse's food production (+2/turn at L1, scaled
// by cell multiplier like every producer) partially offsets its own inclusion
// on the food side, and its recruit entry is the point -- garrison troops for
// everyone from turn 0. The second hut is the 2026-10-02 balance fix: with one
// hut the same measurement ran -4..-7, median -5, so a keep drained its 300
// wood in ~60 turns and a town in ~43 at the worst cell -- and after wood hit
// 0, settlement morale decayed ~8-10 per turn. Two huts cost +1 wood of upkeep
// and bring back another ~3, roughly doubling the runway: ~100 turns at the
// median cell, ~43 at the worst measured one. The set still does not pay for
// itself -- the map's own resource tiles are what keeps a settlement solvent
// in practice. On the default map those tiles are a lottery for wood: over the
// same 400 seeds about a fifth of keeps sat on a wood-yielding tile and ran
// +9..+55 wood/turn, while the rest ran the set's own deficit -- which is why
// the fix targets the floor every city shares, not the lottery.
//
// What the producers actually buy is the stone line -- it stops draining
// outright -- and a wood line that only sinks ~4/turn instead of ~5. The
// pre-producer set (townHall + 2 houses, 5w + 2s upkeep, no production) ran
// -5 wood / -2 stone per turn; the woodcutterHuts and the stoneMine together
// cost 4 wood of upkeep against 6 wood + 3 stone of production, so wood lands
// 1/turn better than that bare set at the median cell (the farmhouse's +1
// upkeep buys the recruit entry and a small food line, not wood). That is what
// removed
// the ~24 wood/turn dense layout and the bankruptcy by turn 12 (measured: a
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
// No procedural generator competes with this set any more: the city view's
// design sandbox (Generate button, pattern/seed keys) and
// src/render/cityBuildingGen's layout patterns were both removed, so this is
// the only starting city a settlement can be handed.

/** Level 1 throughout: a free level-2 town hall would unlock settlement upgrades on turn 0. */
export const STARTER_BUILDING_LEVEL = 1;

/**
 * The starter set's wood and stone producers. Both are the cheapest dedicated
 * producer for their resource in the registry (150g/5w and 250g/6w/4s to
 * place, 1+0 and 2+0 wood upkeep per level) and both produce 3/turn at L1 --
 * the shared producer magnitude. The WOOD producer ships TWICE (2026-10-02
 * balance): one hut's 3 wood/turn only cancelled the set's own producer
 * upkeep, leaving every starter city net wood-negative (-4..-7, median -5) no
 * matter the map; the second hut's +3 (median) roughly doubles the wood
 * runway (the arithmetic at the top of this file). The stone line never
 * drains and one mine is enough for it.
 *
 * Gold deliberately gets no producer: `applyEffectiveIncome` already pays
 * `population * goldTax * morale / 100` every turn regardless of the map (5/turn
 * at a 500-population keep, 30/turn at a 1,500-population town), so gold was
 * never the map-dependent resource.
 */
export const STARTER_WOOD_PRODUCER: BuildingKind = "woodcutterHut";
export const STARTER_STONE_PRODUCER: BuildingKind = "stoneMine";

/**
 * The starter set's troop producer -- the registry's lowest-tier one
 * (buildingRegistry.ts: the farmhouse recruits the tier-1 peasant at 25g,
 * minLevel 1), so every settlement the game creates -- player keep, AI castle,
 * chartered town -- can raise garrison troops from the moment it exists.
 * Recruits flow through the same RecruitUnits gate the AI garrison planner
 * shops from (eligibleRecruitSources), so this one entry turns on player AND
 * AI garrison recruitment from turn 0. Cheapest troop building to run (1 wood
 * + 0 stone upkeep at L1) and a small food producer (+2 food/turn at L1), so
 * it feeds the food line it taxes nothing.
 */
export const STARTER_TROOP_BUILDING: BuildingKind = "farmhouse";

/** The starter set's producer kinds, in commit order: the wood producer twice, then stone. */
export const STARTER_PRODUCER_KINDS: readonly BuildingKind[] = [
  STARTER_WOOD_PRODUCER,
  STARTER_STONE_PRODUCER,
  STARTER_WOOD_PRODUCER,
];

/** The base set's contents, in commit order, at STARTER_BASE_FARMS. Farm before the houses so a footprint clash resolves onto a house cell, not the field; the producers come last for the same reason (they are 1x1, so they are the cheapest thing to displace), and the troop building after the producers (also 1x1 -- a footprint change can only ever displace a producer or the troop building). A food-hungry settlement repeats the farmField entry `farms - STARTER_BASE_FARMS` more times; derive the set with buildStarterLayout rather than from this list. */
export const STARTER_BUILDING_KINDS: readonly BuildingKind[] = [
  "townHall",
  "farmField",
  "house",
  "house",
  ...STARTER_PRODUCER_KINDS,
  STARTER_TROOP_BUILDING,
];

export interface StarterLayoutOptions {
  /** City grid edge length (5 = settlement, 10 = town, 15 = castle). */
  size: CityViewSize;
  /** Preferred visual style: kinds with committed sprite art resolve to that art's style instead (see starterStyleFor). */
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
 * Headroom is cheap and is not re-tuned per requirement: a farmField's upkeep
 * is 0 wood / 0 stone, so an extra field costs only four grid cells. Re-measured
 * per settlement class over 4000 seeded 1-player games (real cellMultiplier,
 * multi-spot cities) once sizing went per-settlement (2026-10-02) -- see
 * docs/resource-gathering.md for the per-class coverage table.
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
 * after every farm and house so a footprint change in the registry can only
 * displace a producer -- never eat a farm or a house cell (the troop building
 * places after them, so a clash displaces the producer first). On a 5x5 grid
 * neither offset is in bounds
 * (centre + 3 = 5), so both degrade to "first free cell", deterministically.
 * The second wood hut (the third producer) has no named offset: like a farm
 * past its ring, it takes the first free cell.
 */
const STARTER_PRODUCER_OFFSETS: readonly (readonly [number, number])[] = [
  [2, 3],
  [-2, 3],
];

/**
 * The food/turn the starting hero standing on a settlement adds to that
 * settlement's food bill.
 *
 * `costFood` is the engine's own weekly troop bill — the exact call
 * `resolveTroopUpkeep` makes on the weekly charge (economy/troopUpkeep.ts) — so
 * the sizing cannot drift from what the game actually charges. It is divided by
 * UPKEEP_CHARGE_DAYS because farms produce per TURN while the charge lands once
 * every UPKEEP_CHARGE_DAYS turns: a settlement whose only food source is
 * farmland has to earn the hero's bill as well as its population's -- and with
 * the under-hero draw rule (hero/upkeep.ts) the hero eats from THIS settlement
 * alone, so the term belongs only to the city the hero spawns on.
 *
 * Measured for the default 1-player demo army (12 swordsman + 8 archer + 4
 * cavalry = 40 food/week under the catalog, ~5.7 food/turn).
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
 * The argument is a FOOD BILL (food/turn), not a population. The caller adds
 * every mouth that eats out of THIS settlement's warehouse: its population
 * (`foodRequiredForPopulation`) plus the weekly bill of any starting hero that
 * stands on it (`heroFoodPerTurn`) -- 5 + 40/7 = ~10.7 food/turn for the
 * level-1 keep the 1-player demo hero spawns on, which asks for 4 farms (the
 * 5x5 grid holds 3, so the keep runs on the capacity clamp + accumulated
 * surplus; see init.ts's seedStarterBuildings). Passing a single settlement's
 * population where the hero's bill also lands on it is the bug this parameter
 * change exists to make impossible to write twice.
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
 * it, two wood producers + one stone producer, and the troop producer (the
 * farmhouse). Legal on every city size
 * (5/10/15), non-overlapping, and byte-identical on every call for a given
 * `farms`.
 *
 * `farms` is the caller's allocation of THIS settlement's food bill: init.ts
 * sizes it against the settlement's own population plus the weekly bill of the
 * starting hero standing on it (a keep asks ~10.7 food/turn), a settlement
 * created later -- by a charter, or as a test fixture -- just calls this with
 * the default, which is the same set the city view's free commit hands it. See
 * starterFarmsNeeded.
 */
export function buildStarterLayout(options: StarterLayoutOptions): BuildingDef[] {
  const { size, style } = options;
  const center = Math.floor(size / 2);
  const buildings: BuildingDef[] = [];
  const farms = Math.max(STARTER_BASE_FARMS, Math.floor(options.farms ?? STARTER_BASE_FARMS));

  const put = (kind: BuildingKind, gx: number, gy: number): void => {
    buildings.push({ gx, gy, kind, level: STARTER_BUILDING_LEVEL, style: starterStyleFor(kind, style) });
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
  // Last among the food/wood/stone infrastructure, so a footprint change in
  // the registry displaces a producer (1x1, the cheapest thing to move)
  // rather than a farm field or a house.
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
  // The troop producer, after the producers: named offset (2, 0) puts it right
  // of the town hall, beside it like the houses sit above it; when that cell
  // is taken it degrades to the first free cell deterministically (placeAt's
  // fallback). A registry footprint change can only displace a producer or
  // this building -- never a farm or a house.
  placeAt(buildings, size, style, STARTER_TROOP_BUILDING, center + 2, center);
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
  buildings.push({ gx: target.gx, gy: target.gy, kind, level: STARTER_BUILDING_LEVEL, style: starterStyleFor(kind, style) });
}

/**
 * The style a starter building is persisted with. Every non-farmField kind
 * resolves to "pixel": BUILDING_SPRITE_KEYS is pixel-only, so the fall-through
 * finds the pixel art whatever style the caller prefers, and a starter city
 * renders real sprites. The farmField keeps the caller's style so the
 * render-time shim (cityScene's farmFieldStyleAt) keeps giving starter farms
 * their deterministic pixel/pixel-alt variety. Deterministic:
 * pickStyleForBuilding is pure, so the byte-identical-per-call contract
 * holds.
 */
function starterStyleFor(kind: BuildingKind, style: GenerationStyle): GenerationStyle {
  if (kind === "farmField") return style;
  return pickStyleForBuilding(kind, STARTER_BUILDING_LEVEL, style);
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
