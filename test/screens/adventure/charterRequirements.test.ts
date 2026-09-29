import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyWarehouse, makeHero, makeSettlement, makeState } from "../../charter/_helpers";
import {
  CHARTER_PURSE_HINT,
  evaluateCharterRequirements,
} from "../../../src/screens/adventure/charterRequirements";

function passingState() {
  return makeState({
    heroes: [makeHero("h0", 0, 2, 2, { gold: 2500 })],
    settlements: [
      makeSettlement("s0", 0, 2, 2, { warehouse: emptyWarehouse({ wood: 20, stone: 15 }) }),
    ],
    selectedHeroId: "h0",
  });
}

test("all requirements met passes with no missing entries or hints", () => {
  const reqs = evaluateCharterRequirements(passingState(), "h0");
  assert.equal(reqs.canStart, true);
  assert.deepEqual(reqs.missing, []);
  assert.deepEqual(reqs.hints, []);
});

test("no hero selected is the only failure reported", () => {
  const reqs = evaluateCharterRequirements(passingState(), null);
  assert.equal(reqs.canStart, false);
  assert.deepEqual(reqs.missing, ["No hero selected"]);
  assert.deepEqual(reqs.hints, []);
});

test("a hero already chartering fails on that requirement alone", () => {
  const state = makeState({
    heroes: [makeHero("h0", 0, 2, 2, { gold: 2500, isChartering: true })],
    settlements: [
      makeSettlement("s0", 0, 2, 2, { warehouse: emptyWarehouse({ wood: 20, stone: 15 }) }),
    ],
    selectedHeroId: "h0",
  });
  const reqs = evaluateCharterRequirements(state, "h0");
  assert.equal(reqs.canStart, false);
  assert.deepEqual(reqs.missing, ["Hero is already chartering"]);
});

test("a hero off any friendly settlement fails on that requirement alone", () => {
  const state = makeState({
    heroes: [makeHero("h0", 0, 7, 5, { gold: 2500 })],
    settlements: [
      makeSettlement("s0", 0, 2, 2, { warehouse: emptyWarehouse({ wood: 20, stone: 15 }) }),
    ],
    selectedHeroId: "h0",
  });
  const reqs = evaluateCharterRequirements(state, "h0");
  assert.equal(reqs.canStart, false);
  assert.deepEqual(reqs.missing, ["Hero must stand on a friendly settlement"]);
});

test("a short purse reports the exact missing row and the withdraw hint", () => {
  const state = makeState({
    heroes: [makeHero("h0", 0, 2, 2, { gold: 300 })],
    settlements: [
      makeSettlement("s0", 0, 2, 2, { warehouse: emptyWarehouse({ wood: 20, stone: 15 }) }),
    ],
    selectedHeroId: "h0",
  });
  const reqs = evaluateCharterRequirements(state, "h0");
  assert.equal(reqs.canStart, false);
  assert.deepEqual(reqs.missing, ["Purse 300/2500g"]);
  assert.deepEqual(reqs.hints, [
    "Withdraw gold from a friendly settlement's treasury — your hero must stand on it (hero panel → Withdraw all)",
  ]);
  assert.equal(CHARTER_PURSE_HINT, reqs.hints[0]);
});

test("short warehouse wood is reported with current and required values", () => {
  const state = makeState({
    heroes: [makeHero("h0", 0, 2, 2, { gold: 2500 })],
    settlements: [
      makeSettlement("s0", 0, 2, 2, { warehouse: emptyWarehouse({ wood: 12, stone: 15 }) }),
    ],
    selectedHeroId: "h0",
  });
  const reqs = evaluateCharterRequirements(state, "h0");
  assert.equal(reqs.canStart, false);
  assert.deepEqual(reqs.missing, ["Warehouse wood 12/20"]);
  assert.deepEqual(reqs.hints, []);
});

test("short warehouse stone is reported with current and required values", () => {
  const state = makeState({
    heroes: [makeHero("h0", 0, 2, 2, { gold: 2500 })],
    settlements: [
      makeSettlement("s0", 0, 2, 2, { warehouse: emptyWarehouse({ wood: 20, stone: 10 }) }),
    ],
    selectedHeroId: "h0",
  });
  const reqs = evaluateCharterRequirements(state, "h0");
  assert.equal(reqs.canStart, false);
  assert.deepEqual(reqs.missing, ["Warehouse stone 10/15"]);
  assert.deepEqual(reqs.hints, []);
});

test("multiple shortfalls accumulate in a stable order with the purse hint", () => {
  const state = makeState({
    heroes: [makeHero("h0", 0, 2, 2, { gold: 300 })],
    settlements: [
      makeSettlement("s0", 0, 2, 2, { warehouse: emptyWarehouse({ wood: 12, stone: 10 }) }),
    ],
    selectedHeroId: "h0",
  });
  const reqs = evaluateCharterRequirements(state, "h0");
  assert.equal(reqs.canStart, false);
  assert.deepEqual(reqs.missing, [
    "Purse 300/2500g",
    "Warehouse wood 12/20",
    "Warehouse stone 10/15",
  ]);
  assert.deepEqual(reqs.hints, [CHARTER_PURSE_HINT]);
});

test("requirement rows carry pass/fail state for every check", () => {
  const reqs = evaluateCharterRequirements(passingState(), "h0");
  assert.deepEqual(
    reqs.rows.map((r) => [r.label, r.ok, r.detail]),
    [
      ["Hero selected", true, "h0"],
      ["Not already chartering", true, "Ready"],
      ["On friendly settlement", true, "Standing on s0"],
      ["Purse", true, "2500/2500g"],
      ["Warehouse wood", true, "20/20"],
      ["Warehouse stone", true, "15/15"],
    ],
  );
});
