import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRate, buildStarterLayout, CONSTRUCTION_MAX_BUILDERS } from "@heroes/engine";
import {
  buildConfirmStatus,
  buildEntryStatus,
} from "../../../src/screens/settlements/cityView/buildEntryStatus";
import type { BuildEntryAffordability } from "../../../src/screens/settlements/cityView/buildEntryStatus";

const FULL: BuildEntryAffordability = {
  gold: 500,
  warehouse: { wood: 20, stone: 15, iron: 10, arcane: 5 },
};

// E5 (playthrough round 2b): every row that is not instant carries its build
// time AND the fact that its upkeep is charged while it builds, in the row's
// own tooltip. `days` comes from the registry (`buildingBuildDays`), which is
// why each expectation below names its kind's own number. Since 2026-11-03 the
// line also prices the CREW: `buildDays` is the number of ticks at ONE builder,
// the top of the crew curve is stated, and so is the stall. The rate and the
// ceiling are read from the engine's own constants here too, so the sentence and
// the mechanic cannot drift apart.
function buildTime(days: number): string {
  return (
    `Build time: ${days} day${days === 1 ? "" : "s"} at 1 builder, up to ${buildRate(CONSTRUCTION_MAX_BUILDERS).toFixed(2)}\u00d7 with ${CONSTRUCTION_MAX_BUILDERS} \u2014 its upkeep is paid while it is under ` +
    `construction, it produces nothing until it is finished, and a site with no builders makes no progress`
  );
}

const NONE: BuildEntryAffordability = {
  gold: 0,
  warehouse: { wood: 0, stone: 0, iron: 0, arcane: 0 },
};

test("affordable entry is enabled with its own lines as its tooltip", () => {
  const status = buildEntryStatus({ kind: "house", affordability: FULL });
  assert.equal(status.disabled, false);
  assert.deepEqual(status.reasons, [buildTime(2), "Upkeep: 2 wood per turn"]);
  assert.equal(status.title, `${buildTime(2)}\nUpkeep: 2 wood per turn`);
});

test("a zero-upkeep kind produces only its footprint and build-time lines as tooltip when affordable", () => {
  const status = buildEntryStatus({ kind: "farmField", affordability: FULL });
  assert.equal(status.disabled, false);
  assert.deepEqual(status.reasons, ["Takes 2\u00D72 tiles (4)", buildTime(2)]);
  assert.equal(status.title, `Takes 2\u00D72 tiles (4)\n${buildTime(2)}`);
});

test("a 1x1 kind adds no footprint line to the tooltip", () => {
  const status = buildEntryStatus({ kind: "house", affordability: FULL });
  assert.equal(status.disabled, false);
  assert.deepEqual(status.reasons, [buildTime(2), "Upkeep: 2 wood per turn"]);
  assert.equal(status.reasons.some((r) => r.includes("tiles")), false);
});

test("the 2x2 warehouse states its footprint (2026-10-01: it used to be 1x1)", () => {
  const status = buildEntryStatus({ kind: "warehouse", affordability: FULL });
  assert.equal(status.disabled, false);
  assert.deepEqual(status.reasons, ["Takes 2\u00D72 tiles (4)", buildTime(3), "Upkeep: 1 wood, 1 stone per turn"]);
});

test("gold shortfall names the needed and available amounts", () => {
  const status = buildEntryStatus({
    kind: "house",
    affordability: { gold: 50, warehouse: { wood: 20, stone: 15, iron: 10, arcane: 5 } },
  });
  assert.equal(status.disabled, true);
  assert.deepEqual(status.reasons, [
    "Not enough gold (need 300, have 50)",
    buildTime(2),
    "Upkeep: 2 wood per turn",
  ]);
});

test("wood shortfall blocks the entry", () => {
  const status = buildEntryStatus({
    kind: "house",
    affordability: { gold: 500, warehouse: { wood: 4, stone: 15, iron: 10, arcane: 5 } },
  });
  assert.equal(status.disabled, true);
  assert.deepEqual(status.reasons, [
    "Not enough wood (need 5, have 4)",
    buildTime(2),
    "Upkeep: 2 wood per turn",
  ]);
});

test("stone shortfall blocks the entry", () => {
  const status = buildEntryStatus({
    kind: "tower",
    affordability: { gold: 500, warehouse: { wood: 20, stone: 4, iron: 10, arcane: 5 } },
  });
  assert.equal(status.disabled, true);
  assert.deepEqual(status.reasons, [
    "Not enough stone (need 5, have 4)",
    buildTime(4),
    "Upkeep: 1 wood, 1 stone per turn",
  ]);
});

