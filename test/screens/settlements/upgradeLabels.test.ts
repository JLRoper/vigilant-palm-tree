import { test } from "node:test";
import assert from "node:assert/strict";
import {
  settlementUpgradeLabel,
  townHallUpgradeLabel,
} from "../../../src/screens/settlements/upgradeLabels";

// Ledger #10: the settlement panel's tier control and the town hall's own
// building control both read as a bare level — `Upgrade to L2` (5000g, TH L2)
// beside `L2: 1500g 15w 10s / 7d` — so a player reading the panel could not
// tell which upgrade the 5000g was for. These pin the INVARIANT (each control
// names its own subject, and neither is a bare level) rather than one literal
// string, so a later copy-paste that re-collides them fails here.

const COST = { gold: 1500, wood: 15, stone: 10, days: 7 };

test("ledger #10: the panel's tier control and the town hall's own control name their own subjects", () => {
  const panel = settlementUpgradeLabel(2, 5000);
  const hall = townHallUpgradeLabel(2, COST);

  assert.match(panel, /settlement/i, "the panel's control must name the SETTLEMENT it raises a tier");
  assert.match(hall, /town hall/i, "the town hall's control must name the BUILDING it raises a level");
  assert.notEqual(panel, hall, "the two controls must not share one sentence");
  assert.ok(panel.trim().length > 0 && hall.trim().length > 0, "both controls are named");

  // The discriminating half: neither is a bare level any more. `Upgrade to L2`
  // and `L2: …` are exactly the two strings that collided.
  assert.doesNotMatch(panel, /^Upgrade to L\d/, "the panel's control must not be a bare 'Upgrade to L2'");
  assert.doesNotMatch(hall, /^L\d/, "the town hall's line must not open with a bare level");
  assert.notEqual(panel.trim(), "Upgrade to L2");
  assert.notEqual(hall.trim(), "L2: 1500g 15w 10s / 7d");
});

test("ledger #10: the panel's wording carries its price only when it has one", () => {
  assert.equal(settlementUpgradeLabel(2), "Upgrade settlement to L2");
  assert.equal(settlementUpgradeLabel(3, 15000), "Upgrade settlement to L3 — 15000g");
  assert.equal(townHallUpgradeLabel(2, COST), "Town hall L2: 1500g 15w 10s / 7d");
});
