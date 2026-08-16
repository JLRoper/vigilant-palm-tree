import type { Axial } from "@heroes/contracts";
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
  retreated: boolean;
}

export type CombatantOutcome =
  | "won"
  | "lost_all_troops"
  | "retreated_self"
  | "retreated_hero"
  | "survived";

// The result of a single resolveAttack() call — the seam a future ability
// layer (heal/regen/AoE) can extend with new effect kinds without
// restructuring the turn loop.
export interface CombatEffect {
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

export type BattleLogEntry =
  | ({ round: number } & CombatEffect)
  | { round: number; kind: "self_retreat"; side: BattleSide; slotIndex: number; casualties: PlatoonEntry[] }
  | { round: number; kind: "hero_retreat"; side: BattleSide }
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
