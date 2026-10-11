#!/usr/bin/env node
// Generator for src/render/generated/buildingAnchorOverrides.ts -- the
// anchorOffsetY overrides that cancel the universal -12px default in
// assetDescriptors.ts so each building sprite's visible base lands on its
// cell's south vertex.
//
// Before this, the 114-row table was hand-measured and hand-maintained, its own
// comment calling it "an eyeballed baseline, not a strict geometric solve". The
// measurement knowledge lived in gitignored local/, and the two competing
// divisors (86.4 for 1x1 keys, 172.8 for the 2x2 farmField plots) were implied
// by which key you were looking at rather than declared anywhere.
//
// Method (identical to the local tool it replaces, minus the browser):
//   decode the PNG with pngjs and find maxY, the lowest row index containing
//   any pixel with alpha > 10. padRows = h - 1 - maxY is the fully-transparent
//   bottom margin, and offsetY = round(padRows * divisor / h) with the divisor
//   being the sprite's draw height (see DIVISOR notes below).
//
// The alpha > 10 threshold matters: it matches what the browser canvas reported,
// so re-measuring an unmodified PNG reproduces the previous number exactly. That
// is what makes this a refactor rather than a silent re-anchoring.
//
// Usage:
//   node tools/sprites/gen-building-anchors.mjs            # write the file
//   node tools/sprites/gen-building-anchors.mjs --check    # verify only (exit 1 on drift)
//   node tools/sprites/gen-building-anchors.mjs --dry-run  # print, write nothing

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const BUILDINGS_DIR = path.join(ROOT, "src", "resources", "buildings");
const KEYS_FILE = path.join(ROOT, "packages", "engine", "src", "generated", "buildingSpriteKeys.ts");
const OUT_FILE = path.join(ROOT, "src", "render", "generated", "buildingAnchorOverrides.ts");

/** Alpha above this counts as opaque -- matches the browser canvas measurement. */
const ALPHA_THRESHOLD = 10;

/**
 * The divisor is the sprite's draw height, and it is declared per key rather
 * than inferred from the footprint.
 *
 * DEFAULT (86.4) is the 1x1 draw height (tw * 0.9 = 86.4). It is applied to
 * every key except the ground plots below, *including* other 2x2 buildings such
 * as townHall, which deliberately keep it.
 *
 * TWO_BY_TWO (172.8) is the real 2x2 draw height. The farmField ground plots use
 * it so the plot's slab corner lands on the 2x2 footprint's south vertex; under
 * the 86.4 convention they float ~10px high. Both the pixel and the pixel-alt
 * plot art are measured this way.
 */
const DIVISOR_DEFAULT = 86.4;
const DIVISOR_TWO_BY_TWO = 172.8;
const TWO_BY_TWO_GROUND_PLOTS = /^pixel(?:-alt)?\.farmField\.\d+$/;

const FILE_PATTERN = /^building-pixel-([A-Za-z][A-Za-z0-9]*)-(\d+)(-alt)?\.png$/;

const flags = new Set(process.argv.slice(2));
if (flags.has("-h") || flags.has("--help")) {
  console.log("usage: node tools/sprites/gen-building-anchors.mjs [--check|--dry-run]");
  process.exit(0);
}
const checkOnly = flags.has("--check");
const dryRun = flags.has("--dry-run");

// --- read the single source of truth for key -> filename and aliases --------

function parseGeneratedBlock(src, constName) {
  const start = src.indexOf(`export const ${constName}`);
  if (start === -1) return null;
  const open = src.indexOf("{", start);
  const close = src.indexOf("};", open);
  if (open === -1 || close === -1) return null;
  const body = src.slice(open, close);
  const out = {};
  for (const m of body.matchAll(/"([^"]+)"\s*:\s*"([^"]+)"/g)) out[m[1]] = m[2];
  return out;
}

const keysSrc = readFileSync(KEYS_FILE, "utf8");
const FILES = parseGeneratedBlock(keysSrc, "BUILDING_SPRITE_FILES");
const ALIASES = parseGeneratedBlock(keysSrc, "BUILDING_SPRITE_ALIASES");
if (!FILES || Object.keys(FILES).length === 0) {
  console.error(`gen-building-anchors: could not read BUILDING_SPRITE_FILES from ${path.relative(ROOT, KEYS_FILE)}`);
  console.error("fix:    npm run gen:sprite-keys");
  process.exit(1);
}
if (!ALIASES) {
  console.error(`gen-building-anchors: could not read BUILDING_SPRITE_ALIASES from ${path.relative(ROOT, KEYS_FILE)}`);
  process.exit(1);
}

// --- measure ----------------------------------------------------------------

