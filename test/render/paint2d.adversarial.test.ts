// Adversarial test for the dependency-cruiser regex fix: confirm that
// importing a forbidden render module from inside paint2d/ is caught. The
// probe used the `src/render/cityBuildingDraw.ts` barrel historically; waves
// 1-2 of the styles removal deleted that file, so the probe now uses the
// still-live `src/render/assetDescriptors.ts` arm of the same rule (the
// seam's load-bearing target). The previous regex had `cityBuildingDraw\.ts`
// inside the alternation, which combined with the trailing `\.(ts|$)` to
// effectively require `cityBuildingDraw.ts.ts` -- so the barrel was slipping
// through. This test writes a temporary paint2d file that imports the
// forbidden module, then invokes dep-cruiser directly and confirms the rule
// fires.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

test("dependency-cruiser paint2d rule catches forbidden render imports from paint2d/ (regression test for the regex bug)", () => {
  const probeDir = "src/render/scene/paint2d/__barrel_probe__";
  if (existsSync(probeDir)) rmSync(probeDir, { recursive: true });
  mkdirSync(probeDir, { recursive: true });

  // The probe file imports the forbidden module. The rule fires on the
  // resolved module path, so the probe target must be a live file.
  const probeFile = join(probeDir, "probe.ts");
  writeFileSync(
    probeFile,
    `import { ALL_DESCRIPTORS } from "../../../assetDescriptors";\n` +
      `export const _probe = ALL_DESCRIPTORS;\n`,
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
      `depcruiser should flag the forbidden import. Output:\n${out}`,
    );
    assert.ok(
      out.includes("assetDescriptors"),
      `depcruiser output should mention the offending path. Output:\n${out}`,
    );
  } finally {
    rmSync(probeDir, { recursive: true });
  }
});
