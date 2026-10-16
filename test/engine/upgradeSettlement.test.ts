import { test } from "node:test";
import assert from "node:assert/strict";
import { POP_BY_LEVEL, UPGRADE_POPULATION_GATE, startSettlementUpgrade } from "@heroes/engine";
import { makeSettlement, makeState } from "../charter/_helpers";

// issue #153: the population requirement is server-owned. These pins keep
// the engine constant authoritative -- no command field can move it.

test("UPGRADE_POPULATION_GATE is the engine-owned constant (former slider default)", () => {
  assert.equal(UPGRADE_POPULATION_GATE, 0.85);
});

function setUpgradeState(settlementId: string, population: number) {
  const settlement = makeSettlement(settlementId, 0, 2, 2, {
    level: 1,
    population,
    gold: 999999,
    warehouse: { wood: 999999, stone: 999999, iron: 999999, arcane: 999999, food: 0 },
    buildings: [{ gx: 0, gy: 0, kind: "townHall", level: 2, style: "classic" }],
  });
  const state = makeState({ settlements: [settlement] });
  return { state, settlementId };
}

test("population below 85% of the level cap rejects with population_too_low", () => {
  const level1Cap = POP_BY_LEVEL[1];
  const below = Math.floor(UPGRADE_POPULATION_GATE * level1Cap) - 1;
  const { state, settlementId } = setUpgradeState("s0", below);
  const result = startSettlementUpgrade(state, settlementId, 2, {}, []);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "population_too_low");
});

test("population at the gate threshold allows the upgrade", () => {
  const level1Cap = POP_BY_LEVEL[1];
  const atGate = Math.ceil(UPGRADE_POPULATION_GATE * level1Cap);
  const { state, settlementId } = setUpgradeState("s0", atGate);
  const result = startSettlementUpgrade(state, settlementId, 2, {}, []);
  assert.equal(result.ok, true);
  assert.equal(result.state.settlements[settlementId].upgrade?.targetLevel, 2);
});

test("level-2 threshold uses the level's own cap (1500), not the level-1 cap", () => {
  const settlement = makeSettlement("s0", 0, 2, 2, {
    level: 2,
    population: Math.ceil(UPGRADE_POPULATION_GATE * POP_BY_LEVEL[2]) - 1,
    gold: 999999,
    warehouse: { wood: 999999, stone: 999999, iron: 999999, arcane: 999999, food: 0 },
    buildings: [{ gx: 0, gy: 0, kind: "townHall", level: 3, style: "classic" }],
  });
  const state = makeState({ settlements: [settlement] });
  const result = startSettlementUpgrade(state, "s0", 3, {}, []);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "population_too_low");
});
