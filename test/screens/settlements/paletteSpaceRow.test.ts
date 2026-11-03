// E4 (playthrough round 2b): the build palette must not OFFER what the grid
// cannot take. A level-1 settlement's 5x5 grid is 22/25 covered by the free
// starter set, so it has no free 2x2 anchor at all, and every 2x2 row
// (Farm Field, Apartment, Warehouse, the built Town Hall) was a live-looking
// offer whose only answer arrived after arming it and clicking -- a refusal
// that reads as "the game ignored me". The row now carries the rule
// (`buildEntryStatus`'s space check, fed the SAME occupancy the ghost uses)
// and is disabled.
//
// Driven through the real BuildingPlacer with the shared mock-DOM harness, so
// what is asserted is the row the player sees, not the pure function alone.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { buildStarterLayout } from "@heroes/engine";
import type { BuildingDef } from "@heroes/contracts";
import { buildRowButtons, openPlacer, restoreDom } from "./_cityPlacerHarness";

afterEach(() => {
  restoreDom();
});

/** A palette row by its label, which is the row's LAST text (the cost icons precede it). */
function exactRow(root: Parameters<typeof buildRowButtons>[0], label: string) {
  const rows = buildRowButtons(root);
  const row = rows.find((b) => b.textContent.endsWith(label));
  if (!row) throw new Error(`palette row "${label}" must exist; saw ${rows.map((b) => b.textContent).join(" | ")}`);
  return row;
}

const SPACE_RULE = /No free 2\u00D72 space in this city \u2014 every place it could stand is covered\. Raise the settlement's level for a bigger grid, or build it in a district\./;

test("E4: the level-1 starter city offers no 2x2 row, and each one says why", () => {
  // The real free starter set of a level-1 settlement: town hall 2x2, three
  // 2x2 farm fields, two houses, two woodcutter huts, a stone mine, a farmhouse.
  const starter: BuildingDef[] = buildStarterLayout({ size: 5, style: "pixel", farms: 3 });
  assert.equal(starter.length, 10, "fixture premise: the starter set fills the grid bar three cells");

  const { body } = openPlacer(starter, undefined, 1);
  for (const label of ["Farm Field (2\u00D72)", "Apartment (2\u00D72)", "Warehouse (2\u00D72)", "Town Hall (built) (2\u00D72)"]) {
    const row = exactRow(body, label);
    assert.equal(row.disabled, true, `${label}: a row the grid cannot take is not an offer`);
    assert.match(row.title, SPACE_RULE, `${label}: and it says which rule refused it`);
    assert.match(row.title, /Takes 2\u00D72 tiles \(4\)/, "the footprint line stays beside the space line");
  }

  // The three free cells are a single row, so the 1x1 kinds are still offered.
  for (const label of ["House", "Farmhouse"]) {
    const row = exactRow(body, label);
    assert.equal(row.disabled, false, `${label} fits one of the free cells`);
    assert.ok(!SPACE_RULE.test(row.title), `${label} says nothing about space`);
  }
});

test("E4: an empty grid still offers every row -- the rule is the grid, not a blanket ban", () => {
  // Level 3: this spec is about the SPACE rule, so it declares a settlement
  // level that admits every kind (the tier gate has its own spec,
  // paletteLevelGateRow.test.ts).
  const { body } = openPlacer([], undefined, 3);
  for (const label of ["Farm Field (2\u00D72)", "Warehouse (2\u00D72)", "House"]) {
    const row = exactRow(body, label);
    assert.equal(row.disabled, false, `${label} is placeable on an empty 5x5 grid`);
  }
});
