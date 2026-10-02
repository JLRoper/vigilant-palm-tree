// Descriptor coverage for the arena unit sprites (plan/
// 2026-09-29-arena-unit-sprites.md step 9). assetDescriptors.ts is Vite-?url-
// coupled (import.meta.glob + ~100 PNG imports) and cannot be imported under
// bare node:test, so this suite pins the registry contract the same way
// paint2d.seam.test.ts pins the painter seam: a static catalog-id list
// checked against (a) the art files actually on disk and (b) the registry
// wiring in the descriptor source. A new catalog row without art, or art
// dropped outside the registry's filename convention, fails here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { UNIT_CATALOG_IDS } from "../helpers/unitIds";

const ARENA_DIR = resolve(process.cwd(), "src", "resources", "units", "arena");
const DESCRIPTORS_SOURCE = resolve(process.cwd(), "src", "render", "assetDescriptors.ts");

// The known, deliberate art gap: mage has no arena poses (45 sprites for 15
// ids); the painter falls back to circle rendering for it.
const EXPECTED_ARENA_GAPS: readonly string[] = ["mage"];

const UNIT_CATALOG_IDS_WITH_ART = UNIT_CATALOG_IDS.filter(
  (id) => !EXPECTED_ARENA_GAPS.includes(id),
);

const POSES = ["idle", "attack", "move"] as const;

test("arena art folder exists with the registry's expected layout", () => {
  assert.ok(existsSync(ARENA_DIR), `arena art folder missing at ${ARENA_DIR}`);
});

test("every unit-catalog id has idle art on disk", () => {
  for (const id of UNIT_CATALOG_IDS_WITH_ART) {
    const file = resolve(ARENA_DIR, `${id}-idle.png`);
    assert.ok(existsSync(file), `unit "${id}" has no idle sprite (expected ${id}-idle.png) — a catalog row can't ship art-less`);
  }
});

test("every file in the arena folder follows the <unitTypeId>-<pose>.png convention with a known pose", () => {
  const pattern = /^(.+)-(idle|attack|move)\.png$/;
  for (const name of readdirSync(ARENA_DIR)) {
    const match = name.match(pattern);
    assert.ok(match, `${name} does not match <unitTypeId>-<pose>.png and would never resolve as unit.<id>.<pose>`);
    const [, unitTypeId, pose] = match;
    assert.ok(unitTypeId.length > 0, `${name} has an empty unitTypeId`);
    assert.ok((POSES as readonly string[]).includes(pose), `${name} uses unknown pose "${pose}"`);
    assert.ok(UNIT_CATALOG_IDS.includes(unitTypeId as (typeof UNIT_CATALOG_IDS)[number]), `${name} references unknown unit id "${unitTypeId}" (not in the catalog id list)`);
  }
});

test("assetDescriptors wires the arena registry: glob, key template, builder, and ALL_DESCRIPTORS aggregate", () => {
  const source = readFileSync(DESCRIPTORS_SOURCE, "utf8");
  assert.ok(source.includes("resources/units/arena/*.png"), "descriptor source must glob ../resources/units/arena/*.png so new art drops in without code");
  assert.match(source, /`unit\.\$\{string\}\.\$\{UnitArenaPose\}`/, "SpriteKey union must carry the unit.<id>.<pose> template");
  assert.match(source, /export function unitArenaKey\(/, "unitArenaKey builder must be exported for the paint2dDefaults resolver");
  assert.match(source, /UNIT_ARENA_FILE_PATTERN = \/\(\[\^\/\]\+\)-\(idle\|attack\|move\)\\.png\$\//, "the filename convention regex must accept <unitTypeId>-<pose>.png");
  assert.match(
    source.replace(/\r?\n/g, " "),
    /export const ALL_DESCRIPTORS[^;]*?UNIT_ARENA_DESCRIPTORS/,
    "UNIT_ARENA_DESCRIPTORS must be folded into ALL_DESCRIPTORS so createDefaultProvider can load them",
  );
});

test("registry descriptors use the arena draw contract: bottom anchor, fitHeight 1.3, naturalSize 128", () => {
  const source = readFileSync(DESCRIPTORS_SOURCE, "utf8");
  const block = source.slice(source.indexOf("UNIT_ARENA_GLOB"), source.indexOf("ALL_DESCRIPTORS"));
  assert.ok(block.includes('anchor: "bottom"'), "unit sprites are bottom-anchored (feet on the hex)");
  assert.ok(block.includes('hexSizeMul: 1.3'), "unit sprites size at 1.3x the arena hex height");
  assert.ok(block.includes("naturalSize: 128"), "unit sprites ship 128px natural");
});
