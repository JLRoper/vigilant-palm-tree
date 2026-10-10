import { existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ASSETS_DIR,
  SPRITE_FILES,
} from "./manifest.mjs";

const outDir = join(process.cwd(), ASSETS_DIR);

let errors = 0;

console.log("Validating sprite assets...\n");

for (const file of SPRITE_FILES) {
  const fullPath = join(outDir, file);
  if (!existsSync(fullPath)) {
    console.error(`  MISSING: ${file}`);
    errors++;
  }
}

if (errors > 0) {
  console.error(`\n${errors} missing sprite file(s).`);
  process.exit(1);
}

console.log(`  All ${SPRITE_FILES.length} registered sprites present.\n`);

// Building sprite keys are generated from the PNGs on disk; drift means the
// committed list and the art folder disagree (a blank tile or dead art).
console.log("Validating generated building sprite keys...\n");
{
  const genTool = fileURLToPath(new URL("./gen-building-sprite-keys.mjs", import.meta.url));
  const res = spawnSync(process.execPath, [genTool, "--check"], { stdio: "inherit" });
  if (res.error || res.status !== 0) {
    errors++;
  }
  console.log("");
}

const horseRoot = join(process.cwd(), "src", "resources", "units", "horse");
const tuneTool = fileURLToPath(new URL("./tune-run-frames.mjs", import.meta.url));
const pairs = [];

if (existsSync(horseRoot)) {
  for (const entry of readdirSync(horseRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(horseRoot, entry.name);
    for (const name of readdirSync(dir)) {
      if (!name.endsWith("-2.png")) continue;
      const baseName = `${name.slice(0, -6)}.png`;
      const basePath = join(dir, baseName);
      if (!existsSync(basePath)) {
        console.error(`  MISSING: ${join(entry.name, baseName)}`);
        errors++;
        continue;
      }
      pairs.push(basePath, join(dir, name));
    }
  }
}

if (pairs.length === 0 && errors === 0) {
  console.log("  No run frames found (descriptors fall back to base sprites).\n");
} else if (pairs.length > 0) {
  console.log("Validating run-frame alignment...\n");
  const res = spawnSync(process.execPath, [tuneTool, ...pairs, "--check"], { stdio: "inherit" });
  if (res.error || res.status !== 0) {
    errors++;
  }
  console.log("");
}

if (errors > 0) {
  console.error(`\n${errors} asset validation error(s).`);
  process.exit(1);
}

console.log("Asset validation passed.");
