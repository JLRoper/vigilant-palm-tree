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
  unitFactionId,
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

test("ashen ships its twelve-unit combat roster plus its Construction Worker", () => {
  assert.deepEqual(FACTION_REGISTRY.ashen.roster, [
    "ghoul",
    "bone_pikeman",
    "bone_archer",
    "wraith",
    "blood_knight",
    "vampire_lord",
    "lich",
    "skeleton_warrior",
    "grave_hound",
    "dark_acolyte",
    "necromancer",
    "bone_dragon",
    "construction_worker_ashen",
  ]);
});

test("ironmark ships its twelve-unit combat roster plus its Construction Worker", () => {
  assert.deepEqual(FACTION_REGISTRY.ironmark.roster, [
    "dwarf_axeman",
    "shield_bearer",
    "hand_gunner",
    "ironsworn",
    "iron_golem",
    "runesmith",
    "forge_lord",
    "tunnel_levy",
    "war_boar",
    "axe_thrower",
    "hearth_priest",
    "ram_rider",
    "construction_worker_ironmark",
  ]);
});

test("verdant ships its twelve-unit combat roster plus its Construction Worker", () => {
  assert.deepEqual(FACTION_REGISTRY.verdant.roster, [
    "forest_scout",
    "briar_warden",
    "warbeast",
    "thorn_archer",
    "elk_rider",
    "treant_elder",
    "stag_knight",
    "sproutling",
    "bramble_blade",
    "wildwood_ranger",
    "druid",
    "ursine_guardian",
    "construction_worker_verdant",
  ]);
  assert.notEqual(FACTION_REGISTRY.verdant.description, "", "the placeholder description is replaced by real content");
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

// The seat-faction recruit gate (unitAllowedForSeatFaction/RecruitFactionGate)
// was deleted (construction-worker-gated faction-building feature, section
// 2): every recruit building's roster is already faction-pure, so gating on
// the owning building already enforces it and the seat-level gate's own
// tests (no-op semantics, symmetry, the D3 unknown-id fallback, neutral
// exclusion) no longer apply to anything that exists. See
// packages/engine/src/settlement/recruitUnits.ts's header comment.

test("each playable faction has twelve combat units plus its Construction Worker, without roster overlap", () => {
  // 13 per faction since the Construction Worker landed (faction-
  // construction plan, section 3): the 12-unit combat roster parity from
  // PR #252 is untouched, plus one non-combat construction_worker_<faction>
  // unit recruited from the same faction's starter troop building.
  const allIds = new Set<string>();
  for (const faction of ["human", "ashen", "ironmark", "verdant"] as const) {
    const roster = FACTION_REGISTRY[faction].roster;
    assert.equal(roster.length, 13);
    for (const id of roster) {
      assert.equal(allIds.has(id), false, `${id} belongs to only one faction`);
      allIds.add(id);
    }
  }
  assert.equal(allIds.size, 52);
});
