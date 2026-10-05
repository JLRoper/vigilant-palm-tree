import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CITY_GRID_PAD,
  DESIGN_BOX_INSET,
  cityGridRect,
  collectPanelRects,
  resolveDesignBoxPlacement,
} from "../../../src/screens/settlements/cityView/panelRects";
import { cityLayout } from "../../../src/core/cityGrid";
import type { PanelRect } from "../../../src/screens/shared/panelPlacement";

const VIEWPORT = { width: 1920, height: 1080 };
const BOX_W = 110;
const BOX_H = 90;
const MIN_TOP = 125;

function assertClose(actual: number, expected: number, message: string): void {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: expected ${expected}, got ${actual}`);
}

test("an unobstructed design box sits at the bottom-left inset anchor", () => {
  assert.deepEqual(
    resolveDesignBoxPlacement(BOX_W, BOX_H, [], VIEWPORT, MIN_TOP),
    { x: DESIGN_BOX_INSET, y: 1080 - 24 - BOX_H },
    "resolvePanelPlacement's 24px viewport margin clamps the 12px bottom inset",
  );
});

test("a panel overlapping the bottom-left anchor shifts the box right past it", () => {
  const settlementPanel: PanelRect = { x: DESIGN_BOX_INSET, y: 966, w: BOX_W, h: BOX_H };
  assert.deepEqual(
    resolveDesignBoxPlacement(BOX_W, BOX_H, [settlementPanel], VIEWPORT, MIN_TOP),
    { x: DESIGN_BOX_INSET + BOX_W + 12, y: 966 },
    "one box-width plus gap to the right, same row",
  );
});

test("a fully occupied bottom row moves the box one box-height plus gap upward", () => {
  const maxX = 1920 - 24 - BOX_W;
  const occupied: PanelRect[] = [];
  for (let x = DESIGN_BOX_INSET; x <= maxX; x += BOX_W + 12) {
    occupied.push({ x, y: 966, w: BOX_W, h: BOX_H });
  }
  assert.deepEqual(
    resolveDesignBoxPlacement(BOX_W, BOX_H, occupied, VIEWPORT, MIN_TOP),
    { x: DESIGN_BOX_INSET, y: 966 - BOX_H - 12 },
    "back at the original column, one step up",
  );
});

test("a short viewport clamps the desired bottom anchor up to minTop", () => {
  assert.deepEqual(
    resolveDesignBoxPlacement(BOX_W, 200, [], { width: 800, height: 300 }, MIN_TOP),
    { x: DESIGN_BOX_INSET, y: MIN_TOP },
    "desired y 300-12-200=88 clamps to minTop 125",
  );
});

test("collectPanelRects drops null entries and tolerates a missing provider", () => {
  const rect: PanelRect = { x: 5, y: 6, w: 7, h: 8 };
  const provider = (): Array<PanelRect | null> => [null, rect, null];
  assert.deepEqual(collectPanelRects(provider), [rect]);
  assert.deepEqual(collectPanelRects(undefined), []);
});

test("cityGridRect bounds a 5x5 grid at 1280x800", () => {
  const rect = cityGridRect(5, 1280, 800, 0);
  assert.equal(rect.x, 402, "grid left edge");
  assert.equal(rect.w, 480, "grid width");
  assertClose(rect.y, 238.8, "grid top edge");
  assertClose(rect.h, 240, "grid height");
});

test("cityGridRect bounds a 10x10 grid at 1280x800", () => {
  const rect = cityGridRect(10, 1280, 800, 0);
  assert.equal(rect.w, 960, "grid width");
  assert.equal(rect.h, 480, "grid height");
  assertClose(rect.x, 164.5, "grid left edge");
  assertClose(rect.y, 78.1, "grid top edge");
});

test("cityGridRect scales a 15x15 grid down to fit the viewport", () => {
  const rect = cityGridRect(15, 1280, 800, 0);
  assert.ok(cityLayout(15, 1280, 800).tileScale < 1, "15x15 is width-constrained at 1280x800");
  assertClose(rect.w, 1088, "grid width");
  assertClose(rect.h, 544, "grid height");
});

test("cityGridRect applies pad on all four sides and defaults to CITY_GRID_PAD", () => {
  const bare = cityGridRect(5, 1280, 800, 0);
  const padded = cityGridRect(5, 1280, 800, CITY_GRID_PAD);
  assertClose(padded.x, bare.x - CITY_GRID_PAD, "left pad");
  assertClose(padded.y, bare.y - CITY_GRID_PAD, "top pad");
  assertClose(padded.w, bare.w + CITY_GRID_PAD * 2, "width pad");
  assertClose(padded.h, bare.h + CITY_GRID_PAD * 2, "height pad");
  assert.deepEqual(cityGridRect(5, 1280, 800), padded, "default pad is CITY_GRID_PAD");
});
