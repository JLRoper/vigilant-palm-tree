import type { CityViewSize } from "@heroes/engine";
import {
  cellToScreen,
  cellsInDrawOrder,
  cityLayout,
  screenToGridCell,
  type CityCell,
  type CityLayout,
} from "../../../core/cityGrid";

/**
 * The city view's LIVE grid geometry, for a driver (playthrough ledger #22).
 *
 * Before this the only way to click a specific city cell from a probe was to
 * re-implement the whole projection from `src/core/cityGrid.ts` — the tile
 * size, the origin solve, the half-cell pick shift — which silently goes stale
 * the moment the layout changes. This returns the layout the view is actually
 * drawing with, plus the two conversions the painters and the picker use, so a
 * driver asks for a cell instead of re-deriving one.
 *
 * `cellToScreen` mirrors `buildCityScene`'s own transform
 * (`screenOrigin + cellToScreen(gx, gy, gridOrigin) * tileScale`) and
 * `screenToCell` is the picker's `screenToGridCell` — the same functions the
 * view calls, not a copy of them.
 */
export interface CityGridDebug {
  open: true;
  settlementId: string | null;
  size: CityViewSize;
  viewport: { width: number; height: number };
  topInset: number;
  layout: CityLayout;
  /** Every cell, in the order the view paints them (back row first). */
  cells: CityCell[];
  /** The screen point at the centre of one cell's diamond. */
  cellToScreen(gx: number, gy: number): { x: number; y: number };
  /** The cell under a screen point, or null when the point is off the grid. */
  screenToCell(canvasX: number, canvasY: number): CityCell | null;
}

export interface CityGridDebugInput {
  open: boolean;
  settlementId: string | null;
  size: CityViewSize;
  viewportW: number;
  viewportH: number;
  topInset: number;
}

/** Null while no city view is open — a closed view has no geometry to report. */
export function cityGridDebug(input: CityGridDebugInput): CityGridDebug | null {
  if (!input.open) return null;
  const { size, viewportW, viewportH, topInset } = input;
  const layout = cityLayout(size, viewportW, viewportH, topInset);
  return {
    open: true,
    settlementId: input.settlementId,
    size,
    viewport: { width: viewportW, height: viewportH },
    topInset,
    layout,
    cells: cellsInDrawOrder(size),
    cellToScreen(gx: number, gy: number) {
      const c = cellToScreen(gx, gy, layout.gridOrigin);
      return { x: layout.screenOrigin.x + c.x * layout.tileScale, y: layout.screenOrigin.y + c.y * layout.tileScale };
    },
    screenToCell(canvasX: number, canvasY: number) {
      return screenToGridCell(layout, size, viewportW, canvasX, canvasY);
    },
  };
}
