// RGBA constants the painters need that aren't themed (i.e. injected from
// Paint2DDep). Centralized so the painter files don't sprinkle magic strings --
// and so a future theme can override Paint2DDep without rewriting constants.
//
// All values here are byte-exact with the live renderers. Verified against the
// pre-cutover draw paths during issue #148's painter reconciliation: the
// charter / valid-charter entries below had drifted to invented palettes and
// were the only consumed constants in this file, so a cutover would have
// silently recoloured every charter overlay. A batch of never-consumed
// adventure constants (fog, hover, path, hero trail) had drifted the same way
// and were deleted rather than corrected -- the painters in index.ts carry
// those literals directly, and a second unused copy is exactly how the drift
// happened. If a future theme wants to change any of these, route through
// Paint2DDep.

// Charter defaults, byte-exact with the pre-cutover CharterPainter.ts.
// Injected via Paint2DDep.charterStyle; the literals here are referenced by
// the default-deps builder at src/render/paint2dDefaults.ts, not by the
// painters themselves.
export const DEFAULT_CHARTER_TRAVELING = {
  stroke: "rgba(200, 180, 140, 0.5)",
  fill: "rgba(200, 180, 140, 0.15)",
  lineDash: [4, 4],
  lineWidth: 2,
};
export const DEFAULT_CHARTER_CONSTRUCTING = {
  stroke: "rgba(200, 160, 80, 0.7)",
  fill: "rgba(200, 160, 80, 0.2)",
  lineDash: [],
  lineWidth: 3,
};

// Valid charter-placement hexes, byte-exact with CharterPainter.ts's
// paintValidCharterHexes().
export const VALID_CHARTER_HEX = {
  stroke: "rgba(100, 220, 100, 0.6)",
  fill: "rgba(100, 220, 100, 0.08)",
  lineDash: [3, 3],
  lineWidth: 2,
};

// Battle-view fills/strokes (manualBattleArena.ts's draw()).
export const BATTLE_BG = "#14161a";
export const BATTLE_HEX_FILL = "#20242c";
export const BATTLE_HEX_IMPASSABLE = "#3a2a2a";
export const BATTLE_HEX_IN_RANGE = "rgba(210,210,215,0.35)";
export const BATTLE_HEX_STROKE = "rgba(255,255,255,0.08)";
export const BATTLE_HEX_AVAILABLE_STROKE = "rgba(255,214,102,0.9)";
export const BATTLE_ATTACK_TARGET_STROKE = "#e05050";
export const BATTLE_AI_TELEGRAPH_FILL = "rgba(224,80,80,0.22)";
export const BATTLE_AI_TELEGRAPH_STROKE = "rgba(255,120,120,0.95)";
export const BATTLE_MOVE_PATH = "rgba(255,255,255,0.28)";
export const BATTLE_AI_ACTING_RING = "#ffffff";
export const BATTLE_COMBATANT_ATTACKER = "#3070c0";
export const BATTLE_COMBATANT_ATTACKER_SELECTED = "#5fb0ff";
export const BATTLE_COMBATANT_DEFENDER = "#c04040";
export const BATTLE_COMBATANT_DEFENDER_SELECTED = "#ff7a7a";
export const BATTLE_COMBATANT_STROKE = "#fff";
export const BATTLE_FLOAT_STROKE = "rgba(0,0,0,0.85)";
export const BATTLE_FLOAT_FILL = "rgba(255,214,102,1)";