function measureBottomPad(filePath) {
  const png = PNG.sync.read(readFileSync(filePath));
  const { width, height, data } = png;
  // Scan upward for the lowest row containing any pixel above the threshold.
  let maxY = -1;
  for (let y = height - 1; y >= 0; y--) {
    let found = false;
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > ALPHA_THRESHOLD) {
        found = true;
        break;
      }
    }
    if (found) {
      maxY = y;
      break;
    }
  }
  return { width, height, maxY, padRows: height - 1 - maxY };
}

const measured = {};
const problems = [];

const onDisk = readdirSync(BUILDINGS_DIR).filter((f) => f.endsWith(".png") && FILE_PATTERN.test(f));
const unmatchedPixel = readdirSync(BUILDINGS_DIR).filter(
  (f) => f.startsWith("building-pixel-") && f.endsWith(".png") && !FILE_PATTERN.test(f),
);
if (unmatchedPixel.length > 0) {
  console.warn(`warning: ${unmatchedPixel.length} building-pixel-*.png file(s) do not match the grammar and were skipped:`);
  for (const f of unmatchedPixel) console.warn(`  ${f}`);
}

for (const [key, fileName] of Object.entries(FILES)) {
  const filePath = path.join(BUILDINGS_DIR, fileName);
  let m;
  try {
    m = measureBottomPad(filePath);
  } catch (e) {
    problems.push(`${fileName} (key "${key}"): ${String(e).slice(0, 120)}`);
    continue;
  }
  const divisor = TWO_BY_TWO_GROUND_PLOTS.test(key) ? DIVISOR_TWO_BY_TWO : DIVISOR_DEFAULT;
  measured[key] = Math.round((m.padRows * divisor) / m.height);
}

for (const file of onDisk) {
  if (!Object.values(FILES).includes(file)) {
    problems.push(`${file} is on disk but not registered in BUILDING_SPRITE_FILES (run npm run gen:sprite-keys)`);
  }
}

if (problems.length > 0) {
  console.error(`gen-building-anchors: ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

// Aliases inherit their target's measured offset, so a kind with no art of its
// own (the legacy generic `mine`, farmField L2/L3, woodcutterHut-3) moves with
// the art it points at.
const anchors = { ...measured };
for (const [aliasKey, targetKey] of Object.entries(ALIASES)) {
  if (measured[targetKey] === undefined) {
    console.error(`gen-building-anchors: alias "${aliasKey}" -> "${targetKey}" has no measured target`);
    process.exit(1);
  }
  anchors[aliasKey] = measured[targetKey];
}

const sortedKeys = Object.keys(anchors).sort();
const lines = sortedKeys.map((k) => `  ${JSON.stringify(k)}: ${anchors[k]},`);

const content = `// GENERATED FILE -- DO NOT EDIT BY HAND.
//
// Regenerate:  npm run gen:building-anchors
// Verify only:  npm run gen:building-anchors:check
//
// Source of truth: the transparent bottom-pad rows of each PNG in
// src/resources/buildings/, measured by tools/sprites/gen-building-anchors.mjs.
//
//   maxY    = lowest row containing any pixel with alpha > 10
//   padRows = height - 1 - maxY
//   offsetY = round(padRows * divisor / height)
//
// divisor is the sprite's draw height, declared per key in the generator: 86.4
// (the 1x1 draw height) for every key except the farmField ground plots, which
// use 172.8 (the real 2x2 draw height) so the plot corner lands on the 2x2
// footprint's south vertex.
//
// Keys with no file of their own inherit their target's offset via the alias
// table in packages/engine/src/generated/buildingSpriteKeys.ts.

/** key -> anchorOffsetY, one entry per building sprite key (${sortedKeys.length}). */
export const BUILDING_ANCHOR_OVERRIDES: Readonly<Record<string, number>> = {
${lines.join("\n")}
};
`;

if (dryRun) {
  process.stdout.write(content);
  process.exit(0);
}

let existing = null;
try {
  existing = readFileSync(OUT_FILE, "utf8");
} catch {
  // missing -> write it
}

if (checkOnly) {
  if (existing !== content) {
    console.error(`drift: ${path.relative(ROOT, OUT_FILE)} is out of date (${sortedKeys.length} keys).`);
    console.error("fix:    npm run gen:building-anchors");
    process.exit(1);
  }
  console.log(`building anchor overrides up to date (${sortedKeys.length} keys).`);
  process.exit(0);
}

if (existing === content) {
  console.log(`building anchor overrides unchanged (${sortedKeys.length} keys).`);
  process.exit(0);
}

mkdirSync(path.dirname(OUT_FILE), { recursive: true });
writeFileSync(OUT_FILE, content);
console.log(`wrote ${path.relative(ROOT, OUT_FILE)} (${sortedKeys.length} keys, ${Object.keys(measured).length} measured from PNG).`);
