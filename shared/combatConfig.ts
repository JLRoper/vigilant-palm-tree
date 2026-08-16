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

// Flat gold price the hero pays to surrender a battle. If they can't cover
// it, the surrender modal (see manualBattleArena.ts) opens a "Leave Behind"
// picker that lets them sacrifice units at SURRENDER_UNIT_VALUE_GOLD each
// until the shortfall is made up — those units are stripped from the
// surviving platoons before the battle finalizes, so they show up as
// casualties on the result card.
export const SURRENDER_COST_GOLD = 5000;
export const SURRENDER_UNIT_VALUE_GOLD = 100;

export const DEFAULT_GRID_COLS = 15;
// Trimmed from 15 to 13 rows to reclaim vertical space for the arena view —
// deploymentPosition() in shared/combat/grid.ts spreads the 8
// ARMY_STACK_SLOTS platoons evenly across however many rows exist, so
// shrinking this no longer requires a matching change there; it just means
// some platoons lose the 1-hex gap that used to separate every slot.
export const DEFAULT_GRID_ROWS = 13;
export const DEFAULT_OBSTACLE_COUNT = 8;
export const DEFAULT_MAX_ROUNDS = 30;

// UnitType has no numeric range stat yet, so the manual battle arena
// (shared/combat/manualBattle.ts) applies this one flat range to any platoon
// whose entries are all advantageType "ranged" — melee/cavalry/monster
// platoons always need hex-adjacency instead.
export const RANGED_ATTACK_RANGE = 6;
