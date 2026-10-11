// The exhaustive sprite-coverage invariant.
//
// `packages/engine/src/buildingSpriteCoverage.ts` declares a sprite key (or a
// reasoned absence) for every BuildingKind at levels 1-3. Two things make that
// real rather than decorative, and both are pinned here:
//
//   1. The type. `BUILDING_SPRITE_COVERAGE` is a `Record<BuildingKind, ...>`, so
//      adding a kind to the contracts union is a compile error until it is
//      declared. That half of the guarantee is enforced by `tsc`, not by this
//      file -- but a test is what stops someone loosening the type.
//   2. The content. Every declared key must actually be in the generated key
//      list, and every `null` level must carry a reason.
//
// The blank-tile bug class this closes: crypt-2, gunnersRedoubt-2 and
// worldrootGrove-2 each shipped with no sprite key, and each was fixed by hand
// only after someone noticed a hole in the city view.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  BUILDING_SPRITE_COVERAGE,
  BUILDING_SPRITE_LEVELS,
  buildingSpriteKey,
  spriteCoverageProblems,
  type BuildingSpriteCoverage,
} from "../../packages/engine/src/buildingSpriteCoverage";
import { BUILDING_SPRITE_KEYS } from "../../packages/engine/src/generated/buildingSpriteKeys";
import type { BuildingKind } from "../../packages/contracts/src";

const COVERAGE_SRC = readFileSync(
  fileURLToPath(new URL("../../packages/engine/src/buildingSpriteCoverage.ts", import.meta.url)),
  "utf8",
);

function declaredKindsFromSource(): string[] {
  // Every `kind: full("kind")` or bare `kind:` entry at the top level of the
  // coverage record.
  const kinds = new Set<string>();
  for (const m of COVERAGE_SRC.matchAll(/^\s{2}([a-zA-Z][a-zA-Z0-9]*):\s*(?:full\(|mine:|\{)/gm)) {
    kinds.add(m[1]);
  }
  return [...kinds].sort();
}

test("every BuildingKind in the contracts union is declared in the coverage map", () => {
  // Read the union straight from the source of truth rather than trusting a
  // hand-maintained list: this is the check that catches a newly added kind
  // before someone remembers to give it art.
  const contractsSrc = readFileSync(
    fileURLToPath(new URL("../../packages/contracts/src/buildings.ts", import.meta.url)),
    "utf8",
  );
  const unionBody = contractsSrc.slice(
    contractsSrc.indexOf("export type BuildingKind ="),
    contractsSrc.indexOf("export interface BuildingDef"),
  );
  const unionKinds = [...unionBody.matchAll(/^\s*\|\s*"([a-zA-Z][a-zA-Z0-9]*)"/gm)].map((m) => m[1]);

  assert.ok(unionKinds.length >= 30, `expected ~36 BuildingKind members, found ${unionKinds.length}`);

  const missing = unionKinds.filter((k) => !(k in BUILDING_SPRITE_COVERAGE));
  assert.deepEqual(
    missing,
    [],
    "these BuildingKind values have no sprite coverage declared -- add them to " +
      "packages/engine/src/buildingSpriteCoverage.ts (a level may be null only with a reason)",
  );
});

test("the coverage map declares nothing that is not a BuildingKind", () => {
  // Guards against a typo'd kind silently creating a phantom entry that the
  // Record<BuildingKind, ...> type would have rejected if it were typed by key.
  const known = new Set(Object.keys(BUILDING_SPRITE_COVERAGE));
  const fromSource = declaredKindsFromSource();
  assert.ok(fromSource.length >= 30, `expected ~36 declared kinds, found ${fromSource.length}`);
  const phantom = fromSource.filter((k) => !known.has(k));
  assert.deepEqual(phantom, []);
});

test("no sprite coverage problems: every declared key is registered, every null level has a reason", () => {
  const problems = spriteCoverageProblems();
  if (problems.length > 0) {
    const lines = problems.map((p) => `  ${p.problem}: ${p.detail}`);
    assert.fail(
      `sprite coverage is broken -- a building level would draw nothing:\n${lines.join("\n")}\n` +
        "Fix: add the art (then npm run gen:sprite-keys), or record a reason for the gap.",
    );
  }
});

test("every kind covers all three levels, and each level is either a key or a reasoned null", () => {
  for (const [kind, coverage] of Object.entries(BUILDING_SPRITE_COVERAGE) as Array<
    [BuildingKind, BuildingSpriteCoverage]
  >) {
    for (const level of BUILDING_SPRITE_LEVELS) {
      const key = coverage.keys[level];
      if (key === null) {
        assert.ok(
          coverage.reasons?.[level],
          `${kind} L${level} is null without a reason -- a silent gap is the bug this file exists to prevent`,
        );
      } else {
        assert.ok(
          BUILDING_SPRITE_KEYS.includes(key),
          `${kind} L${level} -> "${key}" is not a registered sprite key`,
        );
      }
    }
  }
});

test("buildingSpriteKey resolves declared keys and rejects out-of-range levels", () => {
  assert.equal(buildingSpriteKey("house", 1), "pixel.house.1");
  assert.equal(buildingSpriteKey("house", 3), "pixel.house.3");
  assert.equal(buildingSpriteKey("house", 0), null);
  assert.equal(buildingSpriteKey("house", 4), null);
  // The generic `mine` kind is covered through the alias table.
  assert.equal(buildingSpriteKey("mine", 2), "pixel.mine.2");
});

test("underConstruction is deliberately not a BuildingKind and so has no coverage entry", () => {
  assert.ok(!("underConstruction" in BUILDING_SPRITE_COVERAGE));
  // ...but its art IS registered, which is what the painter resolves against.
  for (const stage of [1, 2, 3]) {
    assert.ok(
      BUILDING_SPRITE_KEYS.includes(`pixel.underConstruction.${stage}`),
      `underConstruction stage ${stage} art is missing`,
    );
  }
});
