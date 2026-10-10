#!/usr/bin/env node
// Generator for packages/engine/src/generated/buildingSpriteKeys.ts — the
// single source of truth for building sprite keys, consumed by both the render
// client (src/render/assetDescriptors.ts) and the engine
// (packages/engine/src/styleResolver.ts).
//
// It scans src/resources/buildings/ for the pixel-art family and derives keys
// from the filename grammar:
//
//   building-pixel-<kind>-<level>.png      ->  pixel.<kind>.<level>
//   building-pixel-<kind>-<level>-alt.png  ->  pixel-alt.<kind>.<level>
//
// plus a small alias table for keys that have no file of their own (the legacy
// generic `mine` kind, farm-plot L2/L3 reusing the L1 art, and woodcutterHut-3
// reusing the -2 art).
//
// The folder also holds legacy exploration files (building-classic-*,
// building-blocky-*, *-raw, *-variant*, *-tilled, *-watered*). Those are
// deliberately NOT registered: only the strict grammar above produces a key.
// Any building-pixel-* file that fails the grammar is reported as a warning —
// it would otherwise be silently dropped.
//
// Usage:
//   node tools/sprites/gen-building-sprite-keys.mjs              # write the file
//   node tools/sprites/gen-building-sprite-keys.mjs --check      # verify only (exit 1 on drift)
//   node tools/sprites/gen-building-sprite-keys.mjs --dry-run    # print the output, write nothing
//
// The file is committed (the server and the bare node:test suites cannot run a
// Vite glob, so the generated list must exist in source). `--check` is what
// keeps it honest, the same shape as tools/sprites/tune-run-frames.mjs --check
// and the skill's repair-alpha.mjs --check.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const buildingsDir = path.join(repoRoot, "src", "resources", "buildings");
const outFile = path.join(repoRoot, "packages", "engine", "src", "generated", "buildingSpriteKeys.ts");

const FILE_PATTERN = /^building-pixel-([A-Za-z][A-Za-z0-9]*)-(\d+)(-alt)?\.png$/;

// Keys with no file of their own: alias key -> target key it resolves to.
// Kept here (not in the generated file's data) so the generator owns the
// exceptions to the filename grammar.
const ALIASES = {
  // Legacy saves hold the generic non-buildable `mine` kind; its L1-L3 levels
  // render with the stoneMine art.
  "pixel.mine.1": "pixel.stoneMine.1",
  "pixel.mine.2": "pixel.stoneMine.2",
  "pixel.mine.3": "pixel.stoneMine.3",
  // Farm plots ship one art file per style; L2/L3 are the same sprite as L1.
  "pixel.farmField.2": "pixel.farmField.1",
  "pixel.farmField.3": "pixel.farmField.1",
  "pixel-alt.farmField.2": "pixel-alt.farmField.1",
  "pixel-alt.farmField.3": "pixel-alt.farmField.1",
  // woodcutterHut has art for L1/L2 only; L3 reuses the L2 sprite.
  "pixel.woodcutterHut.3": "pixel.woodcutterHut.2",
};

const flags = new Set(process.argv.slice(2));
if (flags.has("-h") || flags.has("--help")) {
  console.log("usage: node tools/sprites/gen-building-sprite-keys.mjs [--check|--dry-run]");
  process.exit(0);
}
const checkOnly = flags.has("--check");
const dryRun = flags.has("--dry-run");

const entries = readdirSync(buildingsDir)
  .filter((f) => f.endsWith(".png"))
  .map((file) => ({ file, m: FILE_PATTERN.exec(file) }))
  .filter((e) => e.m !== null)
  .map(({ file, m }) => {
    const kind = m[1];
    const level = m[2];
    const style = m[3] ? "pixel-alt" : "pixel";
    return { key: `${style}.${kind}.${level}`, file };
  });

const unmatchedPixel = readdirSync(buildingsDir)
  .filter((f) => f.endsWith(".png") && f.startsWith("building-pixel-") && FILE_PATTERN.exec(f) === null);
if (unmatchedPixel.length > 0) {
  console.warn(`warning: ${unmatchedPixel.length} building-pixel-*.png file(s) do not match the grammar and were skipped:`);
  for (const f of unmatchedPixel) console.warn(`  ${f}`);
}

entries.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

const aliasEntries = Object.entries(ALIASES).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
const fileKeys = new Set(entries.map((e) => e.key));

for (const [alias, target] of aliasEntries) {
  if (!fileKeys.has(target)) {
    console.error(`error: alias "${alias}" points at "${target}", which has no file on disk`);
    process.exit(1);
  }
}

function recordLines(pairs, indent = "  ") {
  return pairs.map(([k, v]) => `${indent}${JSON.stringify(k)}: ${JSON.stringify(v)},`).join("\n");
}

const content = `// GENERATED FILE -- DO NOT EDIT BY HAND.
//
// Regenerate:  npm run gen:sprite-keys
// Verify only:  npm run gen:sprite-keys:check
//
// Source of truth: the building-pixel-*.png files in src/resources/buildings/
// (filename grammar: building-pixel-<kind>-<level>[-alt].png) plus the alias
// table in tools/sprites/gen-building-sprite-keys.mjs. The legacy
// building-classic-*/building-blocky-*/*-raw/*-variant* files in that folder
// are deliberately not registered.

/** Sprite key -> on-disk filename, one entry per building-pixel-*.png (${entries.length} files). */
export const BUILDING_SPRITE_FILES: Readonly<Record<string, string>> = {
${recordLines(entries.map((e) => [e.key, e.file]))}
};

/**
 * Keys that have no file of their own: an alias resolves to the same sprite as
 * its target key. Covers the legacy generic \`mine\` kind (stoneMine art), the
 * farm-plot L2/L3 reuse of the L1 art, and woodcutterHut-3 reusing the -2 art.
 */
export const BUILDING_SPRITE_ALIASES: Readonly<Record<string, string>> = {
${recordLines(aliasEntries)}
};

/** Every building sprite key (file-backed and aliased), sorted and unique. */
export const BUILDING_SPRITE_KEYS: readonly string[] = [
  ...new Set([...Object.keys(BUILDING_SPRITE_FILES), ...Object.keys(BUILDING_SPRITE_ALIASES)]),
].sort();
`;

if (dryRun) {
  process.stdout.write(content);
  process.exit(0);
}

let existing = null;
try {
  existing = readFileSync(outFile, "utf8");
} catch {
  // missing -> write it
}

if (checkOnly) {
  if (existing !== content) {
    console.error(`drift: ${path.relative(repoRoot, outFile)} is out of date (${entries.length} file keys + ${aliasEntries.length} aliases).`);
    console.error("fix:    npm run gen:sprite-keys");
    process.exit(1);
  }
  console.log(`building sprite keys up to date (${entries.length} file keys + ${aliasEntries.length} aliases = ${entries.length + aliasEntries.length} keys).`);
  process.exit(0);
}

if (existing === content) {
  console.log(`building sprite keys unchanged (${entries.length} file keys + ${aliasEntries.length} aliases).`);
  process.exit(0);
}

mkdirSync(path.dirname(outFile), { recursive: true });
writeFileSync(outFile, content);
console.log(`wrote ${path.relative(repoRoot, outFile)} (${entries.length} file keys + ${aliasEntries.length} aliases = ${entries.length + aliasEntries.length} keys).`);
