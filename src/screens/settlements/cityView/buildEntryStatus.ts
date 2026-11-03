import type { BuildingDef, BuildingKind } from "@heroes/contracts";
import { buildRate, buildingBuildDays, buildingPlacementCost, buildingUpkeep, CONSTRUCTION_MAX_BUILDERS } from "@heroes/engine";
import { coversCell } from "../../../core/cityGrid";
import type { NetCost } from "./netCost";
import { footprintCells, footprintLine } from "./footprint";

const COST_RESOURCES = ["gold", "wood", "stone", "iron", "arcane"] as const;

type CostResource = (typeof COST_RESOURCES)[number];

export interface BuildEntryAffordability {
  gold: number;
  warehouse: {
    wood: number;
    stone: number;
    iron: number;
    arcane: number;
  };
}

export interface BuildEntryStatus {
  disabled: boolean;
  reasons: string[];
  title: string;
}

export interface BuildConfirmStatus {
  ok: boolean;
  reasons: string[];
  title: string;
}

export interface BuildEntryStatusOptions {
  kind: BuildingKind;
  affordability: BuildEntryAffordability | null;
  hasTownHall?: boolean;
  isDistrict?: boolean;
  /**
   * Terrain of the open district's hex (undefined for the main settlement, or
   * when the caller has no map). Drives the water rules: a water district may
   * only hold a shipyard, and a shipyard may only stand on water.
   */
  districtTerrain?: string | null;
  /**
   * The grid the placement would land on -- its edge in cells and the
   * buildings already standing on it (including anything staged in the cart,
   * which is what the ghost's own check reads). Omit when the caller has no
   * grid: the space rule is then simply not stated, exactly as the terrain
   * rules are not.
   */
  space?: BuildEntrySpaceOptions | null;
}

/** The grid a palette row would place into. */
export interface BuildEntrySpaceOptions {
  /** City-grid edge in cells (`cityViewSizeFor(level)`: 5 / 10 / 15). */
  size: number;
  /** Everything already on that grid, staged placements included. */
  buildings: ReadonlyArray<BuildingDef>;
}

export interface BuildConfirmStatusOptions {
  net: NetCost;
  charged: NetCost;
  affordability: BuildEntryAffordability | null;
}

export function buildEntryStatus(opts: BuildEntryStatusOptions): BuildEntryStatus {
  const blocking: string[] = [];
  if (opts.affordability) {
    const cost = buildingPlacementCost(opts.kind);
    for (const r of COST_RESOURCES) {
      const need = cost[r] ?? 0;
      const have = availableOf(opts.affordability, r);
      if (need > have) blocking.push(`Not enough ${r} (need ${need}, have ${have})`);
    }
  }
  if (opts.hasTownHall) blocking.push("A town hall already exists in this settlement");
  if (opts.isDistrict && opts.kind === "townHall") {
    blocking.push("Town Hall can only be built in the main settlement");
  }
  const terrainNote = districtTerrainBlock(opts.districtTerrain, opts.kind);
  if (terrainNote) blocking.push(terrainNote);
  const spaceNote = footprintSpaceBlock(opts.space, opts.kind);
  if (spaceNote) blocking.push(spaceNote);
  const reasons = [...blocking];
  const size = footprintLine(opts.kind);
  if (size) reasons.push(size);
  const buildTime = buildTimeLine(opts.kind);
  if (buildTime) reasons.push(buildTime);
  const upkeep = upkeepLine(opts.kind);
  if (upkeep) reasons.push(upkeep);
  return { disabled: blocking.length > 0, reasons, title: reasons.join("\n") };
}

export function buildConfirmStatus(opts: BuildConfirmStatusOptions): BuildConfirmStatus {
  const reasons: string[] = [];
  if (opts.affordability) {
    for (const r of COST_RESOURCES) {
      const needed = Math.max(0, (opts.net[r] ?? 0) - (opts.charged[r] ?? 0));
      const have = availableOf(opts.affordability, r);
      if (needed > have) reasons.push(`Not enough ${r} (need ${needed}, have ${have})`);
    }
  }
  return { ok: reasons.length === 0, reasons, title: reasons.join("\n") };
}

function availableOf(affordability: BuildEntryAffordability, r: CostResource): number {
  return r === "gold" ? affordability.gold : affordability.warehouse[r];
}