test("arcane shortfall blocks the entry", () => {
  const status = buildEntryStatus({
    kind: "mageGuild",
    affordability: { gold: 500, warehouse: { wood: 20, stone: 15, iron: 10, arcane: 1 } },
  });
  assert.equal(status.disabled, true);
  assert.deepEqual(status.reasons, [
    "Not enough arcane (need 2, have 1)",
    buildTime(6),
    "Upkeep: 1 wood, 1 stone per turn",
  ]);
});

test("multiple shortfalls appear in gold, wood, stone, arcane order with upkeep last", () => {
  const status = buildEntryStatus({ kind: "mageGuild", affordability: NONE });
  assert.equal(status.disabled, true);
  assert.deepEqual(status.reasons, [
    "Not enough gold (need 400, have 0)",
    "Not enough wood (need 5, have 0)",
    "Not enough stone (need 8, have 0)",
    "Not enough arcane (need 2, have 0)",
    buildTime(6),
    "Upkeep: 1 wood, 1 stone per turn",
  ]);
});

test("hasTownHall disables an otherwise affordable town hall with its own reason", () => {
  const status = buildEntryStatus({ kind: "townHall", affordability: FULL, hasTownHall: true });
  assert.equal(status.disabled, true);
  assert.deepEqual(status.reasons, [
    "A town hall already exists in this settlement",
    "Takes 2\u00D72 tiles (4)",
    "Upkeep: 3 wood, 2 stone per turn",
  ]);
});

test("town hall is enabled when none exists yet", () => {
  const status = buildEntryStatus({ kind: "townHall", affordability: FULL, hasTownHall: false });
  assert.equal(status.disabled, false);
  assert.deepEqual(status.reasons, ["Takes 2\u00D72 tiles (4)", "Upkeep: 3 wood, 2 stone per turn"]);
});

test("null affordability is affordable with no shortfall reasons", () => {
  const status = buildEntryStatus({ kind: "house", affordability: null, hasTownHall: true });
  assert.equal(status.disabled, true);
  assert.deepEqual(status.reasons, [
    "A town hall already exists in this settlement",
    buildTime(2),
    "Upkeep: 2 wood per turn",
  ]);
  const plain = buildEntryStatus({ kind: "house", affordability: null });
  assert.equal(plain.disabled, false);
  assert.deepEqual(plain.reasons, [buildTime(2), "Upkeep: 2 wood per turn"]);
});

test("confirm status is ok when the net cart is fully covered", () => {
  const status = buildConfirmStatus({
    net: { gold: 250, wood: 6 },
    charged: {},
    affordability: FULL,
  });
  assert.equal(status.ok, true);
  assert.deepEqual(status.reasons, []);
  assert.equal(status.title, "");
});

test("confirm status applies the charged offset to the gold need", () => {
  const status = buildConfirmStatus({
    net: { gold: 300 },
    charged: { gold: 100 },
    affordability: { gold: 150, warehouse: { wood: 20, stone: 15, iron: 10, arcane: 5 } },
  });
  assert.equal(status.ok, false);
  assert.deepEqual(status.reasons, ["Not enough gold (need 200, have 150)"]);
  assert.equal(status.title, "Not enough gold (need 200, have 150)");
});

test("confirm status reports warehouse resource shortfalls", () => {
  const status = buildConfirmStatus({
    net: { wood: 8, iron: 3 },
    charged: {},
    affordability: { gold: 500, warehouse: { wood: 5, stone: 15, iron: 1, arcane: 5 } },
  });
  assert.equal(status.ok, false);
  assert.deepEqual(status.reasons, [
    "Not enough wood (need 8, have 5)",
    "Not enough iron (need 3, have 1)",
  ]);
});

test("confirm status lists shortfalls in gold, wood, stone, iron, arcane order", () => {
  const status = buildConfirmStatus({
    net: { gold: 1, wood: 1, stone: 1, iron: 1, arcane: 1 },
    charged: {},
    affordability: NONE,
  });
  assert.deepEqual(status.reasons, [
    "Not enough gold (need 1, have 0)",
    "Not enough wood (need 1, have 0)",
    "Not enough stone (need 1, have 0)",
    "Not enough iron (need 1, have 0)",
    "Not enough arcane (need 1, have 0)",
  ]);
});

test("confirm status blocks on a plain gold cost", () => {
  const status = buildConfirmStatus({
    net: { gold: 300 },
    charged: {},
    affordability: { gold: 150, warehouse: { wood: 20, stone: 15, iron: 10, arcane: 5 } },
  });
  assert.equal(status.ok, false);
  assert.deepEqual(status.reasons, ["Not enough gold (need 300, have 150)"]);
});

