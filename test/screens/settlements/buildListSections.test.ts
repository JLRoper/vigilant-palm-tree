import { test } from "node:test";
import assert from "node:assert/strict";
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

test("exact section membership in BUILDABLE_KINDS order", () => {
  const sections = buildListSections();
  assert.deepEqual(sections[0]?.kinds, ["archeryRange", "barracks", "mageGuild", "farmhouse", "stables", "huntingLodge", "eyrie"]);
  assert.deepEqual(sections[1]?.kinds, ["goldMine", "woodcutterHut", "stoneMine", "ironMine", "arcaneFont"]);
  assert.deepEqual(sections[2]?.kinds, [
    "townHall", "house", "tower", "smithy", "market", "apartment", "farmField", "granary", "warehouse", "bank",
  ]);
});

test("sections come back in the fixed title order", () => {
  assert.deepEqual(
    buildListSections().map((s) => s.title),
    ["Troop Buildings", "Production", "Civilian"],
  );
});
