// `heroSpeedBonus` was a DEAD TYPE MEMBER: a field in the `PlayerBonuses` interface and
// both engine aggregators that NO building kind ever declared.
//
// Re-measured on main 8f781c0 (0.53.2) -- the same tree the sibling rows measured:
//
//   declaration  packages/engine/src/buildingRegistry.ts:56  `heroSpeedBonus?: number;`
//                (inside the registry's `playerEffects` type; the scaling accessor at :912
//                 read `heroSpeedBonus: (e.playerEffects.heroSpeedBonus ?? 0) * level`)
//                PlayerBonuses member at buildingModifiers.ts:6, both locals (:11, :24),
//                both accumulations (:15, :28, :32) and both returns (:17, :35).
//   measured     NO kind declares it: 46 registry entries carry `playerEffects: {}` and the
//                one that carries anything (`townHall`) carries `{ controlRangeBonus: 1 }`.
//                So `buildingPlayerEffects(<any kind>, 1|2|3)` returned `heroSpeedBonus: 0`
//                for every kind measured, and `computeSettlementBonuses` /
//                `computePlayerBonuses` returned a `heroSpeedBonus: 0` member.
//   card line    src/screens/settlements/cityView/buildingMenu.ts:56
//                `if (pe.heroSpeedBonus) lines.push(`+${pe.heroSpeedBonus} hero speed`)`
//                -- guarded by the value being truthy, so with no declarer it NEVER fires.
//                `buildingSelectionMenu.ts` never read the field at all: its accumulator at
//                :70 took only `controlRangeBonus` and its printer (:175-192) had no hero
//                speed line. (The 0.53.2 CHANGELOG's "both `+N hero speed` card lines" was
//                wrong about that half -- measured, there was one.)
//
//   And nothing applied it: the ONLY production consumer of the aggregation is
//   `control.ts:81` `range += computeSettlementBonuses(buildings).controlRangeBonus`
//   (control-range only), and `computePlayerBonuses` has no production caller at all.
//   Hero movement is the flat `MOVEMENT_PER_TURN` granted wholesale on recruit/advance/move
//   (hero/move.ts:116, hero/recruit.ts:102, charter/advance.ts:129), so there is no speed
//   stat to add a bonus to.
//
// This is the WEAKER half of the dead-effect family: a field declared by NO kind is not a
// lying card (the line cannot fire) -- it is a dead type member whose only cost is the
// aggregation and a permanently-false branch. Deleted rather than kept "for later" because
// the repo's own lesson is that an unwired parallel implementation is not a safe
// intermediate state. Deleting is behaviour-identical to main because nothing read the
// value.
//
// THE OTHER HALF, RECORDED SO IT CAN BE REVERSED BY PREFERENCE. If a maintainer prefers to
// wire a hero speed bonus, the seam is the movement grant, not the combat formula: give
// `HeroState` a speed multiplier (or resolve one from the player's bonuses at grant time),
// multiply `MOVEMENT_PER_TURN` in `hero/move.ts:116` / `hero/recruit.ts:102` /
// `charter/advance.ts:129`, resolve it through `computePlayerBonuses` (today
// production-dead, so this would be its one reader) -- then re-declare
// `playerEffects: { heroSpeedBonus: n }` on a kind, re-add the aggregation line and the
// `+N hero speed` card line. That changes movement for every settlement holding that kind,
// which needs its own balance measurement -- why it is not this row.
//
// This pin is a source scan plus the engine's own numbers, so re-adding the field in ANY
// layer (registry, aggregator, card) fails here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { BuildingDef, BuildingKind, CastleLevel } from "@heroes/contracts";
import {
  buildingPlayerEffects,
  computePlayerBonuses,
  computeSettlementBonuses,
} from "@heroes/engine";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const BONUS_FIELD = "heroSpeedBonus";
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

/** Every `BuildingKind` the contract union declares, read from its own source. */
function contractKinds(): BuildingKind[] {
  const src = readFileSync(`${ROOT}packages/contracts/src/buildings.ts`, "utf8");
  const start = src.indexOf("export type BuildingKind =");
  const end = src.indexOf("export interface BuildingDef");
  assert.ok(start >= 0 && end > start, "the BuildingKind union must be readable from the contract");
  return [...src.slice(start, end).matchAll(/"([a-zA-Z]+)"/g)].map((m) => m[1] as BuildingKind);
}

const KINDS = contractKinds();

function def(kind: BuildingKind, level: CastleLevel): BuildingDef {
  return { gx: 0, gy: 0, kind, level, style: "pixel" };
}

test("no building kind's player effects carry a hero speed bonus", () => {
  assert.ok(KINDS.length >= 40, `the union was read for real (${KINDS.length} kinds)`);
  for (const kind of KINDS) {
    for (const level of [1, 2, 3] as CastleLevel[]) {
      const pe = buildingPlayerEffects(kind, level);
      assert.ok(
        !(BONUS_FIELD in pe),
        `buildingPlayerEffects("${kind}", ${level}) must not carry a ${BONUS_FIELD}: no kind declared one and nothing applies it`,
      );
    }
  }
});

test("neither aggregated player bonus carries a hero speed field", () => {
  const settlement = computeSettlementBonuses([def("townHall", 1)]);
  assert.ok(
    !(BONUS_FIELD in settlement),
    `computeSettlementBonuses must not carry a ${BONUS_FIELD} (got ${JSON.stringify(settlement)})`,
  );
  const player = computePlayerBonuses([{ buildings: [def("townHall", 2)], districts: { d: { buildings: [def("tower", 3)] } } }]);
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
    `${BONUS_FIELD} must not exist anywhere: it was declared by no kind and read by nothing`,
  );
});

test("neither build-card surface prints a hero-speed line", () => {
  for (const module of CARD_MODULES) {
    const src = readFileSync(`${ROOT}${module}`, "utf8");
    assert.doesNotMatch(
      src,
      /hero speed/,
      `${module} must not sell a hero-speed bonus the game does not apply`,
    );
  }
});
