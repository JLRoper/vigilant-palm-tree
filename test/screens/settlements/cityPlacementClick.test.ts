// A click in the city grid places from the CLICK's own coordinates.
//
// Regression guard for behaviour main already ships (`8d382e3`, released
// 0.37.1): `BuildingPlacer.placeAt` snaps from the click with the very same
// computeSnap the mousemove path uses. Measured before that fix (round 2
// settlers playthrough, Block 6): with a building selected, a bare `click` on a
// free cell carrying no preceding `mousemove` placed nothing and sent NO request
// at all -- the ghost did not even move, because the placer's hover cell was only
// ever set by updateMouse. These cases now assert against main's own surface, so
// a future change to the click path cannot quietly reopen it.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { openPlacer, pointFor, restoreDom, VIEWPORT } from "./_cityPlacerHarness";

afterEach(() => {
  restoreDom();
});

test("click: a click with no preceding mousemove places from its own coordinates", () => {
  const { placer } = openPlacer();
  placer.selectBuilding("house");

  const click = pointFor(3, 3);
  const placed = placer.placeAt(click.x, click.y, VIEWPORT.w, VIEWPORT.h);

  assert.ok(placed, "the click must place");
  assert.equal(placed.gx, 3, "the placement must land on the clicked cell's x");
  assert.equal(placed.gy, 3, "the placement must land on the clicked cell's y");
  assert.equal(placer.buildings.length, 1);
});

test("click: the click's own cell wins over an earlier hover", () => {
  const { placer } = openPlacer();
  placer.selectBuilding("house");

  // An earlier mousemove left the placer snapped to (0, 1) ...
  const hover = pointFor(0, 1);
  placer.computeSnap(hover.x, hover.y, VIEWPORT.w, VIEWPORT.h);
  assert.equal(placer.hoverCell?.gx, 0);

  // ... and the click at (3, 3) must place THERE, not on the stale cell.
  const click = pointFor(3, 3);
  const placed = placer.placeAt(click.x, click.y, VIEWPORT.w, VIEWPORT.h);

  assert.ok(placed);
  assert.deepEqual({ gx: placed.gx, gy: placed.gy }, { gx: 3, gy: 3 });
});

test("click: the mousemove path still places (computeSnap then place)", () => {
  const { placer } = openPlacer();
  placer.selectBuilding("house");

  const hover = pointFor(1, 1);
  placer.computeSnap(hover.x, hover.y, VIEWPORT.w, VIEWPORT.h);
  assert.equal(placer.valid, true, "the hover must mark the cell buildable");

  const placed = placer.place();
  assert.ok(placed);
  assert.deepEqual({ gx: placed.gx, gy: placed.gy }, { gx: 1, gy: 1 });
});
