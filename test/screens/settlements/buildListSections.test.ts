import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { BuildingKind } from "@heroes/contracts";
import { isProducerKind } from "@heroes/engine";
import {
  BUILDABLE_KINDS,
  buildListSections,
} from "../../../src/screens/settlements/cityView/buildListSections";

test("sections partition the buildable list completely, without duplicates", () => {
  const sections = buildListSections();
  const combined = sections.flatMap((s) => s.kinds);
  assert.equal(combined.length, BUILDABLE_KINDS.length);
  assert.deepEqual([...combined].sort(), [...BUILDABLE_KINDS].sort());
});

test("stables is classified as a troop building", () => {
  const troop = buildListSections().find((s) => s.title === "Troop Buildings");
  assert.ok(troop, "Troop Buildings section missing");
  assert.ok(troop.kinds.includes("stables"), "stables missing from Troop Buildings");
});

test("farmhouse classifies as a troop building (it recruits peasants)", () => {
  const troop = buildListSections().find((s) => s.title === "Troop Buildings");
  assert.ok(troop, "Troop Buildings section missing");
  assert.ok(troop.kinds.includes("farmhouse"), "farmhouse missing from Troop Buildings");
});

test("farmhouse is also a food producer, but its recruit role wins the section", () => {
  assert.equal(isProducerKind("farmhouse"), true, "farmhouse produces food");
  const troop = buildListSections().find((s) => s.title === "Troop Buildings");
  const production = buildListSections().find((s) => s.title === "Production");
  assert.ok(troop && production);
  assert.ok(troop.kinds.includes("farmhouse"), "farmhouse stays in Troop Buildings");
  assert.ok(!production.kinds.includes("farmhouse"), "farmhouse must not be double-listed");
});

test("the food producers are Production (granary is a producer+storage hybrid)", () => {
  const production = buildListSections().find((s) => s.title === "Production");
  const civilian = buildListSections().find((s) => s.title === "Civilian");
  assert.ok(production && civilian);
  for (const kind of ["farmField", "granary"] as const) {
    assert.equal(isProducerKind(kind), true, `${kind} produces food`);
    assert.ok(production.kinds.includes(kind), `${kind} missing from Production`);
    assert.ok(!civilian.kinds.includes(kind), `${kind} must not stay in Civilian`);
  }
});

test("exact section membership in BUILDABLE_KINDS order", () => {
  const sections = buildListSections();
  assert.deepEqual(sections[0]?.kinds, ["archeryRange", "barracks", "mageGuild", "farmhouse", "stables", "huntingLodge", "eyrie", "crypt", "ossuary", "wraithBarrows", "spireOfAsh"]);
  assert.deepEqual(sections[1]?.kinds, ["goldMine", "woodcutterHut", "stoneMine", "ironMine", "arcaneFont", "farmField", "granary"]);
  assert.deepEqual(sections[2]?.kinds, [
    "townHall", "house", "tower", "smithy", "market", "apartment", "warehouse", "bank", "treasury",
  ]);
});

test("treasury is a Civilian building (no recruits, not a producer)", () => {
  const civilian = buildListSections().find((s) => s.title === "Civilian");
  const troop = buildListSections().find((s) => s.title === "Troop Buildings");
  const production = buildListSections().find((s) => s.title === "Production");
  assert.ok(civilian && troop && production);
  assert.ok(civilian.kinds.includes("treasury"), "treasury missing from Civilian");
  assert.ok(!troop.kinds.includes("treasury"), "treasury recruits nobody");
  assert.ok(!production.kinds.includes("treasury"), "treasury produces no resource");
});

// Coverage guard. BUILDABLE_KINDS is hand-maintained and does NOT derive from
// the BuildingKind union, so a kind added to contracts and the registry but
// forgotten here is not a type error -- it is a building that silently does not
// exist in the palette. This test reads the union out of the contracts source
// (it cannot import the type at runtime) and closes that hole.
//
// The `mine` carve-out is the legacy generic mine, superseded by stoneMine /
// ironMine. It is asserted by name in both directions, so it cannot be
// silently widened (hiding a genuinely forgotten kind) or silently dropped
// (accidentally putting a dead kind back in the palette).
const NON_BUILDABLE_KINDS: readonly BuildingKind[] = ["mine"];

function buildingKindsFromContracts(): BuildingKind[] {
  const source = readFileSync(
    fileURLToPath(new URL("../../../packages/contracts/src/buildings.ts", import.meta.url)),
    "utf8",
  );
  const block = source.match(/export type BuildingKind =([\s\S]*?);/);
  assert.ok(block, "could not find the BuildingKind union in contracts/buildings.ts");
  return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1] as BuildingKind);
}

test("BUILDABLE_KINDS plus NON_BUILDABLE_KINDS covers every BuildingKind member", () => {
  const all = buildingKindsFromContracts();
  assert.ok(all.includes("treasury"), "the union scan did not see the treasury kind");
  const covered = new Set<BuildingKind>([...BUILDABLE_KINDS, ...NON_BUILDABLE_KINDS]);
  const missing = all.filter((kind) => !covered.has(kind));
  assert.deepEqual(
    missing,
    [],
    `${missing.join(", ")} in the BuildingKind union but not in BUILDABLE_KINDS -- a building missing from the palette is invisible, not an error`,
  );
  assert.deepEqual(NON_BUILDABLE_KINDS, ["mine"], "the exclusion list is a deliberate, reviewed list");
});

test("no kind is both buildable and excluded, and the exclusion list has no duplicates", () => {
  const excluded = new Set(NON_BUILDABLE_KINDS);
  assert.equal(excluded.size, NON_BUILDABLE_KINDS.length, "duplicate entry in NON_BUILDABLE_KINDS");
  for (const kind of BUILDABLE_KINDS) {
    assert.ok(!excluded.has(kind), `${kind} is listed as both buildable and not buildable`);
  }
});

test("sections come back in the fixed title order", () => {
  assert.deepEqual(
    buildListSections().map((s) => s.title),
    ["Troop Buildings", "Production", "Civilian"],
  );
});
