import type { Axial, SpellId } from "@heroes/contracts";
import type { Platoon, PlatoonEntry, UnitType } from "../units";

export type BattleSide = "attacker" | "defender";

export interface BattleHex extends Axial {
  impassable: boolean;
}

export interface BattleGrid {
  cols: number;
  rows: number;
  hexes: BattleHex[];
}

// A live combatant occupying one battle-grid hex for the duration of the
// fight. slotIndex ties it back to the owning hero's ARMY_STACK_SLOTS index
// so results can be re-applied to HeroState.stacks. A platoon's entries
// always act together (see "Army model: platoons" in the feature plan) —
// there's no per-entry positioning or retreat.
export interface Combatant {
  side: BattleSide;
  slotIndex: number;
  position: Axial;
  entries: PlatoonEntry[];
  maxHealth: number;
  // Refills to true at the start of this platoon's own turn; flips to false
  // the moment it spends a counterattack. See "Counterattacks (resolved)".
  hasCounterCharge: boolean;
  // Live battle stats, 0-100: morale starts at 100, fatigue at 0. Accrual,
  // decay and the damage multipliers they feed live in combatConfig.ts and
  // damage.ts; every change is mirrored into the log as a morale_change
  // entry so both stats stay re-derivable from the battle log alone.
  morale: number;
  fatigue: number;
  // Timed spell buffs currently on this platoon (spellcasting v1 — the
  // plan's open question #5): attack multipliers that apply while the
  // battle's round counter is <= expiresRound. Spellcasting's own
  // Combatant addition — SideModifiers.damageMultiplier is a per-battle
  // static and cannot express a per-platoon timed buff. Pruned at round
  // boundaries by the manual battle engine; applied inside resolveAttack.
  activeEffects: ActiveSpellEffect[];
  retreated: boolean;
}

// One timed spell buff on a Combatant (the locked v1 shape from the
// roadmap): a damage multiplier that stays active through expiresRound.
export interface ActiveSpellEffect {
  multiplier: number;
  expiresRound: number;
}

export type CombatantOutcome =
  | "won"
  | "lost_all_troops"
  | "retreated_self"
  | "retreated_hero"
  | "survived";

// A plain weapon-swing effect — the original resolveAttack() output. The
// seam a future ability layer (heal/regen/AoE) extends with new effect
// kinds without restructuring the turn loop; spellcasting v1 adds the two
// spell kinds below.
export interface DamageEffect {
  kind: "damage";
  side: BattleSide; // the attacking combatant's side
  attackerSlot: number;
  targetSlot: number;
  damage: number;
  advantageBonus: boolean;
  disadvantagePenalty: boolean;
  casualties: PlatoonEntry[];
  isCounterattack: boolean;
}

// "Magic Arrow" — flat damage (arcane × SPELL_POWER_PER_ARCANE) applied via
// applyCasualties(), deliberately skipping the atk/def ratio and the type
// multiplier: a spell is not a unit-vs-unit matchup.
export interface SpellDamageEffect {
  kind: "spell_damage";
  spell: SpellId;
  side: BattleSide; // the casting hero's side
  targetSlot: number;
  damage: number;
  casualties: PlatoonEntry[];
  manaSpent: number;
}

// "Bless" — a timed attack multiplier attached to one friendly platoon's
// activeEffects; the log entry records the attached effect so the battle
// log alone re-derives when the buff was live.
export interface SpellBuffEffect {
  kind: "spell_buff";
  spell: SpellId;
  side: BattleSide;
  targetSlot: number;
  multiplier: number;
  expiresRound: number;
  manaSpent: number;
}

// The result of a single resolveAttack() / castSpell() call — the seam a
// future ability layer (heal/regen/AoE) can extend with new effect kinds
// without restructuring the turn loop.
export type CombatEffect = DamageEffect | SpellDamageEffect | SpellBuffEffect;

// Why a morale_change entry was written: casualties the platoon took, a kill
// it scored, an adjacent ally being destroyed, or fatigue accrual from a
// move / attack / own-turn-start recovery.
export type MoraleFatigueReason =
  | "casualties"
  | "kill"
  | "ally_destroyed"
  | "move"
  | "attack"
  | "turn_start";

