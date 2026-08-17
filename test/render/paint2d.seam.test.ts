// Seam test: prove that paint2d/ stays pure-importable from node:test / node
// directly (no Vite loader, no .png/?url specifiers). This is the Vite pitfall
// the plan doc and revision note 4 call out -- and the first place the
// painter project would hit it. We re-derive the boundary here independently
// of dep-cruiser as a runtime smoke test, because dep-cruiser only checks
// import strings, not what would actually fail at load time under node:test.
//
// This test is not a substitute for the dependency-cruiser rule; it's a
// defense-in-depth check that the *runtime* module resolution works.

import { test } from "node:test";
import assert from "node:assert/strict";

import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

test("paint2d/ contains no module-scope imports of the Vite-?url-coupled files", async () => {
  const paint2dDir = "src/render/scene/paint2d";
  assert.ok(existsSync(paint2dDir), `paint2d/ is missing at ${paint2dDir}`);

  // The forbidden set is the same one the dep-cruiser rule enforces. We
  // match on the *resolved import path*, not the bare name, so the doc
  // comments in deps.ts mentioning `assetDescriptors` don't trip the test.
  const forbiddenPathRegexes: RegExp[] = [
    /from\s+["'][^"']*\/render\/assetDescriptors/,
    /from\s+["'][^"']*\/render\/assets["']/,
    /from\s+["'][^"']*\/render\/sprites["']/,
    /from\s+["'][^"']*\/render\/cityRenderer/,
    /from\s+["'][^"']*\/render\/cityBuildingDraw["']/,
    /from\s+["'][^"']*\/render\/cityBuildingDraw\/spots/,
  ];

  const files = await allTsFiles(paint2dDir);
  assert.ok(files.length > 0, "paint2d/ should have at least one .ts file");

  for (const file of files) {
    const code = stripComments(await readFile(file, "utf8"));
    for (const re of forbiddenPathRegexes) {
      assert.ok(
        !re.test(code),
        `${file} imports a forbidden Vite-coupled module (pattern: ${re.source})`,
      );
    }
  }
});

test("paint2d/ contains no Vite ?url asset specifiers (the runtime symptom of the pitfall)", async () => {
  const paint2dDir = "src/render/scene/paint2d";
  const files = await allTsFiles(paint2dDir);
  for (const file of files) {
    const code = stripComments(await readFile(file, "utf8"));
    assert.ok(!code.includes("?url"), `${file} contains a Vite ?url asset specifier`);
  }
});

test("paint2d/ does not value-import the state/settings singleton (cleanup-lifecycle concern)", async () => {
  const paint2dDir = "src/render/scene/paint2d";
  const files = await allTsFiles(paint2dDir);
  for (const file of files) {
    const code = stripComments(await readFile(file, "utf8"));
    // Type-only imports are fine; pure value imports are not. Match
    // `import ... from "...settings"` that is NOT preceded by `type`.
    const re = /\bimport\s+(?!type\b)[^;]*?from\s+["'][^"']*settings["']/g;
    const matches = code.match(re) ?? [];
    assert.ok(
      matches.length === 0,
      `${file} value-imports state/settings.ts (forbidden -- use injected getters): ${matches.join(", ")}`,
    );
  }
});

test("paint2d/ can be imported from this test file under bare node:test (the actual seam smoke test)", async () => {
  // If the Vite pitfall leaked, this import would throw at module load time
  // -- the loader would try to resolve `?url` specifiers and fail under
  // node. Currently this is the single most important assertion in the file.
  const mod = await import("../../src/render/scene/paint2d");
  assert.equal(typeof mod.paintScene, "function", "paintScene must be exported");
  assert.equal(typeof mod.paintTerrainHex, "function");
  assert.equal(typeof mod.paintBattleHex, "function");
  assert.equal(typeof mod.paintCityBuilding, "function");
});

test("paint2d/deps.ts can be imported under bare node:test", async () => {
  const mod = await import("../../src/render/scene/paint2d/deps");
  // The dep interface is type-only; we just confirm the module loads.
  assert.ok(mod, "deps.ts module loaded");
});

async function allTsFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await allTsFiles(full)));
    } else if (e.isFile() && e.name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

// Strip // line comments and /* block */ comments so the seam tests don't
// flag doc comments that mention forbidden module names. Strings and regex
// literals are not specially handled -- a "assetDescriptors" inside a string
// would still be flagged, which is the safer default.
function stripComments(src: string): string {
  // Replace block comments with whitespace (preserving newlines so line
  // numbers stay meaningful).
  let out = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  // Strip line comments to end of line.
  out = out.replace(/(^|[^:])\/\/[^\n]*/g, (_m, pre) => pre);
  return out;
}

