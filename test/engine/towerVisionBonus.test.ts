// The Tower's `visionRangeBonus` was a DEAD FIELD, and the build card sold it.
//
// Measured on main 0.53.0 (2cf527c): the registry declared `playerEffects:
// { visionRangeBonus: 2 }` on `tower`, `buildingPlayerEffects` scaled it by
// level, `computeSettlementBonuses` / `computePlayerBonuses` summed it, and BOTH
// build-card surfaces printed `+2 vision range` -- while nothing in the game
// applied it. A seat's vision is assembled from hero rings (`HERO_VISION_RANGE`
// = 4), its owned settlements' `controlRange(level, buildings)` and caravans
// (`src/render/fog.ts` computeVision/computeVisionFromState/isTileVisibleTo and
// `packages/engine/src/reveal.ts` visionKeysForPlayer); `controlRange` reads
// `controlRangeBonus` only, and `computePlayerBonuses` has no production caller
// at all. So a purchased Tower widened a player's fog by exactly nothing.
//
// The fix deletes the field end to end (registry, both aggregators, both card
// lines) rather than wiring it into the vision computation: wiring it would
// enlarge the fog ring -- and the PERSISTED `revealedTiles` of an uncharted
// game -- of every settlement holding a Tower, a game-wide behaviour change the
// card never asked for. Deleting it is behaviour-identical to main.
//
// This pin is a source scan plus the engine's own numbers, so re-adding the
// field in ANY layer (registry, aggregator, card) fails here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { BuildingDef, CastleLevel } from "@heroes/contracts";
import {
  buildingPlayerEffects,
  computePlayerBonuses,
  computeSettlementBonuses,
} from "@heroes/engine";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const BONUS_FIELD = "visionRangeBonus";
const CARD_MODULES = [
  "src/screens/settlements/cityView/buildingMenu.ts",
  "src/screens/settlements/cityView/buildingSelectionMenu.ts",
];

/** Every `.ts` under a source tree, as repo-relative POSIX paths. */
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

function tower(level: CastleLevel): BuildingDef {
  return { gx: 0, gy: 0, kind: "tower", level, style: "pixel" };
}

test("the Tower grants the engine no vision bonus at any level", () => {
  for (const level of [1, 2, 3] as CastleLevel[]) {
    const pe = buildingPlayerEffects("tower", level);
    assert.ok(
      !(BONUS_FIELD in pe),
      `buildingPlayerEffects("tower", ${level}) must not carry a ${BONUS_FIELD}: nothing applies it`,
    );
  }
});

test("no aggregated bonus carries a vision field", () => {
  const settlement = computeSettlementBonuses([tower(3)]);
  assert.ok(
    !(BONUS_FIELD in settlement),
    `computeSettlementBonuses must not carry a ${BONUS_FIELD} (got ${JSON.stringify(settlement)})`,
  );
  const player = computePlayerBonuses([{ buildings: [tower(3)] }]);
  assert.ok(
    !(BONUS_FIELD in player),
    `computePlayerBonuses must not carry a ${BONUS_FIELD} (got ${JSON.stringify(player)})`,
  );
});

test(`no source file declares or reads ${BONUS_FIELD}`, () => {
  assert.ok(FILES.length > 100, `the scan inspected real source (${FILES.length} files)`);
  const offenders = FILES.filter((f) => readFileSync(`${ROOT}${f}`, "utf8").includes(BONUS_FIELD));
  assert.deepEqual(
    offenders,
    [],
    `${BONUS_FIELD} must not exist anywhere: it was declared, aggregated and applied by nothing`,
  );
});

test("neither build-card surface prints a vision-range line", () => {
  for (const module of CARD_MODULES) {
    const src = readFileSync(`${ROOT}${module}`, "utf8");
    assert.doesNotMatch(
      src,
      /vision range/,
      `${module} must not sell a vision bonus the game does not apply`,
    );
  }
});
