import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildConfirmStatus,
  buildEntryStatus,
} from "../../../src/screens/settlements/cityView/buildEntryStatus";
import type { BuildEntryAffordability } from "../../../src/screens/settlements/cityView/buildEntryStatus";

const FULL: BuildEntryAffordability = {
  gold: 500,
  warehouse: { wood: 20, stone: 15, iron: 10, arcane: 5 },
};

const NONE: BuildEntryAffordability = {
  gold: 0,
  warehouse: { wood: 0, stone: 0, iron: 0, arcane: 0 },
};

test("affordable entry is enabled with only the upkeep line as its tooltip", () => {
  const status = buildEntryStatus({ kind: "house", affordability: FULL });
  assert.equal(status.disabled, false);
  assert.deepEqual(status.reasons, ["Upkeep: 1 wood per turn"]);
  assert.equal(status.title, "Upkeep: 1 wood per turn");
});

test("a zero-upkeep kind produces an empty tooltip when affordable", () => {
  const status = buildEntryStatus({ kind: "farmField", affordability: FULL });
  assert.equal(status.disabled, false);
  assert.deepEqual(status.reasons, []);
  assert.equal(status.title, "");
});

test("gold shortfall names the needed and available amounts", () => {
  const status = buildEntryStatus({
    kind: "house",
    affordability: { gold: 50, warehouse: { wood: 20, stone: 15, iron: 10, arcane: 5 } },
  });
  assert.equal(status.disabled, true);
  assert.deepEqual(status.reasons, [
    "Not enough gold (need 100, have 50)",
    "Upkeep: 1 wood per turn",
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
    "Upkeep: 1 wood per turn",
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
    "Upkeep: 1 wood, 1 stone per turn",
  ]);
});

test("hasTownHall disables an otherwise affordable town hall with its own reason", () => {
  const status = buildEntryStatus({ kind: "townHall", affordability: FULL, hasTownHall: true });
  assert.equal(status.disabled, true);
  assert.deepEqual(status.reasons, [
    "A town hall already exists in this settlement",
    "Upkeep: 3 wood, 2 stone per turn",
  ]);
});

test("town hall is enabled when none exists yet", () => {
  const status = buildEntryStatus({ kind: "townHall", affordability: FULL, hasTownHall: false });
  assert.equal(status.disabled, false);
  assert.deepEqual(status.reasons, ["Upkeep: 3 wood, 2 stone per turn"]);
});

test("null affordability is affordable with no shortfall reasons", () => {
  const status = buildEntryStatus({ kind: "house", affordability: null, hasTownHall: true });
  assert.equal(status.disabled, true);
  assert.deepEqual(status.reasons, [
    "A town hall already exists in this settlement",
    "Upkeep: 1 wood per turn",
  ]);
  const plain = buildEntryStatus({ kind: "house", affordability: null });
  assert.equal(plain.disabled, false);
  assert.deepEqual(plain.reasons, ["Upkeep: 1 wood per turn"]);
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
