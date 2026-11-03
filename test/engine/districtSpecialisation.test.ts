import { test } from "node:test";
import assert from "node:assert/strict";
import type { BuildingDef, DistrictState } from "@heroes/contracts";
import {
  DISTRICT_CHAIN_MAX_EFFECT,
  DISTRICT_CHAIN_MIN_PRODUCERS,
  DISTRICT_CHAIN_MIN_SHARE,
  districtSpecialisation,
  districtSpecialisationLabel,
  districtSpecialisationScale,
} from "@heroes/engine";

// The derivation itself: what a district's specialisation IS, given only the
// buildings it persists. There is no stored district type anywhere in this
// module -- the answer is a pure function of `DistrictState.buildings`, which is
// exactly what migration 035 writes per row (`district_q` / `district_r`), so a
// district reloaded from the ledger derives the same answer it had in memory.

function building(kind: BuildingDef["kind"], gx: number, gy: number, extra: Partial<BuildingDef> = {}): BuildingDef {
  return { gx, gy, kind, level: 1, style: "pixel", ...extra };
}

function district(buildings: BuildingDef[], citySpots: DistrictState["citySpots"] = []): DistrictState {
  return { q: 3, r: 2, citySpots, buildings };
}

function near(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} should be ${expected}`);
}

const farms = [
  building("farmField", 0, 0),
  building("farmField", 2, 0),
  building("farmField", 0, 2),
  building("farmField", 2, 2),
];

test("four of four buildings on the food chain is full specialisation", () => {
  const spec = districtSpecialisation(district(farms));
  assert.ok(spec);
  assert.equal(spec.resource, "food");
  assert.equal(spec.producers, 4);
  assert.equal(spec.buildings, 4);
  assert.equal(spec.share, 1);
  near(spec.effect, DISTRICT_CHAIN_MAX_EFFECT);
});

test("the food chain spans farm fields, farmhouses and granaries -- the share counts all of them", () => {
  const spec = districtSpecialisation(
    district([
      building("farmField", 0, 0),
      building("farmhouse", 1, 0),
      building("granary", 2, 0),
      building("farmField", 0, 2),
    ]),
  );
  assert.ok(spec, "three kinds on one chain are one chain, not three");
  assert.equal(spec.resource, "food");
  assert.equal(spec.producers, 4);
});

test("a non-producer in the district dilutes the share and so shrinks the effect", () => {
  const spec = districtSpecialisation(district([...farms, building("house", 4, 4)]));
  assert.ok(spec);
  assert.equal(spec.share, 0.8);
  near(spec.effect, 0.125);
  near(spec.effect, (0.25 * (spec.share - DISTRICT_CHAIN_MIN_SHARE)) / (1 - DISTRICT_CHAIN_MIN_SHARE));
});

test("a house does not stop a district qualifying, but housing the whole grid does", () => {
  assert.ok(districtSpecialisation(district([...farms, building("house", 4, 4)])), "4 farms + 1 house qualifies");
  assert.equal(
    districtSpecialisation(
      district([...farms, building("house", 4, 4), building("house", 4, 3), building("house", 3, 4)]),
    ),
    null,
    "4 of 7 buildings is under the 60% share, so the district is mixed and pays nothing",
  );
});

test("a four-producer chain is not enough on its own -- the share must clear the threshold too", () => {
  assert.equal(districtSpecialisation(district(farms.slice(0, 3))), null, "three producers is one short of the bar");
  assert.equal(
    districtSpecialisation(
      district([...farms, building("house", 4, 4), building("house", 4, 3), building("house", 3, 4)]),
    ),
    null,
    "four producers, but 4 of 7 buildings is under the threshold",
  );
  const qualifying = district([...farms, building("stoneMine", 4, 0)]);
  const spec = districtSpecialisation(qualifying);
  assert.ok(spec, "4 of 5 clears both bars");
  assert.equal(spec.resource, "food", "four food still leads one stone");
  assert.equal(spec.producers, 4);
  assert.ok(spec.share > DISTRICT_CHAIN_MIN_SHARE);
});

test("under-construction buildings produce for nobody, on either side of the bar", () => {
  const unbuilt = { construction: { daysRemaining: 1 } };
  assert.equal(
    districtSpecialisation(district([...farms.slice(0, 3), building("farmField", 2, 2, unbuilt)])),
    null,
    "3 built farms + 1 site is three producers of four buildings: one short of the bar",
  );
  assert.equal(districtSpecialisation(district(farms))?.producers, 4, "once the site is up it is the fourth producer");
});

test("no buildings, or no producer at all, is never a specialisation", () => {
  assert.equal(districtSpecialisation(district([])), null);
  assert.equal(
    districtSpecialisation(district([building("house", 0, 0), building("market", 2, 0), building("smithy", 4, 0)])),
    null,
  );
});

test("the scale is exactly 1 for every resource when the district is not specialised", () => {
  const mixed = district([building("farmField", 0, 0), building("woodcutterHut", 2, 0), building("stoneMine", 4, 0)]);
  assert.equal(districtSpecialisation(mixed), null);
  for (const resource of ["food", "wood", "stone", "iron", "arcane", "gold"] as const) {
    assert.equal(districtSpecialisationScale(districtSpecialisation(mixed), resource), 1);
  }
});

test("the scale is paid on the chain and taken off the rest", () => {
  const spec = districtSpecialisation(district(farms));
  assert.ok(spec);
  assert.equal(districtSpecialisationScale(spec, "food"), 1.25);
  assert.equal(districtSpecialisationScale(spec, "stone"), 0.75);
  assert.equal(districtSpecialisationScale(spec, "gold"), 0.75);
});

test("a mine's chain follows the district's own spots, so the same kind can specialise two ways", () => {
  const ironSpot = (x: number, y: number) => ({ cell: { x, y }, resource: "iron" as const, vein: "v1" });
  const mine = building("mine", 0, 0);
  const spots = [ironSpot(0, 0), ironSpot(1, 1), ironSpot(1, 2), ironSpot(1, 3)];
  const fourMines = [mine, building("mine", 1, 1), building("mine", 1, 2), building("mine", 1, 3)];

  assert.equal(
    districtSpecialisation(district([mine, building("mine", 1, 1)], spots)),
    null,
    "two mines is still under the producer bar",
  );
  assert.equal(
    districtSpecialisation(district(fourMines, spots))?.resource,
    "iron",
    "the mines on iron spots chain to iron",
  );
  assert.equal(
    districtSpecialisation(district(fourMines))?.resource,
    "stone",
    "take the spots away and the same four mines chain to the stone default",
  );
});

test("the label states the share when it pays, and what is missing when it does not", () => {
  assert.match(districtSpecialisationLabel(district(farms)), /^Food district — 4 of 4 buildings on one chain: \+25% food/);
  assert.match(districtSpecialisationLabel(district([...farms, building("house", 4, 4)])), /\+12\.5% food/);
  assert.match(
    districtSpecialisationLabel(district(farms.slice(0, 3))),
    /No specialisation — 3 of 3 buildings on the food chain; 4 needed/,
  );
  assert.match(
    districtSpecialisationLabel(district([building("house", 0, 0)])),
    /No specialisation — no producer in this district/,
  );
  assert.match(
    districtSpecialisationLabel(district([building("house", 0, 0), building("farmField", 2, 2, { construction: { daysRemaining: 1 } })])),
    /No specialisation — this district's producers are still under construction/,
    "an unbuilt farm field is a site, not 'no producer'",
  );
});

test("the constants are the ones the spec describes", () => {
  assert.equal(DISTRICT_CHAIN_MIN_PRODUCERS, 4);
  assert.equal(DISTRICT_CHAIN_MIN_SHARE, 0.6);
  assert.equal(DISTRICT_CHAIN_MAX_EFFECT, 0.25);
});