export type BattleLogEntry =
  | ({ round: number } & CombatEffect)
  | { round: number; kind: "self_retreat"; side: BattleSide; slotIndex: number; casualties: PlatoonEntry[] }
  | { round: number; kind: "hero_retreat"; side: BattleSide }
  // Every morale/fatigue mutation, carrying the signed deltas applied this
  // event plus the resulting (clamped) values — the battle log alone is
  // enough to replay both stats (roadmap coordination rule 2).
  | {
      round: number;
      kind: "morale_change";
      side: BattleSide;
      slotIndex: number;
      moraleDelta: number;
      fatigueDelta: number;
      morale: number;
      fatigue: number;
      reason: MoraleFatigueReason;
    }
  // Every spell cast, with enough context (spell id, caster side, target
  // slot, effect magnitude, mana spent) for the battle_actions stream to
  // audit/re-simulate it (roadmap coordination rule 2). Damage spells also
  // carry the casualties the flat damage caused.
  | {
      round: number;
      kind: "spell_cast";
      spell: SpellId;
      side: BattleSide;
      targetSlot: number;
      manaSpent: number;
      damage?: number;
      multiplier?: number;
      expiresRound?: number;
      casualties: PlatoonEntry[];
    }
  | { round: number; kind: "stalemate"; detail: string };

export interface CombatantResult {
  slotIndex: number;
  platoon: Platoon;
  outcome: CombatantOutcome;
  casualties: PlatoonEntry[];
}

export interface BattleResult {
  winner: BattleSide | "draw";
  attackerOutcome: CombatantOutcome;
  defenderOutcome: CombatantOutcome;
  attackerPlatoons: Platoon[];
  defenderPlatoons: Platoon[];
  attackerResults: CombatantResult[];
  defenderResults: CombatantResult[];
  // Fractional Renown/morale deltas (e.g. -0.5 = lose 50%) for a future
  // reputation system to apply — this engine only emits them, see
  // feature-plans/CombatResolutionEngine.md "Out of scope".
  attackerRenownDelta: number;
  defenderRenownDelta: number;
  rounds: number;
  log: BattleLogEntry[];
  grid: BattleGrid;
  obstacleSeed: number;
}

// A caller-suppliable decision policy, invoked once per side at the end of
// every round. "auto" lets the resolver retreat on the caller's behalf using
// HP-percentage thresholds; "custom" hands control to the caller (e.g. a
// future battle-screen UI) so a human can choose retreats interactively by
// re-invoking resolveBattle round-by-round. "fight" (default) never retreats.
export type RetreatPolicy =
  | { kind: "fight" }
  | { kind: "auto"; selfRetreatHpPct: number; heroRetreatHpPct: number }
  | { kind: "custom"; decide: (snapshot: BattleSnapshot, side: BattleSide) => RetreatDecision[] };

export interface RetreatDecision {
  slotIndex: number;
  scope: "platoon" | "hero";
}

export interface BattleSnapshot {
  round: number;
  attacker: Combatant[];
  defender: Combatant[];
}

// A multiplier hook for future modifiers (e.g. Day/Night, #6 in
// implementation-order.md) — 1 = no effect. This engine doesn't compute it,
// just applies whatever the caller passes in.
export interface SideModifiers {
  damageMultiplier: number;
}

export interface ResolveBattleOptions {
  unitTypes: Record<string, UnitType>;
  // Obstacle layout: either reroll from a seed (default path) or reuse a
  // previously-scouted layout. See "Battle grid: size, obstacles &
  // scouting" — the scouting item itself is out of scope for this engine.
  obstacleSeed?: number;
  fixedObstacles?: BattleHex[];
  // Which side deploys on the left (q=0) column; defaults to attacker. Lets
  // whoever scouted the tile choose their starting side.
  sideChoice?: BattleSide;
  grid?: { cols: number; rows: number; obstacleCount?: number };
  attackerRetreatPolicy?: RetreatPolicy;
  defenderRetreatPolicy?: RetreatPolicy;
  attackerModifiers?: SideModifiers;
  defenderModifiers?: SideModifiers;
  maxRounds?: number;
}