test("confirm status never blocks on refunds (negative net entries)", () => {
  const status = buildConfirmStatus({
    net: { gold: -300, wood: -5 },
    charged: {},
    affordability: NONE,
  });
  assert.equal(status.ok, true);
  assert.deepEqual(status.reasons, []);
});

test("confirm status with null affordability is always ok", () => {
  const status = buildConfirmStatus({ net: { gold: 9999 }, charged: {}, affordability: null });
  assert.equal(status.ok, true);
  assert.deepEqual(status.reasons, []);
});

// ── E4 (playthrough round 2b): the grid may have no room for the footprint ──
// The level-1 starter city covers 22 of its 25 cells and leaves a single row
// free, so it has NO free 2x2 anchor: every 2x2 palette row was an offer the
// grid could not accept, with the explanation arriving only after a click.

test("E4: a footprint with no free anchor on the grid is refused, in words", () => {
  const starter = buildStarterLayout({ size: 5, style: "pixel", farms: 3 });
  const status = buildEntryStatus({ kind: "farmField", affordability: FULL, space: { size: 5, buildings: starter } });
  assert.equal(status.disabled, true, "no free 2x2 anchor: the row is not an offer");
  assert.deepEqual(status.reasons, [
    "No free 2\u00D72 space in this city \u2014 every place it could stand is covered. " +
      "Raise the settlement's level for a bigger grid, or build it in a district.",
    "Takes 2\u00D72 tiles (4)",
    buildTime(2),
  ]);
  // The three cells the starter set leaves free are a single row, so the 1x1
  // kinds are genuinely placeable and keep their rows.
  assert.equal(
    buildEntryStatus({ kind: "house", affordability: FULL, space: { size: 5, buildings: starter } }).disabled,
    false,
  );
});

test("E4: the same row is placeable on a bigger grid -- the rule reads the grid it is handed", () => {
  const starter = buildStarterLayout({ size: 5, style: "pixel", farms: 3 });
  const big = buildEntryStatus({ kind: "warehouse", affordability: FULL, space: { size: 10, buildings: starter } });
  assert.equal(big.disabled, false);
  assert.deepEqual(big.reasons, ["Takes 2\u00D72 tiles (4)", buildTime(3), "Upkeep: 1 wood, 1 stone per turn"]);
});

test("E4: the occupancy the rule reads is the one on the palette's own grid", () => {
  // The cart is a shop: a staged placement (and a destroy) moves the grid the
  // rows are checked against, so the refusal has to follow it.
  const starter = buildStarterLayout({ size: 5, style: "pixel", farms: 3 });
  const stillFull = buildEntryStatus({
    kind: "apartment",
    affordability: FULL,
    space: { size: 5, buildings: [...starter, { gx: 2, gy: 4, kind: "house", level: 1 }] },
  });
  assert.equal(stillFull.disabled, true, "staging a 1x1 in a free cell does not open a 2x2 anchor");
  assert.match(stillFull.title, /No free 2\u00D72 space in this city/);

  // The harvest from the E4 measurement: the anchor the (0,0) 2x2 farm field
  // holds is the one a cleared cell set gives back.
  const freed = starter.filter((b) => !(b.gx === 0 && b.gy === 0));
  const reopened = buildEntryStatus({ kind: "apartment", affordability: FULL, space: { size: 5, buildings: freed } });
  assert.equal(reopened.disabled, false, "clearing that farm field opens the anchor it held");
});

test("E4: no grid given, no space claim -- the rule never guesses", () => {
  const bare = buildEntryStatus({ kind: "farmField", affordability: FULL });
  assert.equal(bare.reasons.some((r) => /No free/.test(r)), false);
  assert.deepEqual(bare.reasons, ["Takes 2\u00D72 tiles (4)", buildTime(2)]);
});

// ── E5 (playthrough round 2b): the build time, and what the wait costs ──

test("E5: the build-time line sits between the footprint and the upkeep, and a 0-day kind has none", () => {
  const warehouse = buildEntryStatus({ kind: "warehouse", affordability: FULL });
  assert.deepEqual(warehouse.reasons, [
    "Takes 2\u00D72 tiles (4)",
    buildTime(3),
    "Upkeep: 1 wood, 1 stone per turn",
  ]);
  assert.equal(
    warehouse.reasons.findIndex((r) => r.startsWith("Build time:")),
    1,
    "what it takes, how long it takes, what it costs per turn",
  );
  const hall = buildEntryStatus({ kind: "townHall", affordability: FULL });
  assert.equal(
    hall.reasons.some((r) => r.startsWith("Build time:")),
    false,
    "the town hall is the registry's only 0-day kind: it has no wait to state",
  );
});
