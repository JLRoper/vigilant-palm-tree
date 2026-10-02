import { test } from "node:test";
import assert from "node:assert/strict";
import { footprintCells, footprintLine, footprintSuffix } from "../../../src/screens/settlements/cityView/footprint";

// The user-facing footprint text. The 2026-10-01 warehouse change (1x1 -> 2x2
// at 500g/16w/12s) is the case that matters: a 2x2 building that no surface
// says so is a building the player mis-plans.

test("a 1x1 kind blocks a single cell and needs no label", () => {
  assert.deepEqual(footprintCells("house"), { w: 1, h: 1, cells: 1 });
  assert.equal(footprintLine("house"), "");
  assert.equal(footprintSuffix("house"), "");
});

test("the 2x2 warehouse states its footprint everywhere", () => {
  assert.deepEqual(footprintCells("warehouse"), { w: 2, h: 2, cells: 4 });
  assert.equal(footprintLine("warehouse"), "Takes 2\u00D72 tiles (4)");
  assert.equal(footprintSuffix("warehouse"), " (2\u00D72)");
});

test("a 1x2 kind reports the taller span, not the cell count alone", () => {
  assert.deepEqual(footprintCells("archeryRange"), { w: 1, h: 2, cells: 2 });
  assert.equal(footprintLine("archeryRange"), "Takes 1\u00D72 tiles (2)");
});

test("the level-2/3 1.5 footprint rounds up to the cells coversCell actually blocks", () => {
  // buildingRegistry's level override is a visual 1.5x1.5, but coversCell's
  // `gx < b.gx + 1.5` admits the next column too -- so the blocked span is 2x2.
  assert.deepEqual(footprintCells("granary", 1), { w: 1, h: 1, cells: 1 });
  assert.deepEqual(footprintCells("granary", 2), { w: 2, h: 2, cells: 4 });
  assert.deepEqual(footprintCells("granary", 3), { w: 2, h: 2, cells: 4 });
  assert.equal(footprintLine("granary", 2), "Takes 2\u00D72 tiles (4)");
});

test("the town hall and apartment are 2x2", () => {
  assert.equal(footprintSuffix("townHall"), " (2\u00D72)");
  assert.equal(footprintSuffix("apartment"), " (2\u00D72)");
});

test("the new bank and treasury kinds are single-cell", () => {
  assert.equal(footprintSuffix("bank"), "");
  assert.equal(footprintSuffix("treasury"), "");
});