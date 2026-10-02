// Registry + defaults pins for the faction-registry foundation: the
// exhaustiveness FACTION_REGISTRY carries by construction (Record<
// FactionId, FactionDef>), the unitFactionId / playerFactionId "human"
// defaults (D3/D4 — legacy literals and rows stay valid), and the dormant
// recruit-gating seam (D5): gate active/inactive, the unknown-id fallback,
// and neutral units never eligible for a seat.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { FactionId, UnitType } from "@heroes/contracts";
import {
  FACTION_REGISTRY,
  playerFactionId,
  unitAllowedForSeatFaction,
  unitFactionId,
  type RecruitFactionGate,
} from "@heroes/engine";

function unit(id: string, factionId?: FactionId): UnitType {
  return {
    id,
    name: id,
    attack: 1,
    defence: 1,
    health: 1,
    speed: 1,
    description: "",
    advantageType: "infantry",
    specialty: "",
    specialtyPriority: 0,
    ...(factionId !== undefined ? { factionId } : {}),
  };
}

function gate(unitTypes: Record<string, UnitType>, seatFactionId: FactionId): RecruitFactionGate {
  return { unitTypes, seatFactionId };
}

test("FACTION_REGISTRY is exhaustive over FactionId and every entry's id matches its key", () => {
  assert.deepEqual(
    Object.keys(FACTION_REGISTRY).sort(),
    ["ashen", "human", "ironmark", "neutral", "verdant"],
  );
  for (const [key, def] of Object.entries(FACTION_REGISTRY)) {
    assert.equal(def.id, key, `FACTION_REGISTRY.${key}.id must be "${key}"`);
    assert.ok(def.label.length > 0, `FACTION_REGISTRY.${key} carries a label`);
  }
});

test("unitFactionId defaults absent and unknown entries to human", () => {
  assert.equal(unitFactionId(undefined), "human");
  assert.equal(unitFactionId(unit("swordsman")), "human");
  assert.equal(unitFactionId(unit("revenant", "ashen")), "ashen");
});

test("playerFactionId defaults absent seats to human", () => {
  assert.equal(playerFactionId(undefined), "human");
  assert.equal(playerFactionId({ factionId: undefined }), "human");
  assert.equal(playerFactionId({ factionId: "ironmark" }), "ironmark");
});

test("the gate no-ops without opts and with either half missing", () => {
  const humanUnit = unit("swordsman", "human");
  const ashenUnit = unit("revenant", "ashen");
  const catalog = { swordsman: humanUnit, revenant: ashenUnit };
  assert.equal(unitAllowedForSeatFaction("swordsman"), true, "no opts = today's behavior");
  assert.equal(unitAllowedForSeatFaction("revenant", { seatFactionId: "human" }), true, "no unitTypes = gate cannot act");
  assert.equal(
    unitAllowedForSeatFaction("swordsman", { unitTypes: catalog }),
    true,
    "no seatFactionId = gate cannot act",
  );
});

test("the gate is symmetric: a seat sees only its own faction's units", () => {
  const catalog = {
    swordsman: unit("swordsman", "human"),
    revenant: unit("revenant", "ashen"),
    golem: unit("golem", "ironmark"),
  };
  assert.equal(unitAllowedForSeatFaction("swordsman", gate(catalog, "human")), true);
  assert.equal(unitAllowedForSeatFaction("revenant", gate(catalog, "human")), false);
  assert.equal(unitAllowedForSeatFaction("revenant", gate(catalog, "ashen")), true);
  assert.equal(unitAllowedForSeatFaction("swordsman", gate(catalog, "ashen")), false);
  assert.equal(unitAllowedForSeatFaction("golem", gate(catalog, "ironmark")), true);
});

test("unknown unit ids default human inside the gate (D3 fallback)", () => {
  const catalog: Record<string, UnitType> = {};
  assert.equal(unitAllowedForSeatFaction("anything", gate(catalog, "human")), true);
  assert.equal(unitAllowedForSeatFaction("anything", gate(catalog, "ashen")), false);
});

test("neutral units are never eligible for a seat faction", () => {
  const catalog = { griffin: unit("griffin", "neutral") };
  for (const seat of ["human", "ashen", "ironmark", "verdant"] as const) {
    assert.equal(
      unitAllowedForSeatFaction("griffin", gate(catalog, seat)),
      false,
      `a ${seat} seat must not recruit the neutral griffin`,
    );
  }
});