/**
 * The water rules a district's own terrain imposes, or null. Kept here (rather
 * than in the palette) so the entry list, the ghost and the confirm button all
 * read the same sentence, and so it is unit-testable without a DOM.
 */
export function districtTerrainBlock(terrain: string | null | undefined, kind: BuildingKind): string | null {
  if (terrain === null || terrain === undefined) return null;
  if (terrain === "water") {
    return kind === "shipyard" ? null : "Only a shipyard can be built on water";
  }
  return kind === "shipyard" ? "Shipyard must be built on water" : null;
}

function upkeepLine(kind: BuildingKind): string {
  const upkeep = buildingUpkeep(kind, 1);
  const parts: string[] = [];
  if (upkeep.wood > 0) parts.push(`${upkeep.wood} wood`);
  if (upkeep.stone > 0) parts.push(`${upkeep.stone} stone`);
  return parts.length > 0 ? `Upkeep: ${parts.join(", ")} per turn` : "";
}

/**
 * E5 (playthrough round 2b): the palette row carried its build time as a bare
 * number beside an hourglass GLYPH -- no label, and the row's tooltip
 * (footprint + upkeep) never named it at all. The half that costs money was
 * invisible too: a site under construction is charged its upkeep from the
 * placement's own turn while it produces nothing (`applySettlementConsumption`
 * bills `buildingUpkeepRequired` over every building, and
 * `producerTurnOutput` returns null for one with `construction`), so the
 * player paid for two days of output they never got with nothing on the
 * placement surface saying so. Both facts are stated here, in the row's own
 * tooltip, so they can be priced before the click instead of discovered in the
 * building's menu afterwards.
 */
function buildTimeLine(kind: BuildingKind): string {
  const days = buildingBuildDays(kind);
  if (days <= 0) return "";
  return (
    `Build time: ${days} day${days === 1 ? "" : "s"} at 1 builder, up to ${buildRate(CONSTRUCTION_MAX_BUILDERS).toFixed(2)}\u00d7 with ${CONSTRUCTION_MAX_BUILDERS} \u2014 its upkeep is paid while it is under ` +
    `construction, it produces nothing until it is finished, and a site with no builders makes no progress`
  );
}

/**
 * E4 (playthrough round 2b): a fresh LEVEL-1 settlement's 5x5 grid has no free
 * 2x2 anchor at all -- the free starter set (town hall 2x2, three 2x2 farm
 * fields, two houses, two woodcutter huts, a stone mine, a farmhouse) covers
 * 22 of the 25 cells and the three left over are a single row -- so every 2x2
 * palette row was an unplaceable offer. The row said `Takes 2x2 tiles (4)` and
 * nothing else; the only explanation arrived after arming it and clicking,
 * which reads as "the game ignored me". The palette now states the rule in the
 * same voice as its other refusals and disables the row.
 *
 * The occupancy rule is the placer's own (`coversCell` -> the building's
 * stored w/h, else its registry footprint at that level), so a staged building
 * in the cart counts exactly as it does for the ghost: the palette and the
 * ghost can never disagree about whether a footprint fits.
 *
 * Returns null when at least one anchor is free, or when the caller has no grid
 * to check against (`space` omitted) -- "unknown" must never read as "blocked".
 */
export function footprintSpaceBlock(
  space: BuildEntrySpaceOptions | null | undefined,
  kind: BuildingKind,
): string | null {
  if (!space) return null;
  // The row's own footprint vocabulary (ceiled cells), so the sentence about
  // the grid says the same number as the line above it about the building.
  const { w, h } = footprintCells(kind, 1);
  const label = `${w}\u00D7${h}`;
  if (w > space.size || h > space.size) {
    return `A ${label} building does not fit this ${space.size}\u00D7${space.size} grid.`;
  }
  for (let x = 0; x + w <= space.size; x++) {
    for (let y = 0; y + h <= space.size; y++) {
      let free = true;
      for (let dx = 0; dx < w && free; dx++) {
        for (let dy = 0; dy < h && free; dy++) {
          if (space.buildings.some((b) => coversCell(b, x + dx, y + dy))) free = false;
        }
      }
      if (free) return null;
    }
  }
  return (
    `No free ${label} space in this city \u2014 every place it could stand is covered. ` +
    `Raise the settlement's level for a bigger grid, or build it in a district.`
  );
}
