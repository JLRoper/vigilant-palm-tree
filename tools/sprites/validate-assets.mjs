import { existsSync } from "node:fs";
import { join } from "node:path";
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
console.log("Asset validation passed.");
