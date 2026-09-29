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
export const SURRENDER_COST_GOLD = 500;
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

// Legacy flat ranged range, kept for callers that predate the per-unit
// range stat. The manual battle engine now reads UnitType.range per platoon
// via platoonRange() (combat/manualBattle.ts); missing catalog stats default
// to 1 there, not to this value.
export const RANGED_ATTACK_RANGE = 6;

// ── Morale & fatigue (docs/morale-fatigue-plan.md) ──────────────────────────
// Per-platoon battle stats, both clamped to 0-100: fatigue starts at 0 and
// accrues per action, morale starts at 100 and moves on casualties, kills
// and adjacent ally deaths. First-pass values — a platoon that swings every
// round gains roughly +10 fatigue net of turn-start decay (twice that when
// counterattacked, since each swing counts), so it lands mid-battle visibly
// degraded but nowhere near the 0.65 floor, and an uneven fight breaks
// morale in ~5 heavy hits without an even fight ever getting there. Owner
// tuning pass can retune freely; nothing inlines these numbers.

// Accrual per applied action. Both engines accrue attacks inside
// resolveAttack (so counterattacks count); moves accrue in the manual
// battle's movePlatoon — the auto-resolver never moves.
export const FATIGUE_PER_MOVE = 6;
export const FATIGUE_PER_ATTACK = 15;
// Recovered at the start of each platoon's own turn.
export const FATIGUE_DECAY_PER_TURN = 5;
// Attack AND defense scaling: multiplier falls linearly from 1 (fresh) to
// 1 - FATIGUE_MAX_PENALTY at fatigue 100.
export const FATIGUE_MAX_PENALTY = 0.35;

// Morale deltas. Casualties: per unit the platoon itself lost. Adjacent
// death: same-side platoons standing next to a destroyed ally. Kill: the
// platoon that destroyed an enemy platoon.
export const MORALE_LOSS_PER_CASUALTY = 2;
export const MORALE_LOSS_PER_ADJACENT_DEATH = 10;
export const MORALE_GAIN_PER_KILL = 10;
// Attack-only scaling (defense is discipline, not spirit): multiplier falls
// linearly from 1 (morale 100) to 1 - MORALE_MAX_ATTACK_PENALTY at 0.
export const MORALE_MAX_ATTACK_PENALTY = 0.3;
// Below this morale the "auto" retreat policy's self-retreat HP threshold is
// raised by MORALE_RETREAT_THRESHOLD_REDUCTION (clamped at 1): a demoralized
// platoon is pulled off the field EARLIER — low morale makes troops rout
// before they are ground down (owner decision 2026-09-27, overriding the
// plan's literal "lowers the threshold" wording).
export const MORALE_LOW_THRESHOLD = 30;
export const MORALE_RETREAT_THRESHOLD_REDUCTION = 0.15;

// ── Spellcasting v1 (docs/spellcasting-plan.md) ─────────────────────────────
// Owner-locked formulas (2026-09-27): Intelligence sizes the mana pool,
// Arcane sizes spell power, mana is the only cast limiter, and mana refills
// fully on the overworld day tick. Definitions live in combat/spells.ts.

// heroMaxMana = intelligence × MANA_PER_INTELLIGENCE.
export const MANA_PER_INTELLIGENCE = 10;
// Damage-spell magnitude = arcane × SPELL_POWER_PER_ARCANE (flat — a spell
// skips the atk/def ratio and the type multiplier entirely).
export const SPELL_POWER_PER_ARCANE = 5;
// Fixed v1 starting stats for heroes that don't carry their own (old saves
// are backfilled with these at hydrate; leveling/progression is later).
export const DEFAULT_HERO_INTELLIGENCE = 2;
export const DEFAULT_HERO_ARCANE = 2;
// Mana cost of one cast — shared by both v1 spells (one tuning knob per the
// roadmap's "mana cost vs. pool size" limiter). With the default Int 2 pool
// of 20, a hero gets two casts per full bar.
export const SPELL_MANA_COST = 10;
// Bless: timed attack multiplier applied to one friendly platoon via
// Combatant.activeEffects, expiring (inclusive) at expiresRound.
export const SPELL_BUFF_MULTIPLIER = 1.5;
export const SPELL_BUFF_DURATION_ROUNDS = 3;
// Flat v1 hero combat stats for the hero info panel — HeroState carries no
// per-hero attack/defence yet (units do; the hero's own stats are a
// progression feature), so the panel shows these constants instead.
export const HERO_BASE_ATTACK = 2;
export const HERO_BASE_DEFENCE = 2;
