// Tunable numbers for the combat resolver, kept in one place per
// feature-plans/CombatResolutionEngine.md "Tunability" so a balance pass is
// a one-file edit, not a resolver-logic change.

export type AdvantageType = "infantry" | "cavalry" | "ranged" | "monster";

// infantry beats cavalry, cavalry beats ranged, ranged beats infantry.
// "monster" is a deliberate one-way exception layered on top of the
// triangle (see TYPE_ADVANTAGE_MULTIPLIER below) rather than a fourth node
// in it, so it's mapped to null here.
export const TYPE_TRIANGLE: Record<AdvantageType, AdvantageType | null> = {
  infantry: "cavalry",
  cavalry: "ranged",
  ranged: "infantry",
  monster: null,
};

// Advantaged attacker: ATK × this. Disadvantaged attacker (hitting the type
// that beats theirs): ATK × TYPE_DISADVANTAGE_MULTIPLIER (the same 30% in
// reverse). Monster-tagged units always get the advantage multiplier
// attacking any base tag, and never take the disadvantage multiplier
// (nothing in TYPE_TRIANGLE points at "monster").
export const TYPE_ADVANTAGE_MULTIPLIER = 1.3;
export const TYPE_DISADVANTAGE_MULTIPLIER = 2 - TYPE_ADVANTAGE_MULTIPLIER;

export const PLATOON_RETREAT_LOSS = 0.15;
export const HERO_RETREAT_PENALTY = 0.5;

export const DEFAULT_GRID_COLS = 15;
export const DEFAULT_GRID_ROWS = 11;
export const DEFAULT_OBSTACLE_COUNT = 8;
export const DEFAULT_MAX_ROUNDS = 30;
