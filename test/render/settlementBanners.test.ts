// Settlement banner coverage: every tier has its own art, the art is on disk,
// and no caller can bypass the fallback.
//
// The reported bug was "sometimes the settlement banner doesn't show
// properly". Three things have to hold for that not to happen, and each has
// been a real failure mode elsewhere in this repo:
//
//   1. Every CastleLevel (1/2/3) has an entry. A missing tier renders an <img>
//      with no src in the settlement panel and an invalid `url(undefined)`
//      inside the roster row's `background` shorthand -- which drops the whole
//      declaration, so the row loses its gradient too.
//   2. The entry points at a file that is actually there, and is a real PNG.
//      (buildingSpriteCoverage.test.ts's blank-tile bug class, same shape.)
//   3. The three tiers are three DIFFERENT files: a copy-paste that points a
//      higher tier at tier-1 art shows a village banner over a castle and
//      looks like "the wrong banner", not a missing one.
//
// Like buildingSpriteKeys.test.ts, this file does NOT import
// src/render/assetDescriptors.ts: that module uses Vite `?url` imports, which
// crash under bare node:test. The client side is asserted with a source scan.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ASSET_DESCRIPTORS = fileURLToPath(new URL("../../src/render/assetDescriptors.ts", import.meta.url));
const RESOURCES_DIR = fileURLToPath(new URL("../../src/resources/", import.meta.url));
const SRC_DIR = fileURLToPath(new URL("../../src/", import.meta.url));

// sourceFiles() builds forward-slash paths (it walks by hand); fileURLToPath
// hands back the platform separator. Compare in one shape.
const posix = (path: string): string => path.replace(/\\/g, "/");

const LEVELS = [1, 2, 3] as const;

const descriptorSource = readFileSync(ASSET_DESCRIPTORS, "utf8");

function recordBody(name: string): string {
  const start = descriptorSource.indexOf(`export const ${name}`);
  assert.ok(start >= 0, `${name} is no longer declared in assetDescriptors.ts`);
  const end = descriptorSource.indexOf("};", start);
  assert.ok(end > start, `${name} has no closing brace`);
  return descriptorSource.slice(start, end);
}

/** level -> the identifier the record maps it to. */
function bannerIdentifiers(): Record<number, string> {
  const body = recordBody("SETTLEMENT_BANNERS");
  const out: Record<number, string> = {};
  for (const m of body.matchAll(/^\s*(\d+):\s*([A-Za-z_][A-Za-z0-9_]*),?\s*$/gm)) {
    out[Number(m[1])] = m[2];
  }
  return out;
}

/** identifier -> the file it was imported from, relative to src/resources/. */
function resourceImports(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of descriptorSource.matchAll(/^import\s+([A-Za-z_][A-Za-z0-9_]*)\s+from\s+"\.\.\/resources\/([^"?]+)\?url";/gm)) {
    out[m[1]] = m[2];
  }
  return out;
}

function pngSize(path: string): { width: number; height: number } {
  const buf = readFileSync(path);
  assert.ok(buf.length > 24, `${path} is too small to be a PNG`);
  const signature = buf.subarray(0, 8).toString("hex");
  assert.equal(signature, "89504e470d0a1a0a", `${path} is not a PNG`);
  // IHDR width/height are the two big-endian uint32s at offset 16.
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = `${dir}${entry}`;
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(`${full}/`));
    } else if (entry.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

test("every CastleLevel has a banner entry", () => {
  const identifiers = bannerIdentifiers();
  for (const level of LEVELS) {
    assert.ok(identifiers[level], `settlement level ${level} has no banner in SETTLEMENT_BANNERS`);
  }
});

test("every banner entry resolves to a PNG that is on disk and not blank", () => {
  const identifiers = bannerIdentifiers();
  const imports = resourceImports();
  for (const level of LEVELS) {
    const identifier = identifiers[level];
    const file = imports[identifier];
    assert.ok(file, `SETTLEMENT_BANNERS[${level}] -> "${identifier}" is not imported with ?url`);
    const path = `${RESOURCES_DIR}${file}`;
    assert.doesNotThrow(() => statSync(path), `${file} (level ${level}) is missing from src/resources/`);
    const { width, height } = pngSize(path);
    assert.ok(width > 0 && height > 0, `${file} (level ${level}) has zero dimensions`);
    assert.ok(
      width >= 100 && height >= 30,
      `${file} (level ${level}) is ${width}x${height} -- too small to be a banner`,
    );
  }
});

test("the three tiers are three different images", () => {
  const identifiers = bannerIdentifiers();
  const imports = resourceImports();
  const files = LEVELS.map((level) => imports[identifiers[level]]);
  assert.equal(new Set(files).size, LEVELS.length, `banner files are not distinct: ${files.join(", ")}`);
});

test("no call site reads SETTLEMENT_BANNERS directly, so the level fallback cannot be bypassed", () => {
  // An out-of-range level reaching `SETTLEMENT_BANNERS[level]` is `undefined`:
  // a broken <img> in the panel, an invalid background shorthand in the
  // roster. settlementBannerUrl() is the one read that falls back.
  const offenders: string[] = [];
  for (const path of sourceFiles(SRC_DIR)) {
    if (posix(path) === posix(ASSET_DESCRIPTORS)) continue;
    const text = readFileSync(path, "utf8");
    if (/SETTLEMENT_BANNERS\s*\[/.test(text)) offenders.push(posix(path).replace(posix(SRC_DIR), "src/"));
  }
  assert.deepEqual(offenders, [], "read banners through settlementBannerUrl() instead");
});
