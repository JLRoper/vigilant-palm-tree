// Parity guard for the generated building-sprite key list.
//
// packages/engine/src/generated/buildingSpriteKeys.ts is produced by
// tools/sprites/gen-building-sprite-keys.mjs from the building-pixel-*.png
// files on disk. This test is the safety net that the old hand-written
// `BUILDING_SPRITES` map used to provide implicitly: every key has a file,
// every file has a key, the engine list is the generated one (not a drifted
// hand-copy), and the legacy classic/blocky art in the same folder stays
// unregistered.
//
// Like test/data/unitIcons.coverage.test.ts, this file does NOT import
// src/render/assetDescriptors.ts: that module uses Vite `?url` imports and
// import.meta.glob, which crash under bare node:test. The client side is
// asserted with a source scan instead.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BUILDING_SPRITE_KEYS, pickStyleForBuilding } from "@heroes/engine";
import { BUILDING_SPRITE_ALIASES, BUILDING_SPRITE_FILES } from "../../packages/engine/src/generated/buildingSpriteKeys";

const BUILDINGS_DIR = fileURLToPath(new URL("../../src/resources/buildings/", import.meta.url));

const FILE_PATTERN = /^building-pixel-([A-Za-z][A-Za-z0-9]*)-(\d+)(-alt)?\.png$/;

function diskFiles(): string[] {
  return readdirSync(BUILDINGS_DIR).filter((f) => f.endsWith(".png"));
}

test("every generated file key has a real PNG on disk", () => {
  for (const [key, fileName] of Object.entries(BUILDING_SPRITE_FILES)) {
    const filePath = fileURLToPath(new URL(`../../src/resources/buildings/${fileName}`, import.meta.url));
    assert.doesNotThrow(() => statSync(filePath), `${fileName} (key "${key}") is missing from src/resources/buildings/`);
    assert.ok(statSync(filePath).size > 0, `${fileName} (key "${key}") is empty`);
  }
});

test("every alias target is a file-backed key", () => {
  for (const [alias, target] of Object.entries(BUILDING_SPRITE_ALIASES)) {
    assert.ok(BUILDING_SPRITE_FILES[target], `alias "${alias}" -> "${target}" has no file on disk`);
    assert.ok(!BUILDING_SPRITE_ALIASES[target], `alias "${alias}" chains to another alias ("${target}")`);
  }
});

test("the union key list is unique and equals files + aliases", () => {
  const expected = Object.keys(BUILDING_SPRITE_FILES).length + Object.keys(BUILDING_SPRITE_ALIASES).length;
  assert.equal(BUILDING_SPRITE_KEYS.length, expected, "BUILDING_SPRITE_KEYS must have one entry per file key plus one per alias");
  assert.equal(new Set(BUILDING_SPRITE_KEYS).size, BUILDING_SPRITE_KEYS.length, "duplicate key");
});

test("every building-pixel-*.png on disk parses under the filename grammar and has a key", () => {
  const pngFiles = diskFiles().filter((f) => f.startsWith("building-pixel-"));
  assert.equal(pngFiles.length, Object.keys(BUILDING_SPRITE_FILES).length, "a building-pixel-*.png on disk has no generated key (run npm run gen:sprite-keys)");
  for (const file of pngFiles) {
    const m = FILE_PATTERN.exec(file);
    assert.ok(m, `${file} does not match building-pixel-<kind>-<level>[-alt].png`);
    const style = m[3] ? "pixel-alt" : "pixel";
    const key = `${style}.${m[1]}.${m[2]}`;
    assert.ok(BUILDING_SPRITE_FILES[key], `${file} parsed to key "${key}", which is not registered`);
  }
});

test("legacy classic/blocky art in the buildings folder is not registered", () => {
  for (const file of diskFiles()) {
    if (!file.startsWith("building-classic-") && !file.startsWith("building-blocky-")) continue;
    assert.ok(!Object.values(BUILDING_SPRITE_FILES).includes(file), `${file} is legacy art and must stay unregistered`);
  }
  for (const key of BUILDING_SPRITE_KEYS) {
    assert.ok(
      key.startsWith("pixel.") || key.startsWith("pixel-alt."),
      `${key} is neither pixel nor pixel-alt`,
    );
  }
});

test("the engine consumes the generated list (no hand-copy to drift)", () => {
  const engineKeys = [...BUILDING_SPRITE_KEYS].sort();
  const generatedKeys = [
    ...new Set([...Object.keys(BUILDING_SPRITE_FILES), ...Object.keys(BUILDING_SPRITE_ALIASES)]),
  ].sort();
  assert.deepEqual(engineKeys, generatedKeys);
});

test("pickStyleForBuilding never falls through to pixel-alt (generated order independence)", () => {
  for (const key of BUILDING_SPRITE_KEYS) {
    const dot = key.indexOf(".") + 1;
    const level = key.slice(key.lastIndexOf(".") + 1);
    const kind = key.slice(dot, key.length - level.length - 1);
    // "classic" has no art for any kind, so this always takes the fall-through.
    assert.notEqual(pickStyleForBuilding(kind, Number(level), "classic"), "pixel-alt", `fall-through promoted pixel-alt for ${kind} L${level}`);
  }
  // The explicit carrier still reaches the alternate plot art.
  assert.equal(pickStyleForBuilding("farmField", 1, "pixel-alt"), "pixel-alt");
});

// --- client side (source scan; assetDescriptors.ts cannot be imported here) ---

const ASSET_DESCRIPTORS_SRC = readFileSync(
  fileURLToPath(new URL("../../src/render/assetDescriptors.ts", import.meta.url)),
  "utf8",
);

test("assetDescriptors.ts resolves building sprites through the glob, not hand-written imports", () => {
  assert.ok(
    /import\.meta\.glob\(\s*"\.\.\/resources\/buildings\/building-pixel-\*\.png"/.test(ASSET_DESCRIPTORS_SRC),
    "the building-pixel-*.png glob is missing from assetDescriptors.ts",
  );
  assert.ok(ASSET_DESCRIPTORS_SRC.includes("BUILDING_SPRITE_FILES"), "assetDescriptors.ts no longer consumes BUILDING_SPRITE_FILES");
  assert.ok(ASSET_DESCRIPTORS_SRC.includes("BUILDING_SPRITE_ALIASES"), "assetDescriptors.ts no longer consumes BUILDING_SPRITE_ALIASES");
});

test("assetDescriptors.ts carries no hand-written building-pixel ?url imports", () => {
  const handWired = ASSET_DESCRIPTORS_SRC
    .split("\n")
    .filter((line) => /^import\s+\w+\s+from\s+"\.\.\/resources\/buildings\/building-pixel-.*\.png\?url";/.test(line));
  assert.equal(handWired.length, 0, `hand-wired building sprite imports reappeared:\n${handWired.join("\n")}`);
});
