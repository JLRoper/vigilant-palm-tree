import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cityLayout,
  screenToGridCell,
  cellOrigin,
  cellToScreen,
  type CityViewSize,
} from "../../src/core/cityGrid";

// Regression pins for the city-view pointer→cell mapping (2026-10-05).
//
// Integer grid coords are the drawn diamonds' CENTERS, so a cell's pick region
// is the half-cell around its center. `screenToGridCell` floors the fractional
// grid coords with a +0.5 shift; before the fix the raw `Math.floor` put every
// pick region half a cell down (24 px at tileScale 1) — only the bottom of a
// diamond selected its own cell and the center selected the diagonal
// neighbour. Empirical reproduction: `.plans/20261005-0114_city-pointer-offset_5660.md`
// and `local/probe/cityPointerProbe.mjs`.

const VIEW_W = 1280;
const VIEW_H = 800;

test("layout numbers pinned for 1280x800 size 5", () => {
  const layout = cityLayout(5, VIEW_W, VIEW_H);
  assert.equal(layout.tileScale, 1);
  assert.equal(layout.gridOrigin.x, 2);
  assert.equal(layout.gridOrigin.y, 2);
  assert.equal(layout.screenOrigin.x, 640);
  assert.equal(layout.screenOrigin.y, 260.8);
});

test("cell (2,2) center at 1280x800 size 5 maps to itself", () => {
  const layout = cityLayout(5, VIEW_W, VIEW_H);
  // Drawn center: screenOrigin + cellToScreen(2,2) * tileScale = (642, 358.8).
  const c = cellToScreen(2, 2, cellOrigin(5));
  const sx = layout.screenOrigin.x + c.x * layout.tileScale;
  const sy = layout.screenOrigin.y + c.y * layout.tileScale;
  assert.deepEqual([sx, sy], [642, 358.8]);
  assert.deepEqual(screenToGridCell(layout, 5, VIEW_W, 642, 358.8), { gx: 2, gy: 2 });
});

test("15px above/left/right and 15px below the center all map to the intended cell", () => {
  const layout = cityLayout(5, VIEW_W, VIEW_H);
  // Old code pinned these to neighbours: (642,343.8) mapped to (1,1),
  // (662,358.8) to (2,1), (622,358.8) to (1,2), while (642,373.8) already
  // mapped to (2,2) — that asymmetry is the reported "point at the very
  // bottom" bug.
  assert.deepEqual(screenToGridCell(layout, 5, VIEW_W, 642, 343.8), { gx: 2, gy: 2 });
  assert.deepEqual(screenToGridCell(layout, 5, VIEW_W, 662, 358.8), { gx: 2, gy: 2 });
  assert.deepEqual(screenToGridCell(layout, 5, VIEW_W, 622, 358.8), { gx: 2, gy: 2 });
  assert.deepEqual(screenToGridCell(layout, 5, VIEW_W, 642, 373.8), { gx: 2, gy: 2 });
});

test("the full drawn diamond picks its own cell (center ± 23px)", () => {
  const layout = cityLayout(5, VIEW_W, VIEW_H);
  // The drawn diamond spans center ± 24px vertically and ± 48px horizontally;
  // every interior sample must resolve to the cell.
  assert.deepEqual(screenToGridCell(layout, 5, VIEW_W, 642, 358.8 - 23), { gx: 2, gy: 2 });
  assert.deepEqual(screenToGridCell(layout, 5, VIEW_W, 642, 358.8 + 23), { gx: 2, gy: 2 });
  assert.deepEqual(screenToGridCell(layout, 5, VIEW_W, 642 - 40, 358.8), { gx: 2, gy: 2 });
  assert.deepEqual(screenToGridCell(layout, 5, VIEW_W, 642 + 40, 358.8), { gx: 2, gy: 2 });
  // Diagonal quadrant of the diamond, 20px right / 10px down from center.
  assert.deepEqual(screenToGridCell(layout, 5, VIEW_W, 662, 368.8), { gx: 2, gy: 2 });
});

test("points outside the grid return null", () => {
  const layout = cityLayout(5, VIEW_W, VIEW_H);
  assert.equal(screenToGridCell(layout, 5, VIEW_W, 642, 100), null);
  assert.equal(screenToGridCell(layout, 5, VIEW_W, 642, 700), null);
  assert.equal(screenToGridCell(layout, 5, VIEW_W, 100, 358.8), null);
  assert.equal(screenToGridCell(layout, 5, VIEW_W, 1200, 358.8), null);
});

test("all cell centers round-trip for sizes 5, 10 and 15 at 1280x800", () => {
  for (const size of [5, 10, 15] as CityViewSize[]) {
    const layout = cityLayout(size, VIEW_W, VIEW_H);
    const origin = cellOrigin(size);
    for (let gx = 0; gx < size; gx++) {
      for (let gy = 0; gy < size; gy++) {
        const c = cellToScreen(gx, gy, origin);
        const sx = layout.screenOrigin.x + c.x * layout.tileScale;
        const sy = layout.screenOrigin.y + c.y * layout.tileScale;
        assert.deepEqual(
          screenToGridCell(layout, size, VIEW_W, sx, sy),
          { gx, gy },
          `round-trip ${size}x${size} (${gx},${gy}) at (${sx},${sy})`,
        );
      }
    }
  }
});
