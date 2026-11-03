import type { CastleLevel, Platoon } from "@heroes/contracts";

/**
 * The garrison a NEUTRAL capital starts with.
 *
 * A neutral settlement is a level-3 castle with nobody sitting in it
 * (map/castlePlacement.ts's levelForIndex gives every unowned castle level 3),
 * and before this table existed it carried no `stacks` at all: walking a hero
 * onto one captured it for free, so six free capitals in the fog were the whole
 * middle game. The garrison is what makes the walk-in refusal at
 * server/app/commandHandler.ts (`garrison_not_defeated`) apply to them, and the
 * assault flow the only way in.
 *
 * Strength, measured rather than guessed (see docs/settlements.md -> Neutral
 * garrisons): one platoon of 12 pikemen (tier 3) + 4 archers (tier 4), power
 * 168. Against the player's starting army (24 troops, power 216) it wins on
 * every obstacle seed tried, and the player clears it after adding ~13
 * swordsmen (2,600g, under one turn of the 3,500g/turn a fresh medium game
 * pays) — a real gate, not a wall. The AI's own attackerBeatsGarrison
 * (GARRISON_ATTACK_RATIO 1.5) declines it rather than suiciding.
 *
 * Deliberately a pure table: no rng draw, so seeding it cannot shift the
 * stream that names, horse variants, city spots and districts are drawn from.
 * `garrisonUpkeep` skips `ownerId === null`, so a neutral garrison never eats
 * and never deserts — it is exactly the army the map was generated with.
 */
export const NEUTRAL_CAPITAL_GARRISON: readonly Platoon[] = [
  { entries: [{ unitTypeId: "pikeman", count: 12 }, { unitTypeId: "archer", count: 4 }] },
];

/**
 * The starting garrison for a neutral settlement of `level`.
 *
 * Only a capital (level 3) is garrisoned: every neutral the generator places
 * is a level-3 castle, and a lower-tier neutral is not a thing the map makes
 * today. Returning `[]` for those levels is the honest statement of that, and
 * the seam a graded map would fill in.
 */
export function neutralGarrisonStacks(level: CastleLevel): Platoon[] {
  if (level !== 3) return [];
  return NEUTRAL_CAPITAL_GARRISON.map((platoon) => ({
    entries: platoon.entries.map((entry) => ({ ...entry })),
  }));
}
