import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DESIGN_BOX_INSET,
  collectPanelRects,
  resolveDesignBoxPlacement,
} from "../../../src/screens/settlements/cityView/panelRects";
import type { PanelRect } from "../../../src/screens/shared/panelPlacement";

const VIEWPORT = { width: 1920, height: 1080 };
const BOX_W = 110;
const BOX_H = 90;
const MIN_TOP = 125;

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
