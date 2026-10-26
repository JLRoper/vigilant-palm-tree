// A refused city-grid placement STATES ITS REASON.
//
// Two halves, both on the palette notice (`data-testid="palette-notice"`),
// which is the surface main chose for a placement refusal (`8d382e3`):
//
//   1. the GEOMETRY refusals main already ships -- regression guards, asserted
//      against main's own `placementBlockReason` sentences; and
//   2. the CART's refusal, which main still swallowed: `confirmPlacement` popped
//      the staged building and returned false with no words anywhere, while the
//      ghost stayed green because the ghost is drawn from the geometry rule
//      alone. Measured on the round 2 settlers playthrough, Block 6: a click on
//      a free cell the treasury could not cover did nothing and said nothing
//      (playthrough finding 4, and the reason this card exists).

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { BuildingDef } from "@heroes/contracts";
import { openPlacer, paletteNotice, pointFor, restoreDom, RICH, VIEWPORT } from "./_cityPlacerHarness";

afterEach(() => {
  restoreDom();
});

test("refusal: an occupied cell explains itself and places nothing", () => {
  const occupied: BuildingDef[] = [{ gx: 1, gy: 1, kind: "farmhouse", level: 1, w: 1, h: 1 }];
  const { placer, body } = openPlacer(occupied);
  placer.selectBuilding("house");

  const p = pointFor(1, 1);
  assert.equal(placer.placeAt(p.x, p.y, VIEWPORT.w, VIEWPORT.h), null, "the occupied cell must refuse");
  assert.equal(placer.placementBlockReason(1, 1), "A building already stands there.");
  assert.equal(placer.canPlaceAt(1, 1), false, "canPlaceAt is the same rule as a boolean");
  assert.equal(paletteNotice(body), "A building already stands there.", "the palette states the rule that refused");
  assert.equal(placer.buildings.length, occupied.length, "a refused click stages nothing");
});

test("refusal: the reserved centre cell keeps its rule and says so", () => {
  const { placer, body } = openPlacer();
  placer.selectBuilding("house");

  const p = pointFor(2, 2);
  assert.equal(placer.canPlaceAt(2, 2), false);
  assert.equal(placer.placeAt(p.x, p.y, VIEWPORT.w, VIEWPORT.h), null);
  assert.equal(paletteNotice(body), "The center cell is reserved.");
});

test("refusal: a footprint that runs off the grid says so", () => {
  const { placer, body } = openPlacer();
  placer.selectBuilding("townHall"); // 2x2 at level 1

  const p = pointFor(4, 4);
  assert.equal(placer.canPlaceAt(4, 4), false);
  assert.equal(placer.placeAt(p.x, p.y, VIEWPORT.w, VIEWPORT.h), null);
  assert.equal(paletteNotice(body), "That footprint runs off the edge of the grid.");
});

test("refusal: a second town hall says so", () => {
  const { placer, body } = openPlacer([{ gx: 0, gy: 0, kind: "townHall", level: 1, w: 2, h: 2 }]);
  placer.selectBuilding("townHall");

  const p = pointFor(2, 0);
  assert.equal(placer.canPlaceAt(2, 0), false);
  assert.equal(placer.placeAt(p.x, p.y, VIEWPORT.w, VIEWPORT.h), null);
  assert.equal(paletteNotice(body), "This settlement already has a town hall.");
});

test("refusal: every refusing cell has a sentence and every accepting one places", () => {
  const occupied: BuildingDef[] = [{ gx: 1, gy: 1, kind: "farmhouse", level: 1, w: 1, h: 1 }];
  const { placer, body } = openPlacer(occupied);
  placer.selectBuilding("house");

  for (let gx = 0; gx < 5; gx++) {
    for (let gy = 0; gy < 5; gy++) {
      const accepted = placer.canPlaceAt(gx, gy);
      const p = pointFor(gx, gy);
      const placed = placer.placeAt(p.x, p.y, VIEWPORT.w, VIEWPORT.h);
      assert.equal(placed !== null, accepted, `cell (${gx},${gy}): placement and canPlaceAt must agree`);
      if (accepted) {
        assert.equal(paletteNotice(body), null, `cell (${gx},${gy}): a landed placement leaves no refusal line`);
        placer.removeAt(gx, gy);
      } else {
        assert.ok(placer.placementBlockReason(gx, gy), `cell (${gx},${gy}) must state its rule`);
        assert.equal(
          paletteNotice(body),
          placer.placementBlockReason(gx, gy),
          `cell (${gx},${gy}) must paint the rule that refused it`,
        );
      }
    }
  }
});

test("refusal: a placement the cart cannot cover states the shortfall", () => {
  // The row was affordable when the building was picked; the treasury moved under it.
  const { placer, body } = openPlacer([], 50);
  placer.selectBuilding("house"); // 100g
  assert.equal(placer.canPlaceAt(3, 3), true, "the geometry rule accepts the cell -- the ghost looks buildable");

  const p = pointFor(3, 3);
  assert.equal(placer.placeAt(p.x, p.y, VIEWPORT.w, VIEWPORT.h), null, "the cart cannot cover it");
  assert.equal(
    paletteNotice(body),
    "Not enough gold (need 100, have 50)",
    "the refusal reuses the palette's own vocabulary, not a second wording of it",
  );
  assert.equal(placer.buildings.length, 0, "an unaffordable placement stages nothing");
});

test("refusal: the confirm path states the same shortfall, not silence", () => {
  const { placer, body } = openPlacer([], 50);
  placer.selectBuilding("house");

  const p = pointFor(3, 3);
  placer.computeSnap(p.x, p.y, VIEWPORT.w, VIEWPORT.h);
  assert.equal(placer.valid, true);

  assert.equal(placer.confirmPlacement(), false, "the cart cannot cover the placement");
  assert.equal(paletteNotice(body), "Not enough gold (need 100, have 50)");
  assert.equal(placer.buildings.length, 0);
});

test("refusal: the shortfall line clears once the treasury can cover it again", () => {
  const { placer, body } = openPlacer([], 50);
  placer.selectBuilding("house");

  const p = pointFor(3, 3);
  assert.equal(placer.placeAt(p.x, p.y, VIEWPORT.w, VIEWPORT.h), null);
  assert.ok(paletteNotice(body), "the refusal is on screen");

  // The treasury refills (End Turn) with the city view still open: the snapshot
  // reaches the placer, and the cell the player already picked now lands.
  placer.setAffordability({ gold: RICH.gold, warehouse: { ...RICH.warehouse } });
  const placed = placer.placeAt(p.x, p.y, VIEWPORT.w, VIEWPORT.h);
  assert.ok(placed, "the same cell places once the cart can pay");
  assert.equal(paletteNotice(body), null, "a landed placement leaves no refusal line behind");
});
