import type { BuildingKind } from "@heroes/contracts";
import { buildingFootprintFromRegistry } from "@heroes/engine";

// User-facing footprint text for a building kind, in BLOCKED cells.
//
// The registry numbers are not always whole: the level-2/3 overrides for
// granary / bank / goldMine / woodcutterHut are a visual 1.5x1.5 while
// `coversCell` (cityBuildingDraw/primitives.ts) blocks every cell they touch --
// `gx < b.gx + 1.5` admits gx+0 and gx+1. So the number a player cares about
// ("how much of my town does this eat") is the ceiling, and a 2x2 warehouse
// that became 2x2 in the registry has to say so wherever the palette does.

export interface FootprintCells {
  w: number;
  h: number;
  /** w * h grid cells blocked. */
  cells: number;
}

export function footprintCells(kind: BuildingKind, level?: number): FootprintCells {
  const fp = buildingFootprintFromRegistry(kind, level);
  const w = Math.max(1, Math.ceil(fp.w));
  const h = Math.max(1, Math.ceil(fp.h));
  return { w, h, cells: w * h };
}

/** "2x2 tiles (4)" — the tooltip/popup form. Empty for the default single cell, which needs no explanation. */
export function footprintLine(kind: BuildingKind, level?: number): string {
  const { w, h, cells } = footprintCells(kind, level);
  if (w === 1 && h === 1) return "";
  return `Takes ${w}\u00D7${h} tiles (${cells})`;
}

/** " (2x2)" appended to a build-palette row label. Empty for a single cell. */
export function footprintSuffix(kind: BuildingKind): string {
  const { w, h } = footprintCells(kind);
  return w === 1 && h === 1 ? "" : ` (${w}\u00D7${h})`;
}