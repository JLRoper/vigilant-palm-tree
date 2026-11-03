// The settlement panel's Workforce row (2026-11-03). Its words are unchanged
// from before the build-crew rule except for the STALL COUNT appended last --
// the one global tell that a site somewhere has no builders and is therefore not
// advancing. Asserted here rather than in the panel, which is DOM plumbing.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { BuildingDef, SettlementState } from "@heroes/contracts";
import { makeSettlement } from "../../charter/_helpers";
import { workforceRowText } from "../../../src/screens/settlements/workforceRowText";

function site(gx: number, workers?: number, construction = true): BuildingDef {
  return {
    gx,
    gy: 0,
    kind: "bank",
    level: 1,
    style: "classic",
    ...(workers === undefined ? {} : { workers }),
    ...(construction ? { construction: { daysRemaining: 3 } } : {}),
  };
}

function settlement(buildings: BuildingDef[], population: number, districts?: SettlementState["districts"]): SettlementState {
  return {
    ...makeSettlement("s0", 0, 2, 2, { population, buildings }),
    ...(districts ? { districts } : {}),
  } as SettlementState;
}

test("the row is unchanged with nothing stalled -- and never says '0 sites stalled'", () => {
  assert.equal(
    workforceRowText(settlement([site(0, 1), site(2, 2)], 1500)),
    "3/5 assigned \u00b7 2 idle",
    "a staffed city reads exactly as it always did",
  );
});

test("one stalled site appends the singular suffix, last, after `over pool`", () => {
  assert.equal(
    workforceRowText(settlement([site(0, 0), site(2, 3)], 1200)),
    "3/4 assigned \u00b7 1 idle \u00b7 1 site stalled",
    "the site with nobody on it is named",
  );
  assert.equal(
    workforceRowText(settlement([site(0, 0), site(2, 4)], 300)),
    "4/1 assigned \u00b7 0 idle \u00b7 over pool \u00b7 1 site stalled",
    "an oversubscribed pool keeps its own marker, and the stall comes after it",
  );
});

test("several stalled sites pluralise on the count, and a district site counts too", () => {
  assert.equal(
    workforceRowText(
      settlement([site(0, 0), site(2, 0)], 1500, {
        "3,2": { q: 3, r: 2, citySpots: [], buildings: [site(0, 0)] },
      }),
    ),
    "0/5 assigned \u00b7 5 idle \u00b7 3 sites stalled",
    "main city and districts are one settlement-wide count",
  );
});

test("the legacy form carries the suffix too, and auto-crew sites are never stalled", () => {
  // A mixed settlement: an auto-crewed site (free full crew, makes progress) and
  // one explicit 0 (frozen). `hasLegacyStaffing` is true, so the row takes the
  // legacy form -- which must still name the stalled site.
  assert.equal(
    workforceRowText(settlement([site(0), site(2, 0)], 1500)),
    "auto crew \u00b7 1 bldgs (4 slots), pool 5 \u00b7 1 site stalled",
  );
  assert.equal(
    workforceRowText(settlement([site(0), site(2)], 1500)),
    "auto crew \u00b7 2 bldgs (8 slots), pool 5",
    "an untouched settlement's auto-crewed sites are working, so nothing is stalled",
  );
});
