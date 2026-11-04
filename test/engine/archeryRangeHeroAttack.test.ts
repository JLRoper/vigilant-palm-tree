// The Archery Range's `heroAttackBonus` was a DEAD FIELD, and the build card sold it.
//
// Re-measured on main 0.53.1 (19b42e0) -- not carried over from the Tower row:
//
//   declaration  packages/engine/src/buildingRegistry.ts:287  `playerEffects: { heroAttackBonus: 1 }`
//                (type member at :57; scaled by level at :914 `heroAttackBonus: (... ?? 0) * level`)
//   measured     buildingPlayerEffects("archeryRange", 1|2|3) = heroAttackBonus 1 | 2 | 3
//   aggregation  computeSettlementBonuses([archeryRange L1]) = { ..., heroAttackBonus: 1 }
//                computePlayerBonuses([archeryRange L2])     = { ..., heroAttackBonus: 2 }
//   card line    src/screens/settlements/cityView/buildingMenu.ts:57
//                src/screens/settlements/cityView/buildingSelectionMenu.ts:186
//                  `if (...) lines.push(`+${...} hero attack`)`
//
//   And nothing applied it: the ONLY production reader of that aggregation is
//   `control.ts:81` `range += computeSettlementBonuses(buildings).controlRangeBonus`
//   (controlRange(2, [archeryRange L1]) === 2 -- a control-range-only consumer), and
//   `computePlayerBonuses` has no production caller at all.
//
// The Archery Range's card promised "+1 hero attack" for a number the engine could not pay.
//
// WHY THIS HALF. Same fork as the Tower row, but decided on THIS row's measurement rather than
// by analogy, because here "wire it" is not the cheap half:
//
//   - A hero has no attack stat to add to. `HeroState` (packages/contracts/src/gameState.ts:48-88)
//     carries id/name/ownerId/q/r/movement/trail/gold/troops/stacks/arcane/intelligence/mana/spell/
//     morale -- no attack, no defence. The hero's displayed Attack is the flat constant
//     `HERO_BASE_ATTACK = 2` (packages/engine/src/combatConfig.ts:129), read by exactly one place,
//     the hero info panel (src/screens/heroes/heroInfoMenu.ts:598), and by no combat code.
//   - The battle engine scores PLATOONS, not heroes: `combat/damage.ts:118`
//     `for (const e of attackerEntries) effAttack += (unitTypes[e.unitTypeId]?.attack ?? 0) * e.count`,
//     with `Combatant.entries: PlatoonEntry[]` (combat/types.ts:21-25). There is no hero-attack term
//     in the damage formula.
//
// So wiring it would not be "apply the number we already compute" (which is what the Tower row
// rejected because it would enlarge every Tower holder's fog ring): it would be BUILDING per-hero
// combat stats -- the progression feature `combatConfig.ts:127` says is explicitly later -- and then
// a balance pass over both battle engines, changing combat outcomes for every settlement holding an
// Archery Range. Deleting the field is behaviour-identical to main because nothing read the value,
// and it stops the card selling a bonus the game cannot pay. The Archery Range keeps everything it
// really has (`defenseBonus: 1`, and its archer/crossbowman recruits).
//
// THE OTHER HALF, RECORDED SO IT CAN BE REVERSED BY PREFERENCE. If a maintainer prefers to wire it,
// the seam is where a hero's attack does not yet exist: give `HeroState` an attack stat (fed by
// `HERO_BASE_ATTACK` so the panel and combat finally agree), resolve the player's per-settlement
// attack bonus through `computePlayerBonuses` (today production-dead, so this is the one reader to
// add), and let it reach the attacker side of `computeDamage` (combat/damage.ts) -- then re-declare
// `playerEffects: { heroAttackBonus: 1 }` on `archeryRange`, re-add the aggregation line, and restore
// the `+N hero attack` line on both card surfaces. That is a feature plus a balance check, which is
// why it is not this fix.
//
// This pin is a source scan plus the engine's own numbers, so re-adding the field in ANY layer
// (registry, aggregator, card) fails here.

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
const BONUS_FIELD = "heroAttackBonus";
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

function archeryRange(level: CastleLevel): BuildingDef {
  return { gx: 0, gy: 0, kind: "archeryRange", level, style: "pixel" };
}

test("the Archery Range grants the engine no hero attack bonus at any level", () => {
  for (const level of [1, 2, 3] as CastleLevel[]) {
    const pe = buildingPlayerEffects("archeryRange", level);
    assert.ok(
      !(BONUS_FIELD in pe),
      `buildingPlayerEffects("archeryRange", ${level}) must not carry a ${BONUS_FIELD}: a hero has no attack stat to apply it to`,
    );
  }
});

test("no aggregated player bonus carries a hero attack field", () => {
  const settlement = computeSettlementBonuses([archeryRange(3)]);
  assert.ok(
    !(BONUS_FIELD in settlement),
    `computeSettlementBonuses must not carry a ${BONUS_FIELD} (got ${JSON.stringify(settlement)})`,
  );
  const player = computePlayerBonuses([{ buildings: [archeryRange(2)] }]);
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

test("neither build-card surface prints a hero-attack line", () => {
  for (const module of CARD_MODULES) {
    const src = readFileSync(`${ROOT}${module}`, "utf8");
    assert.doesNotMatch(
      src,
      /hero attack/,
      `${module} must not sell a hero-attack bonus the game does not apply`,
    );
  }
});
