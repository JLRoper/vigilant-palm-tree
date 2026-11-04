// The construction site's own menu line (2026-11-03), asserted directly: the
// menu itself is DOM+panel plumbing, so the sentence is a pure function
// (`siteStatus`) and this is where its exact words live. The rule behind it is
// engine-side -- a site with no builders makes no progress at all, and the crew
// ceiling on a site is 4 whatever the kind -- so the strings below are the
// contract between the engine and what the player reads.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { BuildingDef } from "@heroes/contracts";
import { CONSTRUCTION_MAX_BUILDERS } from "@heroes/engine";
import { siteStatus } from "../../../src/screens/settlements/cityView/siteStatus";

function site(kind: BuildingDef["kind"], workers?: number, days = 4): BuildingDef {
  return {
    gx: 0,
    gy: 0,
    kind,
    level: 1,
    style: "classic",
    ...(workers === undefined ? {} : { workers }),
    construction: { daysRemaining: days },
  };
}

test("a stalled site says so, in words, and says the days are not moving", () => {
  const status = siteStatus(site("bank", 0), 4);
  assert.equal(status.text, "Under construction \u2014 stalled: no builders \u00b7 4 days remaining");
  assert.equal(status.builders, 0);
  assert.equal(status.rate, "0.00");
});

test("a crewed site names the rate and the crew against the construction ceiling", () => {
  // bank's own cap is 2; while it is being built it takes up to 4, and the
  // player must be able to read that the 3rd builder is a 3rd builder.
  const three = siteStatus(site("bank", 3), 4);
  assert.equal(three.text, "Under construction \u2014 1.67\u00d7 (3 of 4 builders) \u00b7 4 days remaining");
  assert.equal(three.builders, 3);
  assert.equal(three.rate, "1.67");
  assert.equal(CONSTRUCTION_MAX_BUILDERS, 4, "the ceiling the sentence prints");

  // A full crew reaches the top of the curve, which is today's full-crew rate.
  const full = siteStatus(site("bank", 4), 4);
  assert.equal(full.text, "Under construction \u2014 2.00\u00d7 (4 of 4 builders) \u00b7 4 days remaining");
  assert.equal(full.rate, "2.00");

  // One builder is the baseline every `buildDays` number is measured in.
  const one = siteStatus(site("bank", 1), 2);
  assert.equal(one.text, "Under construction \u2014 1.00\u00d7 (1 of 4 builders) \u00b7 2 days remaining");
});

test("a house SITE reads 4 builders even though a finished house holds 1", () => {
  assert.equal(
    siteStatus(site("house", 4), 2).text,
    "Under construction \u2014 2.00\u00d7 (4 of 4 builders) \u00b7 2 days remaining",
    "the construction ceiling is kind-blind",
  );
  const finished: BuildingDef = { gx: 0, gy: 0, kind: "house", level: 1, style: "classic", workers: 1 };
  assert.equal(siteStatus(finished, 1).builders, 1, "and the ceiling falls back to the kind's cap when it is not a site");
});

test("the auto crew reads as a full crew, never as one builder", () => {
  const auto = siteStatus(site("bank"), 6);
  assert.equal(auto.builders, 4, "an untouched legacy site is crewed by the full free crew");
  assert.equal(auto.text, "Under construction \u2014 2.00\u00d7 (4 of 4 builders) \u00b7 6 days remaining");
});

test("the day word keeps the menu's existing singular rule and its raw fractions", () => {
  assert.equal(siteStatus(site("bank", 1), 1).text, "Under construction \u2014 1.00\u00d7 (1 of 4 builders) \u00b7 1 day remaining");
  assert.equal(
    siteStatus(site("bank", 2), 2.6).text,
    "Under construction \u2014 1.33\u00d7 (2 of 4 builders) \u00b7 2.6 days remaining",
    "a fractional timer prints raw, exactly as it did before the crew was named",
  );
});
