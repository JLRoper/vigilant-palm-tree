// Adversarial test for the dependency-cruiser regex fix: confirm that
// importing `src/render/cityBuildingDraw.ts` (the barrel) from inside
// paint2d/ is now caught. The previous regex had `cityBuildingDraw\\.ts`
// inside the alternation, which combined with the trailing `\\.(ts|$)` to
// effectively require `cityBuildingDraw.ts.ts` -- so the barrel was
// slipping through. This test writes a temporary paint2d file that
// imports the barrel, then invokes dep-cruiser directly and confirms the
// rule fires.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

test("dependency-cruiser paint2d rule catches cityBuildingDraw.ts barrel imports (regression test for the regex bug)", () => {
  const probeDir = "src/render/scene/paint2d/__barrel_probe__";
  if (existsSync(probeDir)) rmSync(probeDir, { recursive: true });
  mkdirSync(probeDir, { recursive: true });

  // The probe file imports the barrel. The rule should flag the import
  // path as a violation -- whether the import *resolves* statically is
  // irrelevant to the boundary check.
  const probeFile = join(probeDir, "probe.ts");
  writeFileSync(
    probeFile,
    `import { drawBuilding } from "../../../cityBuildingDraw";\n` +
      `export const _probe = drawBuilding;\n`,
  );

  try {
    const result = spawnSync(
      "npx",
      ["depcruise", "src", "--config", "dependency-cruiser.cjs"],
      { encoding: "utf8", shell: true },
    );
    const out = (result.stdout || "") + (result.stderr || "");
    assert.ok(
      out.includes("paint2d-cannot-import-asset-descriptors"),
      `depcruiser should flag the barrel import. Output:\n${out}`,
    );
    assert.ok(
      out.includes("cityBuildingDraw"),
      `depcruiser output should mention the offending path. Output:\n${out}`,
    );
  } finally {
    rmSync(probeDir, { recursive: true });
  }
});

