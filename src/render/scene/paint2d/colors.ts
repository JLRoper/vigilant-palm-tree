// RGBA constants the painters need that aren't themed (i.e. injected from
// Paint2DDep). Centralized so the painter files don't sprinkle magic strings --
// and so a future theme can override Paint2DDep without rewriting constants.
//
// All values are byte-exact with the live renderers today: terrain hex
// backgrounds, fog, path reachable/unreachable, hover gold, charter building-icon
// dims, and battle hex tints. If a future theme wants to change any of these,
// route through Paint2DDep instead -- colors.ts is a record of the default
// palette, not a retheme seam.

// Hex stroke "available" overlay tint (adventure: hover highlight outline).
export const HOVER_STROKE = "rgba(255,214,102,0.9)";

// Fog of war (adventure: view-player can't see this hex).
export const FOG_FILL = "rgba(0,0,0,0.55)";
export const FOG_EDGE = "rgba(0,0,0,0.0)";

// Path preview (Overlay/pathOverlay.ts):
// - reachable = a hex the hero can still walk to this turn
// - unreachable = proposed-but-blocked-by-an-obstacle segment
export const REACHABLE_PATH = "rgba(120,255,120,0.85)";
export const UNREACHABLE_PATH = "rgba(255,90,90,0.85)";

// Hero trail (the faint dashed line drawn behind the hero when it's animating).
export const HERO_TRAIL_DOT = "rgba(255,255,255,0.55)";
export const HERO_TRAIL_LINE = "rgba(255,255,255,0.35)";

// Charter defaults (live values today -- injected via Paint2DDep.charterStyle
// for future themes). The literals here are referenced by the default-deps
// builder at src/render/paint2dDefaults.ts, not by the painters themselves.
export const DEFAULT_CHARTER_TRAVELING = {
  stroke: "rgba(0,200,255,0.9)",
  fill: "rgba(0,200,255,0.18)",
  lineDash: [6, 4],
  lineWidth: 2,
};
export const DEFAULT_CHARTER_PLAN = {
  stroke: "rgba(255,165,0,0.9)",
  fill: "rgba(255,165,0,0.18)",
  lineDash: [3, 3],
  lineWidth: 2,
};
export const DEFAULT_CHARTER_CONSTRUCTING = {
  stroke: "rgba(170,255,90,0.9)",
  fill: "rgba(170,255,90,0.18)",
  lineDash: [],
  lineWidth: 2,
};

// Default-deps builder uses these for the validCharterHex palette -- the live
// renderer.ts hardcodes #44ff44 with rgba 0.18 alpha.
export const VALID_CHARTER_HEX = {
  stroke: "rgba(68,255,68,0.9)",
  fill: "rgba(68,255,68,0.18)",
  lineDash: [6, 4],
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
