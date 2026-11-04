// The construction crew's ONE ceiling, pinned as a source invariant.
//
// The build-crew rule puts a hard ceiling of 4 builders on every site whatever
// its kind, and the design document's checklist (#23) demands that the 4 exist
// ONCE -- as `CONSTRUCTION_MAX_BUILDERS` in
// `packages/engine/src/settlement/workforce.ts` -- read by the reducer, the
// pool arithmetic, the stepper, the drag gesture, the panels, the scene and the
// AI, rather than re-typed at any of them.
//
// A type cannot carry this: every reader of the ceiling takes a NUMBER, so a
// second `4` compiles perfectly and then drifts -- the exact shape of the
// complaint the analysis raised as I4, where the scene already wrote a bare
// `min(builders, 4)` and the design's own "no bare 4" test would have failed on
// the very line the design asked for. So the pin is a scan of the tree.
//
// What it catches: a new ceiling site that hard-codes 4, a clamp added as
// `Math.min(x, 4)`, an auto-crew default of `workers ?? 4`, and a second
// declaration of the constant itself.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const WORKFORCE_SRC = "packages/engine/src/settlement/workforce.ts";

/** Every .ts under the two source trees, as repo-relative POSIX paths. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(`${ROOT}${dir}`, { withFileTypes: true })) {
    const rel = `${dir}${entry.name}`;
    if (entry.isDirectory()) {
      if (["node_modules", "dist", "generated"].includes(entry.name)) continue;
      out.push(...sourceFiles(`${rel}/`));
    } else if (entry.name.endsWith(".ts") && statSync(`${ROOT}${rel}`).isFile()) {
      out.push(rel);
    }
  }
  return out;
}

const FILES = [...sourceFiles("src/"), ...sourceFiles("packages/")];

/** The files that read a construction crew ceiling -- each must reach it through
 * the constant or one of the helpers that own it, never through a literal. */
const CEILING_READERS = [
  WORKFORCE_SRC,
  "packages/engine/src/settlement/advance.ts",
  "packages/engine/src/settlement/staffWorkers.ts",
  "packages/engine/src/settlement/roadNetwork.ts",
  "packages/engine/src/ai/aiBrain.ts",
  "src/render/scene/sceneBuilder/cityScene.ts",
  "src/screens/settlements/cityView/buildingMenu.ts",
  "src/screens/settlements/cityView/cityView.ts",
  "src/screens/settlements/cityView/siteStatus.ts",
  "src/screens/settlements/cityView/buildEntryStatus.ts",
  "src/screens/settlements/recruitmentPanelModel.ts",
  "src/screens/settlements/workforceRowText.ts",
];

test("the construction ceiling is written ONCE, as a named constant in the engine", () => {
  const declarations = FILES.filter((f) =>
    /CONSTRUCTION_MAX_BUILDERS\s*(?::[^=]+)?=\s*[0-9]/.test(readFileSync(`${ROOT}${f}`, "utf8")),
  );
  assert.deepEqual(
    declarations,
    [WORKFORCE_SRC],
    `CONSTRUCTION_MAX_BUILDERS must be declared once, in ${WORKFORCE_SRC} -- found ${declarations.join(", ") || "none"}`,
  );
  assert.match(
    readFileSync(`${ROOT}${WORKFORCE_SRC}`, "utf8"),
    /export const CONSTRUCTION_MAX_BUILDERS = 4;/,
    "and it is the 4 the design's premise names",
  );
});

/** Every `Math.min(...)` argument list in `src`, as its TOP-LEVEL arguments --
 * matched with balanced parens, so a nested call (`Math.min(buildersOnSite(b),
 * 4)`, the exact shape the analysis named as I4) cannot hide a literal behind a
 * `)` that a regex would stop at. */
function minArgumentLists(src: string): string[][] {
  const out: string[][] = [];
  for (const m of src.matchAll(/Math\.min\(/g)) {
    let i = (m.index ?? 0) + m[0].length;
    let depth = 1;
    const args: string[] = [];
    let current = "";
    for (; i < src.length && depth > 0; i++) {
      const ch = src[i];
      if (ch === "(") depth += 1;
      else if (ch === ")") {
        depth -= 1;
        if (depth === 0) break;
      } else if (ch === "," && depth === 1) {
        args.push(current.trim());
        current = "";
        continue;
      }
      current += ch;
    }
    args.push(current.trim());
    out.push(args);
  }
  return out;
}

test("no other file states a construction crew limit as a bare 4", () => {
  const offenders: string[] = [];
  let minCalls = 0;
  for (const file of FILES) {
    const src = readFileSync(`${ROOT}${file}`, "utf8");
    const lists = minArgumentLists(src);
    minCalls += lists.length;
    // A clamp to a literal 4 -- the shape the scene shipped before this card.
    for (const args of lists) {
      if (args.some((a) => /^4$/.test(a))) offenders.push(`${file}: Math.min(${args.join(", ")})`);
    }
    // An auto-crew / builder default of a bare 4 (`workers ?? 4`).
    src.split("\n").forEach((line, i) => {
      if (/\?\?\s*4\b/.test(line)) offenders.push(`${file}:${i + 1} ${line.trim()}`);
    });
  }
  // The scan has to be looking at real code, or its silence means nothing.
  assert.ok(minCalls > 0, `the scan found Math.min calls to inspect (${minCalls})`);
  assert.deepEqual(
    offenders,
    [],
    "a construction crew limit written as a literal 4 -- use CONSTRUCTION_MAX_BUILDERS, staffingCeiling or buildersOnSite:",
  );
});

test("every reader of the ceiling goes through the constant or a helper that owns it", () => {
  const missing = CEILING_READERS.filter((file) => {
    const src = readFileSync(`${ROOT}${file}`, "utf8");
    return !/CONSTRUCTION_MAX_BUILDERS|staffingCeiling|buildersOnSite|buildRate|stalledConstructionSites/.test(src);
  });
  assert.deepEqual(
    missing,
    [],
    "these files read a construction crew ceiling without the constant or its helpers -- a second ceiling in the making",
  );
});

test("the crew ceiling did NOT leak into the operational cap", () => {
  // `buildingMaxWorkers` stays the PRODUCTION cap: the construction ceiling
  // raises no building's capacity. If a crew limit were ever moved onto the
  // registry's per-kind accessor, `staffingCeiling` would stop being the one
  // place the two ceilings are told apart.
  assert.match(
    readFileSync(`${ROOT}${WORKFORCE_SRC}`, "utf8"),
    /export function staffingCeiling\(b: BuildingDef\): number \{\s*return b\.construction \? CONSTRUCTION_MAX_BUILDERS : buildingMaxWorkers\(b\.kind\);\s*\}/m,
    "staffingCeiling is the one reader that distinguishes the two ceilings",
  );
});
