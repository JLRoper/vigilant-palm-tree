import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvePanelPlacement, rectsOverlap, type PanelRect } from "../../../src/screens/shared/panelPlacement";

const VIEWPORT = { width: 1920, height: 1080 };
const PALETTE: PanelRect = { x: 100, y: 100, w: 240, h: 480 };

test("rectsOverlap detects intersection and separation on both axes", () => {
  const a: PanelRect = { x: 0, y: 0, w: 100, h: 100 };
  assert.equal(rectsOverlap(a, { x: 50, y: 50, w: 100, h: 100 }), true, "corner intersection");
  assert.equal(rectsOverlap(a, { x: 99, y: 99, w: 100, h: 100 }), true, "single-pixel overlap");
  assert.equal(rectsOverlap(a, { x: 100, y: 0, w: 100, h: 100 }), false, "edge-touching is not overlap");
  assert.equal(rectsOverlap(a, { x: 0, y: 100, w: 100, h: 100 }), false, "edge-touching vertically is not overlap");
  assert.equal(rectsOverlap(a, { x: 200, y: 0, w: 100, h: 100 }), false, "separated horizontally");
});

test("a desired slot free of overlaps is returned as-is", () => {
  const occupied: PanelRect[] = [{ x: 0, y: 0, w: 50, h: 50 }];
  assert.deepEqual(
    resolvePanelPlacement(PALETTE, occupied, VIEWPORT, 20),
    { x: 100, y: 100 },
  );
});

test("an overlap shifts the panel right by exactly one panel width plus gap", () => {
  const occupied: PanelRect[] = [{ x: 100, y: 100, w: 240, h: 480 }];
  assert.deepEqual(
    resolvePanelPlacement(PALETTE, occupied, VIEWPORT, 20),
    { x: 352, y: 100 },
    "100 + 240 (w) + 12 (gap) = 352, same row",
  );
});

test("when the right edge is exhausted the search moves upward in h+12 steps", () => {
  const viewport = { width: 800, height: 2000 };
  const desired: PanelRect = { x: 0, y: 1200, w: 240, h: 480 };
  const occupied: PanelRect[] = [
    { x: 0, y: 1200, w: 240, h: 480 },
    { x: 252, y: 1200, w: 240, h: 480 },
    { x: 504, y: 1200, w: 240, h: 480 },
  ];
  assert.deepEqual(
    resolvePanelPlacement(desired, occupied, viewport, 0),
    { x: 0, y: 708 },
    "1200 - 480 (h) - 12 (gap) = 708, back at the original column",
  );
});

test("viewport clamping and minTop are respected even against distant occupants", () => {
  const occupied: PanelRect[] = [{ x: 0, y: 0, w: 10, h: 10 }];
  assert.deepEqual(
    resolvePanelPlacement({ x: 5000, y: -100, w: 240, h: 480 }, occupied, { width: 800, height: 600 }, 20),
    { x: 536, y: 20 },
    "x clamps to 800-24-240, y clamps up to minTop",
  );
  assert.deepEqual(
    resolvePanelPlacement({ x: 5000, y: 5000, w: 240, h: 480 }, occupied, { width: 800, height: 600 }, 20),
    { x: 536, y: 96 },
    "y clamps down to max(minTop, 600-24-480)",
  );
  assert.deepEqual(
    resolvePanelPlacement({ x: -40, y: 5, w: 240, h: 480 }, occupied, { width: 800, height: 600 }, 20),
    { x: 0, y: 20 },
    "left edge clamps to 0, top clamps to minTop",
  );
});

test("an empty occupied list returns the clamped desired position", () => {
  assert.deepEqual(resolvePanelPlacement(PALETTE, [], VIEWPORT, 20), { x: 100, y: 100 });
  assert.deepEqual(
    resolvePanelPlacement({ x: 800, y: 1000, w: 240, h: 480 }, [], { width: 800, height: 600 }, 20),
    { x: 536, y: 96 },
  );
});

test("every fallback candidate still lands inside the clamped viewport", () => {
  const viewport = { width: 700, height: 700 };
  const desired: PanelRect = { x: 0, y: 200, w: 300, h: 400 };
  const occupied: PanelRect[] = [];
  const maxX = 700 - 24 - 300;
  for (let x = 0; x <= maxX; x += 312) {
    occupied.push({ x, y: 200, w: 300, h: 400 });
  }
  const result = resolvePanelPlacement(desired, occupied, viewport, 20);
  assert.ok(result.x >= 0 && result.x <= maxX, "returned x stays within the clamped range");
  assert.ok(result.y >= 20 && result.y <= 700 - 24 - 400, "returned y stays within the clamped range");
});
