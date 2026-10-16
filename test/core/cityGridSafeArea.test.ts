import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CITY_VIEW_MARGIN,
  TILE_D,
  cityLayout,
  computeCityScale,
  screenToGridCell,
  type CityViewSize,
} from "../../src/core/cityGrid";

// Safe-area pins (2026-10-05): the city grid must fit below the fixed toolbar
// overlay (topInset) with a visible CITY_VIEW_MARGIN gap on both edges at every
// size. Before the fix, the size<=10 bypass and unclamped centring slid 10x10
// and 15x15 grids under the toolbar (15x15@1280x800 hid 89.6px, 16.5%).

const TOOLBAR = 125;
const EPS = 1e-6;

function bbox(size: CityViewSize, viewportW: number, viewportH: number, topInset: number) {
  const layout = cityLayout(size, viewportW, viewportH, topInset);
  const top = layout.screenOrigin.y + (layout.gridOrigin.y - TILE_D / 2) * layout.tileScale;
  const bottom = top + size * TILE_D * layout.tileScale;
  return { layout, top, bottom };
}

test("matrix: every size fits below the toolbar inset and above the bottom margin", () => {
  const viewports: Array<[number, number]> = [
    [1280, 800],
    [1920, 1080],
    [1366, 768],
    [1280, 650],
    [900, 1000],
  ];
  for (const size of [5, 10, 15] as CityViewSize[]) {
    for (const [w, h] of viewports) {
      const { top, bottom } = bbox(size, w, h, TOOLBAR);
      assert.ok(
        top >= TOOLBAR + CITY_VIEW_MARGIN - EPS,
        `${size}x${size}@${w}x${h} top ${top} under the toolbar`,
      );
      assert.ok(
        bottom <= h - CITY_VIEW_MARGIN + EPS,
        `${size}x${size}@${w}x${h} bottom ${bottom} past the bottom margin`,
      );
    }
  }
});

test("5x5 geometry is byte-identical with and without the toolbar inset", () => {
  assert.deepEqual(cityLayout(5, 1280, 800, TOOLBAR), cityLayout(5, 1280, 800));
});

test("10x10 at 1280x800 clamps its apex to the toolbar + margin", () => {
  const { layout, top } = bbox(10, 1280, 800, TOOLBAR);
  assert.equal(layout.tileScale, 1);
  assert.ok(Math.abs(top - 137) < EPS, `top ${top}`);
});

test("15x15 at 1280x800 is width-constrained and clamps to top 137", () => {
  const { layout, top, bottom } = bbox(15, 1280, 800, TOOLBAR);
  assert.ok(Math.abs(layout.tileScale - 34 / 45) < EPS, `tileScale ${layout.tileScale}`);
  assert.ok(Math.abs(top - 137) < EPS, `top ${top}`);
  assert.ok(Math.abs(bottom - 681) < EPS, `bottom ${bottom}`);
});

test("15x15 at 1280x650 is height-constrained: scale 501/720, top 137, bottom 638", () => {
  const { layout, top, bottom } = bbox(15, 1280, 650, TOOLBAR);
  assert.ok(Math.abs(layout.tileScale - 501 / 720) < EPS, `tileScale ${layout.tileScale}`);
  assert.ok(Math.abs(top - 137) < EPS, `top ${top}`);
  assert.ok(Math.abs(bottom - 638) < EPS, `bottom ${bottom}`);
});

test("the size<=10 bypass is retired: computeCityScale shrinks 10x10 in a short viewport", () => {
  assert.ok(Math.abs(computeCityScale(10, 800, 600, TOOLBAR) - 0.7083333333333334) < EPS);
});

test("screenToGridCell maps through layout.screenOrigin.x, not viewportW/2", () => {
  const layout = cityLayout(5, 1280, 800);
  const shifted = {
    ...layout,
    screenOrigin: { ...layout.screenOrigin, x: layout.screenOrigin.x + 60 },
  };
  assert.notDeepEqual(screenToGridCell(shifted, 5, 1280, 642, 358.8), { gx: 2, gy: 2 });
  assert.deepEqual(screenToGridCell(shifted, 5, 1280, 702, 358.8), { gx: 2, gy: 2 });
});
