// Playable HoMM3-style manual fight arena: renders the battle grid on a
// canvas and lets the player click their own platoons (in whatever order
// they choose) to move + attack, alternating with a simple AI opponent, via
// the engine in shared/combat/manualBattle.ts. Currently only reachable from
// the "Test Battle" sandbox (src/views/testBattleSetup.ts) — see that file's
// header for the scope boundary against the real game's battle flow.

import { axialToPixel, hexCorners, hexDistance, pixelToAxial, type Axial } from "../core/hex";
import { totalHealth } from "../../shared/combat/damage";
import { RANGED_ATTACK_RANGE, SURRENDER_COST_GOLD, SURRENDER_UNIT_VALUE_GOLD } from "../../shared/combatConfig";
import {
  attackWithPlatoon,
  computeSpecialty,
  endPlatoonTurn,
  finalizeManualBattle,
  getCombatant,
  getMovementRange,
  getValidAttackTargets,
  getValidMeleeTargets,
  getValidSpyTargets,
  isBattleOver,
  isRangedPlatoon,
  movePlatoon,
  pickTarget,
  platoonSpeed,
  retreatHero,
  runAiTurn,
  spyOnPlatoon,
  startManualBattle,
  timeOfDayForRound,
  totalUnits,
  unactedLivingSlots,
  type ManualBattleState,
  type TimeOfDay,
} from "../../shared/combat/manualBattle";
import type { BattleLogEntry, BattleSide, Combatant } from "../../shared/combat/types";
import type { Platoon, UnitType } from "../state/units";
import { showBattleResultCard } from "./battleResultCard";
import { openConfirmDialog } from "./confirmDialog";
import { PopupMenu, menuTheme, styleButton } from "./menu";
import { createPlatoonInfoPopup } from "./platoonInfoPopup";
import { launchView, registerView } from "./viewLauncher";

registerView("manualBattleArena", (opts) => {
  const o = opts as { playerPlatoons: Platoon[]; aiPlatoons: Platoon[]; unitTypes: Record<string, UnitType>; humanSide: BattleSide };
  openManualBattleArena(o.playerPlatoons, o.aiPlatoons, o.unitTypes, o.humanSide);
});

const HEX_SIZE = 34;

// Dev-only console logging for the arena — this view is only reachable from
// the Test Battle sandbox (see file header), so it's safe to leave this on
// by default rather than gating it behind a toggle. Traces every click's
// resulting action (select/move/attack/deselect/no-op), every combat event
// the engine's own battle log records (attacks, casualties, retreats), and
// keeps a running per-platoon move tally for diagnosing movement bugs.
const DEBUG_LOG = true;
const LOG_PREFIX = "[manualBattle]";

function debugLog(...args: unknown[]): void {
  if (!DEBUG_LOG) return;
  console.log(LOG_PREFIX, ...args);
}

function fmtHex(h: Axial): string {
  return `(${h.q},${h.r})`;
}

function platoonLabel(side: BattleSide, slotIndex: number): string {
  return `${side}#${slotIndex}`;
}

function computeLayout(state: ManualBattleState) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const hex of state.grid.hexes) {
    const { x, y } = axialToPixel(hex.q, hex.r, HEX_SIZE);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

// Specialty → icon. Emoji stand-ins until a real icon set ships; the
// arena is only reachable from the Test Battle sandbox today, so we don't
// need pixel-perfect assets yet. `null` falls back to the plain tile.
const SPECIALTY_ICONS: Record<string, string> = {
  archery: "🏹",
  shield: "🛡",
  pike: "🔱",
  sword: "⚔",
  cavalry: "🐎",
  monster: "🐲",
  prayer: "✨",
  militia: "👥",
};

function specialtyIcon(specialty: string): string {
  return SPECIALTY_ICONS[specialty] ?? "⚔";
}

// Key for indexing a specific unit entry inside the arena's combatant list.
// `slotIndex` is the army-stack slot, `unitTypeId` is which entry within
// that slot (a platoon can hold up to MAX_PLATOON_ENTRIES distinct types).
type LeaveBehindKey = string;

function leaveBehindKey(slotIndex: number, unitTypeId: string): LeaveBehindKey {
  return `${slotIndex}:${unitTypeId}`;
}

// Strips the selected unit counts off the human side's surviving
// combatants so they show up as casualties on the final result card (see
// buildResults in shared/combat/resolveBattle.ts — it diffs original vs
// surviving counts and reports the gap). Called from the Leave Behind
// picker once the player has agreed to the sacrifice.
function applyLeaveBehind(
  state: ManualBattleState,
  side: BattleSide,
  leftBehind: Map<LeaveBehindKey, number>,
): void {
  const combatants = side === "attacker" ? state.attacker : state.defender;
  for (const c of combatants) {
    if (c.retreated) continue;
    let mutated = false;
    for (const e of c.entries) {
      const key = leaveBehindKey(c.slotIndex, e.unitTypeId);
      const remove = leftBehind.get(key);
      if (!remove) continue;
      e.count = Math.max(0, e.count - remove);
      mutated = true;
    }
    if (mutated) c.entries = c.entries.filter((e) => e.count > 0);
  }
}

// Modal shown when the player tries to surrender without enough gold to
// cover the surrender cost. Lets them mark individual units to "leave
// behind" (sacrifice) until the gold shortfall is met — each unit is
// worth `unitValue` gold. Confirm stays disabled until enough units are
// selected; cancelling keeps the battle going.
function openLeaveBehindDialog(opts: {
  state: ManualBattleState;
  side: BattleSide;
  unitTypes: Record<string, UnitType>;
  shortfall: number;
  unitValue: number;
  onConfirm: (leftBehind: Map<LeaveBehindKey, number>) => void;
}): void {
  const { state, side, unitTypes, shortfall, unitValue, onConfirm } = opts;
  const combatants = side === "attacker" ? state.attacker : state.defender;
  const requiredUnits = Math.ceil(shortfall / unitValue);

  const wrapper = document.createElement("div");
  Object.assign(wrapper.style, {
    position: "fixed",
    inset: "0",
    background: "rgba(0,0,0,0.6)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: "120",
  });
  document.body.appendChild(wrapper);

  const menu = new PopupMenu({
    parent: wrapper,
    title: "Leave Behind",
    width: 420,
    draggable: false,
    closeable: true,
    zIndex: 121,
    onClose: () => wrapper.remove(),
  });
  menu.setPosition(Math.max(24, (window.innerWidth - 420) / 2), Math.max(24, (window.innerHeight - 360) / 2));

  // Per-entry counts the player has earmarked. Keyed by
  // "<slotIndex>:<unitTypeId>" so we can match them back to specific
  // combatants in applyLeaveBehind().
  const selected = new Map<LeaveBehindKey, number>();

  const intro = document.createElement("div");
  Object.assign(intro.style, {
    fontSize: "13px",
    lineHeight: "1.5",
    opacity: "0.9",
    marginBottom: "8px",
  });
  intro.textContent =
    `You can't cover the surrender cost. Pick units to leave behind — each ` +
    `unit is worth ${unitValue}G. You need at least ${requiredUnits} more ` +
    `unit${requiredUnits === 1 ? "" : "s"} (${shortfall}G).`;
  menu.appendContent(intro);

  const summary = document.createElement("div");
  Object.assign(summary.style, {
    fontSize: "12px",
    padding: "6px 8px",
    marginBottom: "8px",
    border: "1px solid rgba(255,255,255,0.2)",
    borderRadius: "4px",
  });
  menu.appendContent(summary);

  const list = document.createElement("div");
  Object.assign(list.style, {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    maxHeight: "240px",
    overflowY: "auto",
    marginBottom: "10px",
  });
  menu.appendContent(list);

  for (const c of combatants) {
    if (c.retreated) continue;
    if (c.entries.every((e) => e.count <= 0)) continue;
    for (const e of c.entries) {
      if (e.count <= 0) continue;
      const name = unitTypes[e.unitTypeId]?.name ?? e.unitTypeId;
      const row = document.createElement("div");
      Object.assign(row.style, {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "8px",
        padding: "4px 8px",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: "4px",
        fontSize: "12px",
      });
      const label = document.createElement("div");
      label.textContent = `Platoon ${c.slotIndex + 1} — ${name} ×${e.count}`;
      row.appendChild(label);

      const controls = document.createElement("div");
      Object.assign(controls.style, { display: "flex", gap: "4px", alignItems: "center" });

      const minus = document.createElement("button");
      minus.textContent = "−";
      styleButton(minus);
      minus.style.minWidth = "24px";
      const plus = document.createElement("button");
      plus.textContent = "+";
      styleButton(plus);
      plus.style.minWidth = "24px";

      const pickLabel = document.createElement("span");
      pickLabel.style.minWidth = "40px";
      pickLabel.style.textAlign = "center";

      const key = leaveBehindKey(c.slotIndex, e.unitTypeId);

      const update = (): void => {
        const picked = selected.get(key) ?? 0;
        pickLabel.textContent = `${picked}/${e.count}`;
        refresh();
      };

      minus.addEventListener("click", () => {
        const cur = selected.get(key) ?? 0;
        if (cur <= 0) return;
        const next = cur - 1;
        if (next === 0) selected.delete(key);
        else selected.set(key, next);
        update();
      });
      plus.addEventListener("click", () => {
        const cur = selected.get(key) ?? 0;
        if (cur >= e.count) return;
        selected.set(key, cur + 1);
        update();
      });

      controls.append(minus, pickLabel, plus);
      row.appendChild(controls);
      list.appendChild(row);
      update();
    }
  }

  const confirmBtn = document.createElement("button");
  confirmBtn.textContent = "Confirm Surrender";
  styleButton(confirmBtn, false);
  confirmBtn.style.background = "rgba(120,40,40,0.7)";
  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "Cancel";
  styleButton(cancelBtn);

  const row = document.createElement("div");
  Object.assign(row.style, {
    display: "flex",
    justifyContent: "flex-end",
    gap: "8px",
  });
  row.append(cancelBtn, confirmBtn);
  menu.appendContent(row);

  function refresh(): void {
    let units = 0;
    for (const v of selected.values()) units += v;
    const goldCovered = units * unitValue;
    const enough = units >= requiredUnits;
    summary.textContent =
      `Leaving behind: ${units} unit${units === 1 ? "" : "s"} ` +
      `(${goldCovered}G / need ${shortfall}G)` +
      (enough ? " ✓" : "");
    confirmBtn.disabled = !enough;
    confirmBtn.style.opacity = enough ? "1" : "0.4";
    confirmBtn.style.cursor = enough ? "pointer" : "not-allowed";
  }

  cancelBtn.addEventListener("click", () => menu.close());
  confirmBtn.addEventListener("click", () => {
    if (confirmBtn.disabled) return;
    menu.close();
    onConfirm(selected);
  });

  refresh();
}

// Shown after the player clicks a valid Spy target — asks which unit type
// in the spying platoon pays the 1-troop cost. Modeled on
// openLeaveBehindDialog above, but simplified to a single click-to-pick row
// (always exactly 1 troop, never a range) rather than +/- counters.
// Cancelling has no side effects — the cost is only ever paid by the caller
// inside onConfirm, via spyOnPlatoon.
function openSpyCostDialog(opts: {
  combatant: Combatant;
  unitTypes: Record<string, UnitType>;
  onConfirm: (unitTypeId: string) => void;
}): void {
  const { combatant, unitTypes, onConfirm } = opts;

  const wrapper = document.createElement("div");
  Object.assign(wrapper.style, {
    position: "fixed",
    inset: "0",
    background: "rgba(0,0,0,0.6)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: "120",
  });
  document.body.appendChild(wrapper);

  const menu = new PopupMenu({
    parent: wrapper,
    title: "Send a Spy",
    width: 360,
    draggable: false,
    closeable: true,
    zIndex: 121,
    onClose: () => wrapper.remove(),
  });
  menu.setPosition(Math.max(24, (window.innerWidth - 360) / 2), Math.max(24, (window.innerHeight - 280) / 2));

  const intro = document.createElement("div");
  Object.assign(intro.style, { fontSize: "13px", lineHeight: "1.5", opacity: "0.9", marginBottom: "8px" });
  intro.textContent = `Pick which unit to send — it costs 1 troop and won't return, but doesn't use this platoon's turn.`;
  menu.appendContent(intro);

  const list = document.createElement("div");
  Object.assign(list.style, { display: "flex", flexDirection: "column", gap: "4px", marginBottom: "10px" });
  menu.appendContent(list);

  for (const e of combatant.entries) {
    if (e.count <= 0) continue;
    const name = unitTypes[e.unitTypeId]?.name ?? e.unitTypeId;
    const row = document.createElement("button");
    styleButton(row);
    Object.assign(row.style, {
      display: "flex",
      justifyContent: "space-between",
      width: "100%",
      textAlign: "left",
    });
    row.innerHTML = `<span>${name}</span><span>×${e.count}</span>`;
    row.addEventListener("click", () => {
      menu.close();
      onConfirm(e.unitTypeId);
    });
    list.appendChild(row);
  }

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "Cancel";
  styleButton(cancelBtn);
  const row = document.createElement("div");
  Object.assign(row.style, { display: "flex", justifyContent: "flex-end" });
  row.appendChild(cancelBtn);
  menu.appendContent(row);
  cancelBtn.addEventListener("click", () => menu.close());
}

// Specialty only counts as visible if it makes up at least 40% of the
// platoon's surviving units — matches the "at least 40% archers → archery"
// threshold the design doc calls out, and prevents a single surviving
// unit of a different type from flipping the icon after one stray
// casualty.
const SPECIALTY_VISIBILITY_THRESHOLD = 0.4;

// One tile per platoon in a side's status bar: its unit composition (the
// "resources" making it up) and an overall HP bar, so both players can read
// the whole army's condition at a glance without clicking each stack. Tinted
// with the side's accent color (matching its hero portrait and grid token)
// so attacker vs. defender is unmistakable at a glance.
//
// A specialty icon (top-left) shows only for the owner of the platoon, or
// for the opponent once they've made contact (any successful attack
// involving this platoon in either direction adds the opponent side to
// Combatant.scoutedBy — see markContacted() in shared/combat/manualBattle.ts).
function buildStatusTile(
  state: ManualBattleState,
  c: Combatant,
  accent: string,
  highlighted: boolean,
  viewerSide: BattleSide,
): HTMLElement {
  const tile = document.createElement("div");
  Object.assign(tile.style, {
    position: "relative",
    background: `${accent}22`,
    border: highlighted ? `2px solid ${accent}` : `1px solid ${accent}88`,
    borderRadius: "4px",
    padding: "6px 8px",
    display: "flex",
    flexDirection: "column",
    gap: "3px",
  });

  const alive = !c.retreated && c.entries.some((e) => e.count > 0);
  if (!alive) {
    tile.style.opacity = "0.45";
    const title = document.createElement("div");
    title.style.fontWeight = "600";
    title.style.fontSize = "11px";
    title.textContent = `Platoon ${c.slotIndex + 1}`;
    tile.appendChild(title);
    const status = document.createElement("div");
    status.style.fontSize = "10px";
    status.textContent = c.retreated ? "Retreated" : "Defeated";
    tile.appendChild(status);
    return tile;
  }

  // Fog of war: everything below the title (composition, HP, morale,
  // fatigue) is only known for your own platoons, or an enemy platoon once
  // it's been scouted — either by contact (markContacted, any attack) or by
  // the dedicated Spy action (markScouted). Same Combatant.scoutedBy set
  // that already gated the specialty icon below; now gates the rest of the
  // tile too.
  const isKnown = c.side === viewerSide || c.scoutedBy.has(viewerSide);

  // Specialty icon (top-left) — only visible to the owner, or to the
  // opponent after they've made contact. Recomputed from current entries
  // so the icon naturally shifts when casualties flip the dominant unit
  // type (e.g. the last archer dies and the platoon drops below the 40%
  // archery threshold — icon disappears).
  const specialty = computeSpecialty(c.entries, state.unitTypes);
  const total = totalUnits(c.entries);
  let dominantCount = 0;
  if (specialty) {
    for (const e of c.entries) {
      if (e.count <= 0) continue;
      if (state.unitTypes[e.unitTypeId]?.specialty === specialty) dominantCount += e.count;
    }
  }
  const meetsThreshold = specialty !== null && total > 0 && dominantCount / total >= SPECIALTY_VISIBILITY_THRESHOLD;
  const revealSpecialty = meetsThreshold && isKnown;

  const title = document.createElement("div");
  title.style.fontWeight = "600";
  title.style.fontSize = "11px";
  // Reserve room for the top-left specialty icon (when shown) so the title
  // doesn't overlap it.
  title.style.paddingLeft = revealSpecialty ? "20px" : "0";
  title.textContent = `Platoon ${c.slotIndex + 1}`;
  tile.appendChild(title);

  if (revealSpecialty && specialty) {
    const icon = document.createElement("div");
    Object.assign(icon.style, {
      position: "absolute",
      top: "3px",
      left: "5px",
      fontSize: "14px",
      lineHeight: "1",
      opacity: "0.9",
    });
    icon.textContent = specialtyIcon(specialty);
    icon.title = `Specialty: ${specialty} (${dominantCount}/${total})`;
    tile.appendChild(icon);
  }

  if (!isKnown) {
    const unscouted = document.createElement("div");
    unscouted.style.fontSize = "10px";
    unscouted.style.opacity = "0.6";
    unscouted.textContent = "Unscouted";
    tile.appendChild(unscouted);
    return tile;
  }

  for (const e of c.entries) {
    if (e.count <= 0) continue;
    const line = document.createElement("div");
    line.style.fontSize = "10px";
    line.style.opacity = "0.85";
    line.textContent = `${state.unitTypes[e.unitTypeId]?.name ?? e.unitTypeId} x${e.count}`;
    tile.appendChild(line);
  }

  // Atk/Def/Speed/Range at a glance. A platoon can mix up to
  // MAX_PLATOON_ENTRIES unit types with different stats, so Atk/Def use the
  // numerically dominant entry (most units) rather than an average — same
  // "pick the entry that actually represents the platoon" idea as
  // computeSpecialty, just simpler since it's a single number, not a
  // weighted tag. Speed instead reuses platoonSpeed() directly: it's
  // already the real mechanical value (min speed across entries) that
  // movement range is computed from, not just a display stat.
  const livingEntries = c.entries.filter((e) => e.count > 0);
  if (livingEntries.length > 0) {
    const dominantEntry = livingEntries.reduce((a, b) => (b.count > a.count ? b : a));
    const dominantUnit = state.unitTypes[dominantEntry.unitTypeId];
    const speed = platoonSpeed(c, state.unitTypes);
    const ranged = isRangedPlatoon(c, state.unitTypes);
    const statRow = document.createElement("div");
    Object.assign(statRow.style, { display: "flex", flexWrap: "wrap", gap: "2px 8px", fontSize: "10px", opacity: "0.9" });
    const stat = (label: string, value: string): void => {
      const chip = document.createElement("span");
      chip.textContent = `${label} ${value}`;
      statRow.appendChild(chip);
    };
    if (dominantUnit) {
      stat("Atk", String(dominantUnit.attack));
      stat("Def", String(dominantUnit.defence));
    }
    stat("Spd", String(speed));
    stat("Rng", ranged ? String(RANGED_ATTACK_RANGE) : "Melee");
    tile.appendChild(statRow);

    // Terrain placeholder — the game has no terrain-bonus mechanic yet (see
    // docs/terrain-plan.md), so this stays a "—" slot, same pattern as the
    // Morale/Fatigue placeholders below: the UI slot exists ahead of the
    // mechanic so wiring in real values later is a one-line change here.
    const terrainRow = document.createElement("div");
    Object.assign(terrainRow.style, { fontSize: "10px", opacity: "0.6", fontStyle: "italic" });
    terrainRow.textContent = "Terrain —";
    tile.appendChild(terrainRow);
  }

  const hpPct = c.maxHealth > 0 ? totalHealth(c.entries, state.unitTypes) / c.maxHealth : 0;
  const barTrack = document.createElement("div");
  Object.assign(barTrack.style, {
    background: "#000",
    borderRadius: "2px",
    height: "5px",
    overflow: "hidden",
    marginTop: "2px",
  });
  const barFill = document.createElement("div");
  Object.assign(barFill.style, {
    height: "100%",
    width: `${Math.max(0, Math.min(1, hpPct)) * 100}%`,
    background: hpPct > 0.5 ? "#4caf50" : hpPct > 0.25 ? "#ffb300" : "#e53935",
  });
  barTrack.appendChild(barFill);
  tile.appendChild(barTrack);

  const hpLabel = document.createElement("div");
  hpLabel.style.opacity = "0.7";
  hpLabel.style.fontSize = "10px";
  hpLabel.textContent = `${Math.round(hpPct * 100)}% HP`;
  tile.appendChild(hpLabel);

  // Morale + Fatigue placeholder bars. No actual mechanic behind these yet —
  // the values are hard-coded (morale always 100, fatigue always 0) so the
  // slot exists in the UI for when the combat system gets around to
  // tracking them. Wired into the same color palette as HP so the bar
  // conveys severity at a glance.
  tile.appendChild(makeMetricBar("Morale", 100, (v) => (v > 0.5 ? "#4caf50" : v > 0.25 ? "#ffb300" : "#e53935")));
  tile.appendChild(makeMetricBar("Fatigue", 0, (v) => (v < 0.25 ? "#4caf50" : v < 0.5 ? "#ffb300" : "#e53935")));

  return tile;
}

// Thin label + horizontal bar, one per metric. Reused for the HP, Morale,
// and Fatigue rows on each status tile. `value` is a 0..1 ratio (NOT a
// percentage); `colorFor` maps that ratio to a fill color.
function makeMetricBar(label: string, value: number, colorFor: (v: number) => string): HTMLElement {
  const wrap = document.createElement("div");
  wrap.style.marginTop = "3px";

  const labelRow = document.createElement("div");
  labelRow.style.fontSize = "10px";
  labelRow.style.opacity = "0.7";
  labelRow.textContent = `${label} ${Math.round(value * 100)}`;
  wrap.appendChild(labelRow);

  const track = document.createElement("div");
  Object.assign(track.style, {
    background: "#000",
    borderRadius: "2px",
    height: "4px",
    overflow: "hidden",
    marginTop: "1px",
  });
  const fill = document.createElement("div");
  Object.assign(fill.style, {
    height: "100%",
    width: `${Math.max(0, Math.min(1, value)) * 100}%`,
    background: colorFor(value),
  });
  track.appendChild(fill);
  wrap.appendChild(track);

  return wrap;
}

export function openManualBattleArena(
  playerPlatoons: Platoon[],
  aiPlatoons: Platoon[],
  unitTypes: Record<string, UnitType>,
  humanSide: BattleSide = "attacker",
  options: { heroGold?: number; surrenderCost?: number } = {},
): void {
  // The engine's attacker/defender roles are fixed to their grid colors
  // (attacker always blue, defender always red) — humanSide picks which of
  // those two roles the player controls; the AI always takes the other one.
  const aiSide: BattleSide = humanSide === "attacker" ? "defender" : "attacker";
  const attackerPlatoons = humanSide === "attacker" ? playerPlatoons : aiPlatoons;
  const defenderPlatoons = humanSide === "attacker" ? aiPlatoons : playerPlatoons;
  const state = startManualBattle(attackerPlatoons, defenderPlatoons, {
    unitTypes,
    obstacleSeed: Math.floor(Math.random() * 1_000_000),
    // Deploy the human's side on the grid's left edge and the AI's on the
    // right, regardless of which role (attacker/defender) the human picked —
    // otherwise the AI ends up on the left whenever the human plays defender.
    sideChoice: humanSide,
  });

  // Gold the human hero brings into this battle. Defaults to a low value
  // (300, matching gameState.ts's initial hero gold) so the Test Battle
  // sandbox always exercises the "Leave Behind" path; real callers can
  // pass the hero's actual purse via `options.heroGold`. `surrenderCost`
  // defaults to SURRENDER_COST_GOLD.
  let currentHeroGold = options.heroGold ?? 300;
  const surrenderCost = options.surrenderCost ?? SURRENDER_COST_GOLD;

  // Running per-platoon move tally for the whole battle (both sides), keyed
  // by "side#slotIndex" — printed on demand via logMoveStats and dumped
  // again when the battle ends, so it's easy to see e.g. a platoon that
  // never got to use its full speed.
  const moveStats = new Map<string, { moves: number; hexesTraveled: number }>();

  function recordMove(side: BattleSide, slotIndex: number, hexes: number): void {
    const key = platoonLabel(side, slotIndex);
    const prev = moveStats.get(key) ?? { moves: 0, hexesTraveled: 0 };
    moveStats.set(key, { moves: prev.moves + 1, hexesTraveled: prev.hexesTraveled + hexes });
  }

  function logMoveStats(label: string): void {
    if (!DEBUG_LOG) return;
    const rows = Array.from(moveStats.entries()).map(([platoon, stat]) => ({ platoon, ...stat }));
    console.groupCollapsed(`${LOG_PREFIX} moves per platoon — ${label}`);
    console.table(rows.length > 0 ? rows : [{ platoon: "(none yet)", moves: 0, hexesTraveled: 0 }]);
    console.groupEnd();
  }

  // The engine's own battle log (state.log) already records every attack,
  // casualty, and retreat with full detail — rather than re-deriving that
  // from before/after health snapshots, just print whatever entries were
  // appended since the last check. Covers both the player's clicks and the
  // AI's turns.
  function logNewBattleEvents(sinceLength: number): void {
    if (!DEBUG_LOG) return;
    for (let i = sinceLength; i < state.log.length; i++) {
      const entry: BattleLogEntry = state.log[i];
      if (entry.kind === "damage") {
        const targetSide = entry.side === "attacker" ? "defender" : "attacker";
        const flags = [
          entry.isCounterattack ? "counterattack" : null,
          entry.advantageBonus ? "advantage" : null,
          entry.disadvantagePenalty ? "disadvantage" : null,
        ].filter(Boolean);
        const casualties = entry.casualties.length
          ? entry.casualties.map((c) => `${c.unitTypeId} x${c.count}`).join(", ")
          : "none";
        debugLog(
          `combat: ${platoonLabel(entry.side, entry.attackerSlot)} -> ${platoonLabel(targetSide, entry.targetSlot)}`,
          `dmg=${entry.damage}`,
          flags.length ? `[${flags.join(", ")}]` : "",
          `casualties=${casualties}`,
        );
      } else if (entry.kind === "self_retreat") {
        debugLog(`retreat: ${platoonLabel(entry.side, entry.slotIndex)} self-retreated`);
      } else if (entry.kind === "hero_retreat") {
        debugLog(`retreat: ${entry.side} hero retreated`);
      } else if (entry.kind === "stalemate") {
        debugLog(`stalemate: ${entry.detail}`);
      }
    }
  }

  function logBattleStart(): void {
    if (!DEBUG_LOG) return;
    console.groupCollapsed(
      `${LOG_PREFIX} battle start — you are ${humanSide}, grid ${state.grid.cols}x${state.grid.rows}, ` +
        `obstacleSeed=${state.obstacleSeed}, maxRounds=${state.maxRounds}`,
    );
    const rows: Record<string, unknown>[] = [];
    for (const side of ["attacker", "defender"] as const) {
      for (const c of side === "attacker" ? state.attacker : state.defender) {
        rows.push({
          platoon: platoonLabel(side, c.slotIndex),
          controlledBy: side === humanSide ? "you" : "ai",
          units: c.entries.map((e) => `${state.unitTypes[e.unitTypeId]?.name ?? e.unitTypeId} x${e.count}`).join(", ") || "(empty)",
          speed: platoonSpeed(c, state.unitTypes),
          maxHealth: c.maxHealth,
          position: fmtHex(c.position),
        });
      }
    }
    console.table(rows);
    console.groupEnd();
  }
  logBattleStart();

  // The fight takes over the whole viewport rather than sitting in a small
  // centered popup — there's a lot to look at (grid + both hero panels +
  // side panel) and a modal box was cramping it.
  const overlay = document.createElement("div");
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    background: menuTheme.panel.background,
    color: menuTheme.panel.color,
    display: "flex",
    flexDirection: "column",
    zIndex: "100",
    fontFamily: menuTheme.font,
    fontSize: menuTheme.fontSize,
  });
  document.body.appendChild(overlay);

  // Floats over the arena (position: absolute, out of the overlay's normal
  // flex-column flow) instead of sitting in flow above `container` — that
  // way `container` gets the overlay's full height rather than losing
  // header-height off the top, so it's easier to see how the layout behaves
  // at the full viewport size. Translucent red so it still reads as an
  // overlay banner rather than opaque chrome.
  const header = document.createElement("div");
  Object.assign(header.style, {
    position: "absolute",
    top: "0",
    left: "0",
    right: "0",
    zIndex: "5",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 16px",
    background: "rgba(192, 64, 64, 0.55)",
    color: menuTheme.panel.headerColor,
    borderBottom: "1px solid rgba(255,255,255,0.15)",
    fontSize: "14px",
    fontWeight: "600",
  });
  const titleEl = document.createElement("div");
  titleEl.textContent = `Test Battle — Manual Fight (You: ${humanSide === "attacker" ? "Blue" : "Red"})`;
  header.appendChild(titleEl);
  overlay.appendChild(header);

  function closeArena(): void {
    window.removeEventListener("resize", fitCanvasToContainer);
    overlay.remove();
  }

  let selectedSlot: number | null = null;
  let moveRange: Axial[] = [];
  let attackTargets: Combatant[] = [];
  // Spy targeting: entered via the Spy button, independent of moveRange/
  // attackTargets so it never disturbs the selected platoon's normal
  // move-or-attack state (see spyOnPlatoon in shared/combat/manualBattle.ts —
  // it deliberately never touches the unacted set).
  let spyMode = false;
  let spyTargets: Combatant[] = [];

  const container = document.createElement("div");
  Object.assign(container.style, {
    flex: "1",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "10px",
    overflow: "auto",
    padding: "16px",
  });
  overlay.appendChild(container);

  // Status banner along the bottom of the arena, under the map: an info row
  // (round counter, whose turn it currently is, and the flavor time-of-day —
  // see timeOfDayForRound, purely cosmetic today but a future day/night
  // combat bonus can key off the same round-derived phase) and, below that,
  // an action row with the contextual help text and the End Turn button —
  // both act on "whatever's currently selected on the map", so they live
  // with the rest of the map-status banner rather than off to the side.
  const footer = document.createElement("div");
  Object.assign(footer.style, {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "10px",
    padding: "16px",
    // border-box so the maxWidth set in fitCanvasToContainer (matched to the
    // battle row's content span) is the footer's true outer width, padding
    // included — otherwise the padding would push it wider than the row above.
    boxSizing: "border-box",
    margin: "0 auto",
    background: menuTheme.panel.headerBackground,
    color: menuTheme.panel.headerColor,
    borderTop: "1px solid rgba(255,255,255,0.08)",
    flexShrink: "0",
  });
  overlay.appendChild(footer);

  const infoRow = document.createElement("div");
  Object.assign(infoRow.style, {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "20px",
    fontSize: "18px",
    fontWeight: "600",
  });
  footer.appendChild(infoRow);

  function buildFooterBox(): HTMLElement {
    const box = document.createElement("div");
    Object.assign(box.style, {
      border: "1px solid rgba(255,255,255,0.25)",
      borderRadius: "6px",
      padding: "8px 20px",
    });
    return box;
  }

  const roundEl = buildFooterBox();
  const turnEl = buildFooterBox();
  const timeEl = buildFooterBox();
  infoRow.append(roundEl, turnEl, timeEl);

  const TIME_OF_DAY_ICON: Record<TimeOfDay, string> = {
    Dawn: "🌅",
    Day: "☀️",
    Dusk: "🌇",
    Night: "🌙",
  };

  function renderFooter(): void {
    roundEl.textContent = `Round ${state.round}`;
    const humanActing = unactedLivingSlots(state, humanSide).length > 0;
    turnEl.textContent = isBattleOver(state) ? "Battle Over" : humanActing ? "Your Turn" : "AI's Turn";
    const phase = timeOfDayForRound(state.round);
    timeEl.textContent = `${TIME_OF_DAY_ICON[phase]} ${phase}`;
  }

  const actionRow = document.createElement("div");
  Object.assign(actionRow.style, {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "16px",
    fontSize: "13px",
  });
  footer.appendChild(actionRow);

  const helpTextEl = document.createElement("div");
  helpTextEl.style.opacity = "0.75";
  actionRow.appendChild(helpTextEl);

  const endTurnBtn = document.createElement("button");
  endTurnBtn.textContent = "End Turn (Don't Attack)";
  styleButton(endTurnBtn);
  endTurnBtn.addEventListener("click", () => {
    if (selectedSlot === null) return;
    debugLog(`click End Turn -> ${platoonLabel(humanSide, selectedSlot)} ends its turn without attacking`);
    endPlatoonTurn(state, humanSide, selectedSlot);
    afterPlayerAction();
  });
  actionRow.appendChild(endTurnBtn);

  // Spends 1 troop from the selected platoon to permanently reveal an
  // enemy platoon within this turn's move+attack reach (see
  // getValidSpyTargets). Deliberately does NOT call afterPlayerAction —
  // spyOnPlatoon never touches the unacted set, so the platoon can still
  // move/attack normally afterward.
  const spyBtn = document.createElement("button");
  spyBtn.textContent = "Spy";
  styleButton(spyBtn);
  spyBtn.title = "Send a spy to permanently reveal an enemy platoon within reach — costs 1 troop, doesn't end this platoon's turn.";
  spyBtn.addEventListener("click", () => {
    if (selectedSlot === null || isBattleOver(state)) return;
    const actor = getCombatant(state, humanSide, selectedSlot);
    if (!actor) return;
    debugLog(`click Spy -> ${platoonLabel(humanSide, selectedSlot)} enters spy targeting`);
    spyMode = true;
    spyTargets = getValidSpyTargets(state, actor);
    refresh();
  });
  actionRow.appendChild(spyBtn);

  // Voluntary concession — Retreat applies the standard 15% self-retreat
  // loss to every still-living platoon and pulls the whole side off the
  // field; Surrender skips the loss and yields immediately. Both finalize
  // the battle as `retreated_hero` for the conceding side (see retreatHero
  // + finalizeManualBattle in shared/combat/manualBattle.ts).
  const retreatBtn = document.createElement("button");
  retreatBtn.textContent = "Retreat";
  styleButton(retreatBtn);
  retreatBtn.title = "Withdraw your hero from the fight (each surviving platoon takes a 15% loss before leaving)";
  retreatBtn.addEventListener("click", () => {
    if (isBattleOver(state)) return;
    openConfirmDialog({
      title: "Retreat?",
      message: "Withdraw your hero from this battle?\n\nEvery surviving platoon takes a 15% loss before leaving the field, and you lose the engagement.",
      confirmLabel: "Retreat",
      destructive: true,
      onConfirm: () => {
        debugLog(`player retreats as ${humanSide}`);
        retreatHero(state, humanSide, { applyLoss: true });
        finishBattle();
      },
    });
  });
  // Not appended to actionRow — moved into the human's hero panel, directly
  // under Cast Spell (see humanCastBtn below), so it reads as "your hero's
  // options" rather than a generic footer action.

  const surrenderBtn = document.createElement("button");
  surrenderBtn.textContent = "Surrender";
  styleButton(surrenderBtn);
  surrenderBtn.title = `Yield immediately with no further losses — costs ${surrenderCost}G (you have ${currentHeroGold}G)`;
  surrenderBtn.addEventListener("click", () => {
    if (isBattleOver(state)) return;
    if (currentHeroGold >= surrenderCost) {
      openConfirmDialog({
        title: "Surrender?",
        message:
          `Yield to the enemy?\n\nYou concede the battle immediately with no additional troop losses.\n` +
          `Cost: ${surrenderCost}G (you have ${currentHeroGold}G).`,
        confirmLabel: "Surrender",
        destructive: true,
        onConfirm: () => {
          debugLog(`player surrenders as ${humanSide} (paid ${surrenderCost}G)`);
          currentHeroGold -= surrenderCost;
          retreatHero(state, humanSide, { applyLoss: false });
          finishBattle();
        },
      });
    } else {
      const shortfall = surrenderCost - currentHeroGold;
      debugLog(`player surrender short by ${shortfall}G -> leave-behind picker`);
      openLeaveBehindDialog({
        state,
        side: humanSide,
        unitTypes,
        shortfall,
        unitValue: SURRENDER_UNIT_VALUE_GOLD,
        onConfirm: (leftBehind) => {
          debugLog(`player surrenders as ${humanSide} after leaving behind ${leftBehind} units`);
          applyLeaveBehind(state, humanSide, leftBehind);
          retreatHero(state, humanSide, { applyLoss: false });
          finishBattle();
        },
      });
    }
  });
  // Also moved into the human's hero panel — see the retreatBtn comment above.

  const settingsBtn = document.createElement("button");
  settingsBtn.textContent = "⚙ Settings";
  styleButton(settingsBtn);
  settingsBtn.title = "Open game settings";
  settingsBtn.addEventListener("click", () => {
    launchView("settingsMenu", { parent: overlay });
  });
  actionRow.appendChild(settingsBtn);

  function renderFooterActions(): void {
    const over = isBattleOver(state);
    const actor = selectedSlot === null ? undefined : getCombatant(state, humanSide, selectedSlot);
    helpTextEl.textContent = spyMode
      ? "Click a highlighted enemy to send a spy (costs 1 troop), or click elsewhere to cancel."
      : selectedSlot === null
        ? "Click one of your platoons in the status bar (or on the grid) to act."
        : moveRange.length > 0
          ? "Click a highlighted hex to move (moving next to an enemy fights immediately). Steps left over can still be used — move again, attack a ringed enemy, or End Turn when done."
          : "Out of movement — click a ringed enemy to attack, or End Turn.";
    endTurnBtn.style.display = selectedSlot !== null && !over ? "" : "none";
    spyBtn.style.display = actor && !over && totalUnits(actor.entries) > 1 ? "" : "none";
    spyBtn.disabled = spyMode;
    spyBtn.style.opacity = spyMode ? "0.5" : "1";
    spyBtn.style.cursor = spyMode ? "not-allowed" : "pointer";

    // Cast Spell, Retreat, and Surrender live under the human's hero portrait
    // and only make sense while it's actually the human's turn to act.
    const humanActing = unactedLivingSlots(state, humanSide).length > 0;
    const showHumanActions = !over && humanActing;
    humanCastBtn.style.display = showHumanActions ? "" : "none";
    retreatBtn.style.display = showHumanActions ? "" : "none";
    surrenderBtn.style.display = showHumanActions ? "" : "none";
  }

  // Hero portraits flank the battlefield, HoMM3-style — they stand outside
  // the grid rather than occupying a hex. Cast Spell is a stub for now: no
  // spell system exists yet, so the button just explains that.
  function buildHeroPanel(label: string, accent: string): { panel: HTMLElement; castBtn: HTMLButtonElement } {
    const panel = document.createElement("div");
    Object.assign(panel.style, {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: "6px",
      width: "84px",
      flexShrink: "0",
      fontFamily: menuTheme.font,
      fontSize: "11px",
      textAlign: "center",
    });

    const portrait = document.createElement("div");
    Object.assign(portrait.style, {
      width: "56px",
      height: "56px",
      borderRadius: "50%",
      background: accent,
      border: "2px solid rgba(255,255,255,0.4)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: "20px",
      fontWeight: "700",
      color: "#fff",
    });
    portrait.textContent = label.charAt(0);
    panel.appendChild(portrait);

    const nameEl = document.createElement("div");
    nameEl.textContent = label;
    nameEl.style.opacity = "0.85";
    panel.appendChild(nameEl);

    const castBtn = document.createElement("button");
    castBtn.textContent = "Cast Spell";
    styleButton(castBtn);
    castBtn.disabled = true;
    castBtn.style.opacity = "0.4";
    castBtn.style.cursor = "not-allowed";
    castBtn.title = "Spellcasting isn't implemented yet";
    panel.appendChild(castBtn);

    return { panel, castBtn };
  }

  // Status bars flank the battlefield, one per side, each showing every
  // platoon on that side as a tile (composition + HP). Each bar is grouped
  // under its own hero portrait in one column, so the two armies read as
  // two distinct, color-coded blocks instead of a scattered row of panels.
  function buildStatusBar(label: string): HTMLElement {
    const bar = document.createElement("div");
    Object.assign(bar.style, {
      // Two tiles per row instead of one long column — halves the scroll
      // length for a full roster and leaves each tile enough width for the
      // Atk/Def/Speed/Range/Terrain rows added in buildStatusTile.
      width: "320px",
      flexShrink: "0",
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: "6px",
      maxHeight: "calc(100vh - 260px)",
      overflowY: "auto",
      fontFamily: menuTheme.font,
    });
    const heading = document.createElement("div");
    heading.textContent = label;
    Object.assign(heading.style, {
      gridColumn: "1 / -1",
      fontWeight: "600",
      fontSize: "12px",
      opacity: "0.85",
      textAlign: "center",
    });
    bar.appendChild(heading);
    return bar;
  }

  function buildSideColumn(
    heroLabel: string,
    barLabel: string,
    accent: string,
  ): { column: HTMLElement; bar: HTMLElement; castBtn: HTMLButtonElement } {
    const column = document.createElement("div");
    Object.assign(column.style, {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: "10px",
      flexShrink: "0",
      // `container` centers each of its 4 children independently along the
      // cross axis (align-items: center) based on that child's own height.
      // The two hero columns are NOT the same height — the human's carries
      // Retreat/Surrender under Cast Spell, the AI's doesn't — so centering
      // them independently pushed the shorter/human portrait up out of
      // alignment with the AI's (and, at some viewport heights, off the top
      // of the viewport entirely). Anchoring both to the top keeps the two
      // portraits level regardless of how tall either column's content is.
      alignSelf: "flex-start",
    });
    const hero = buildHeroPanel(heroLabel, accent);
    column.appendChild(hero.panel);
    const bar = buildStatusBar(barLabel);
    column.appendChild(bar);
    return { column, bar, castBtn: hero.castBtn };
  }

  const ATTACKER_ACCENT = "#3070c0";
  const DEFENDER_ACCENT = "#c04040";

  const { column: attackerColumn, bar: attackerBar, castBtn: attackerCastBtn } = buildSideColumn(
    humanSide === "attacker" ? "You" : "AI Opponent",
    humanSide === "attacker" ? "Your Platoons" : "Enemy Platoons",
    ATTACKER_ACCENT,
  );

  // Wrapped in its own positioned div (rather than appended straight into
  // `container`, which is a scrollable flex row of several columns) so the
  // info popup below can be positioned in simple canvas-local coordinates
  // instead of accounting for container scroll/layout.
  const canvasWrap = document.createElement("div");
  canvasWrap.style.position = "relative";
  canvasWrap.style.flexShrink = "0";

  const canvas = document.createElement("canvas");
  canvas.style.background = "#14161a";
  canvas.style.borderRadius = "4px";
  canvas.style.flexShrink = "0";
  canvasWrap.appendChild(canvas);
  const ctx = canvas.getContext("2d")!;

  const infoPopup = createPlatoonInfoPopup(canvasWrap);

  const { column: defenderColumn, bar: defenderBar, castBtn: defenderCastBtn } = buildSideColumn(
    humanSide === "defender" ? "You" : "AI Opponent",
    humanSide === "defender" ? "Your Platoons" : "Enemy Platoons",
    DEFENDER_ACCENT,
  );

  const sidePanel = document.createElement("div");
  Object.assign(sidePanel.style, {
    width: "200px",
    flexShrink: "0",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    fontFamily: menuTheme.font,
    fontSize: "12px",
    maxHeight: "calc(100vh - 100px)",
    overflowY: "auto",
  });

  // Attacker/defender roles are fixed to their grid colors (see the
  // sideChoice comment above), but the human should always see themself on
  // the left and the AI on the right, whichever role they're playing —
  // so the DOM order (which drives the on-screen left-to-right order) is
  // picked by humanSide rather than hardcoded attacker-then-defender.
  const humanColumn = humanSide === "attacker" ? attackerColumn : defenderColumn;
  const aiColumn = humanSide === "attacker" ? defenderColumn : attackerColumn;
  container.appendChild(humanColumn);
  container.appendChild(canvasWrap);
  container.appendChild(aiColumn);
  container.appendChild(sidePanel);

  // Retreat/Surrender are human-only actions, so they live under the
  // human's own Cast Spell button rather than the AI's — see the comments
  // where retreatBtn/surrenderBtn are built, and renderFooterActions for
  // the turn-gated visibility.
  const humanCastBtn = humanSide === "attacker" ? attackerCastBtn : defenderCastBtn;
  humanCastBtn.insertAdjacentElement("afterend", surrenderBtn);
  humanCastBtn.insertAdjacentElement("afterend", retreatBtn);

  const layout = computeLayout(state);
  const pad = HEX_SIZE + 20;
  canvas.width = layout.maxX - layout.minX + pad * 2;
  canvas.height = layout.maxY - layout.minY + pad * 2;
  canvas.style.width = `${canvas.width}px`;
  canvas.style.height = `${canvas.height}px`;
  const offsetX = -layout.minX + pad;
  const offsetY = -layout.minY + pad;

  // The canvas's pixel buffer (canvas.width/height, set above) stays fixed to
  // the hex grid's natural size — hex hit-testing math and drawing all assume
  // that coordinate space. What changes on resize is only the canvas's
  // on-screen CSS size: scaled down (via width/height, never up) to whatever
  // room is left after the side panels take theirs, so the arena never forces
  // a horizontal scrollbar on narrower viewports. The click handler already
  // divides by canvas.width/rect.width to map screen coords back into grid
  // space, so shrinking the CSS size needs no other changes to stay clickable.
  //
  // The floor is a last-resort sanity clamp (degenerate near-zero canvas at
  // pathologically narrow windows), not a usability target — it must stay
  // below whatever scale the widest real sidebar configuration needs at the
  // narrowest supported viewport (1280px), or it becomes the thing that
  // forces the scrollbar it exists to prevent. The 2-up status-bar grid
  // (buildStatusBar) needs ~0.28 at 1280px, hence 0.2 here with headroom.
  const CANVAS_MIN_SCALE = 0.2;
  function fitCanvasToContainer(): void {
    const containerStyle = getComputedStyle(container);
    const paddingX = parseFloat(containerStyle.paddingLeft) + parseFloat(containerStyle.paddingRight);
    const gapX = parseFloat(containerStyle.columnGap || containerStyle.gap || "0") * 3; // 4 siblings, 3 gaps
    const siblingsWidth =
      attackerColumn.getBoundingClientRect().width +
      defenderColumn.getBoundingClientRect().width +
      sidePanel.getBoundingClientRect().width;
    const available = container.clientWidth - paddingX - gapX - siblingsWidth;
    const scale = Math.min(1, Math.max(CANVAS_MIN_SCALE, available / canvas.width));
    canvas.style.width = `${canvas.width * scale}px`;
    canvas.style.height = `${canvas.height * scale}px`;

    // Bound the footer to the same horizontal span as the battle row above
    // it (side panels + canvas + gaps) instead of the full viewport width,
    // so it visually lines up with the panels rather than floating full-bleed.
    const contentWidth = siblingsWidth + canvas.width * scale + gapX;
    footer.style.maxWidth = `${contentWidth}px`;
  }
  window.addEventListener("resize", fitCanvasToContainer);

  function toCanvas(q: number, r: number): { x: number; y: number } {
    const { x, y } = axialToPixel(q, r, HEX_SIZE);
    return { x: x + offsetX, y: y + offsetY };
  }

  // Which horizontal side of `subject` counts as "behind the line" — away
  // from the opposing army's average position, so an info popup anchored
  // there never covers the ground between the two armies. Computed live off
  // positions rather than hardcoded to a side, since attacker/defender can
  // deploy from either edge (see BattleGrid.sideChoice).
  function behindSide(subject: Combatant, opponents: Combatant[]): "left" | "right" {
    const living = opponents.filter((c) => !c.retreated && c.entries.some((e) => e.count > 0));
    if (living.length === 0) return "left";
    const subjectX = toCanvas(subject.position.q, subject.position.r).x;
    const avgOpponentX = living.reduce((sum, c) => sum + toCanvas(c.position.q, c.position.r).x, 0) / living.length;
    return subjectX >= avgOpponentX ? "right" : "left";
  }

  // Shared by: selecting one of your own platoons, completing a Spy, and
  // clicking a previously-spied enemy. `winVsSlot` (a human slotIndex) adds
  // the win-odds row — only meaningful when showing an enemy's card while
  // one of your own platoons is selected.
  function showInfoPopupFor(combatant: Combatant, winVsSlot: number | null): void {
    const accent = combatant.side === "attacker" ? ATTACKER_ACCENT : DEFENDER_ACCENT;
    const ownerLabel = combatant.side === humanSide ? "Your platoon" : "Enemy platoon";
    const opponents = combatant.side === "attacker" ? state.defender : state.attacker;
    const canAct = combatant.side === humanSide && unactedLivingSlots(state, humanSide).includes(combatant.slotIndex);
    const movementRemaining = getMovementRange(state, combatant).length;
    const anchor = toCanvas(combatant.position.q, combatant.position.r);
    const winner = winVsSlot === null ? undefined : getCombatant(state, humanSide, winVsSlot);
    // The canvas is snug around the hex grid (barely 50px of padding) — far
    // too tight to fit a popup beside an edge-column unit without covering
    // it. canvasWrap has no overflow:hidden, so give the popup the real
    // on-screen room (the whole viewport, minus a margin) rather than
    // clamping it to the canvas's own tiny bounds.
    const wrapRect = canvasWrap.getBoundingClientRect();
    const margin = 12;
    infoPopup.show({
      combatant,
      unitTypes: state.unitTypes,
      accent,
      ownerLabel,
      canAct,
      movementRemaining,
      winChanceVs: winner ? { entries: winner.entries, label: `Platoon ${winner.slotIndex + 1}` } : undefined,
      anchorX: anchor.x,
      anchorY: anchor.y,
      anchorSide: behindSide(combatant, opponents),
      minX: margin - wrapRect.left,
      maxX: window.innerWidth - wrapRect.left - margin,
      minY: margin - wrapRect.top,
      maxY: window.innerHeight - wrapRect.top - margin,
    });
  }

  function draw(): void {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const hex of state.grid.hexes) {
      const { x, y } = toCanvas(hex.q, hex.r);
      const corners = hexCorners(x, y, HEX_SIZE - 1);
      ctx.beginPath();
      corners.forEach((c, i) => (i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y)));
      ctx.closePath();
      const inRange = moveRange.some((h) => h.q === hex.q && h.r === hex.r);
      ctx.fillStyle = hex.impassable ? "#3a2a2a" : inRange ? "rgba(210,210,215,0.35)" : "#20242c";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    for (const t of attackTargets) {
      const { x, y } = toCanvas(t.position.q, t.position.r);
      ctx.beginPath();
      ctx.arc(x, y, HEX_SIZE * 0.8, 0, Math.PI * 2);
      ctx.strokeStyle = "#e05050";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Gold dashed ring — deliberately distinct from the red attack-target
    // ring above, so a Spy-armed click never reads as an attack indicator.
    for (const t of spyTargets) {
      const { x, y } = toCanvas(t.position.q, t.position.r);
      ctx.beginPath();
      ctx.setLineDash([4, 3]);
      ctx.arc(x, y, HEX_SIZE * 0.85, 0, Math.PI * 2);
      ctx.strokeStyle = "#e8c04a";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    for (const side of ["attacker", "defender"] as const) {
      for (const c of side === "attacker" ? state.attacker : state.defender) {
        if (c.retreated || !c.entries.some((e) => e.count > 0)) continue;
        const { x, y } = toCanvas(c.position.q, c.position.r);
        const isSelected = side === humanSide && c.slotIndex === selectedSlot;
        ctx.beginPath();
        ctx.arc(x, y, HEX_SIZE * 0.55, 0, Math.PI * 2);
        ctx.fillStyle = side === "attacker" ? (isSelected ? "#5fb0ff" : "#3070c0") : "#c04040";
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = isSelected ? 2 : 1;
        ctx.stroke();

        const count = c.entries.reduce((sum, e) => sum + e.count, 0);
        ctx.fillStyle = "#fff";
        ctx.font = `${Math.round(HEX_SIZE * 0.4)}px ${menuTheme.font}`;
        ctx.textAlign = "center";
        ctx.fillText(String(count), x, y + 3);

        const hpPct = c.maxHealth > 0 ? totalHealth(c.entries, state.unitTypes) / c.maxHealth : 0;
        const barW = HEX_SIZE * 1.1;
        const barX = x - barW / 2;
        const barY = y + HEX_SIZE * 0.55 + 3;
        ctx.fillStyle = "#000";
        ctx.fillRect(barX, barY, barW, 4);
        ctx.fillStyle = hpPct > 0.5 ? "#4caf50" : hpPct > 0.25 ? "#ffb300" : "#e53935";
        ctx.fillRect(barX, barY, barW * hpPct, 4);
      }
    }
  }

  function selectPlatoon(slotIndex: number): void {
    selectedSlot = slotIndex;
    const combatant = getCombatant(state, humanSide, slotIndex);
    if (!combatant) {
      selectedSlot = null;
      moveRange = [];
      attackTargets = [];
      infoPopup.hide();
    } else {
      moveRange = getMovementRange(state, combatant);
      attackTargets = getValidAttackTargets(state, combatant);
      showInfoPopupFor(combatant, null);
    }
    refresh();
  }

  // Called after a successful move. If the move landed it on a hex directly
  // connected (adjacent) to an enemy platoon, that's a bump into melee
  // contact and the fight resolves immediately — no separate "attack" click
  // required. Otherwise, re-show any in-range ranged targets (still
  // requires an explicit click — that's a deliberate shot, not a bump) and
  // whatever movement budget the platoon has left: a platoon that hasn't
  // used its full speed yet can keep walking, hex by hex or in bigger
  // hops, rather than being forced to attack or end its turn immediately.
  // The player can stop early via the "End Turn" button once they're happy
  // with its position.
  //
  // When the move exhausts the platoon's movement AND there are no attack
  // targets left in range (ranged-only path: a ranged unit walked into max
  // range with no enemy to shoot at), the turn is auto-ended and focus
  // jumps to the next unacted platoon on the human side so the player can
  // immediately see its available movement — no need to click "End Turn"
  // just to move on to the next unit.
  function refreshAfterMove(): void {
    if (selectedSlot === null) return;
    const combatant = getCombatant(state, humanSide, selectedSlot);
    if (!combatant) {
      selectedSlot = null;
      moveRange = [];
      attackTargets = [];
      refresh();
      return;
    }
    const adjacentEnemies = getValidMeleeTargets(state, combatant);
    if (adjacentEnemies.length > 0) {
      moveRange = [];
      const target = pickTarget(adjacentEnemies, state.unitTypes) ?? adjacentEnemies[0];
      debugLog(`bump attack: ${platoonLabel(humanSide, selectedSlot)} -> ${platoonLabel(target.side, target.slotIndex)}`);
      const beforeLog = state.log.length;
      attackWithPlatoon(state, humanSide, selectedSlot, target.slotIndex);
      logNewBattleEvents(beforeLog);
      afterPlayerAction();
      return;
    }
    moveRange = getMovementRange(state, combatant);
    attackTargets = getValidAttackTargets(state, combatant);
    if (moveRange.length === 0 && attackTargets.length === 0) {
      debugLog(`auto-end turn: ${platoonLabel(humanSide, selectedSlot)} exhausted movement with no attack targets`);
      endPlatoonTurn(state, humanSide, selectedSlot);
      selectedSlot = null;
      moveRange = [];
      attackTargets = [];
      const slots = unactedLivingSlots(state, humanSide);
      if (slots.length > 0) {
        focusNextUnactedPlatoon();
      } else {
        advanceAi();
      }
      return;
    }
    refresh();
  }

  // Select the next not-yet-acted platoon on the human side (slot order
  // matches the roster bar) so the player sees its available movement
  // immediately. No-op if every human platoon has already acted.
  function focusNextUnactedPlatoon(): void {
    const slots = unactedLivingSlots(state, humanSide);
    if (slots.length === 0) return;
    const nextSlot = slots[0];
    debugLog(`focus next unacted: ${platoonLabel(humanSide, nextSlot)}`);
    selectPlatoon(nextSlot);
  }

  function afterPlayerAction(): void {
    selectedSlot = null;
    moveRange = [];
    attackTargets = [];
    infoPopup.hide();
    advanceAi();
  }

  // runAiTurn is a single opaque engine call — it may move and/or attack
  // with one AI platoon internally. Snapshot positions before and diff
  // after so AI moves show up in the same per-platoon move log as the
  // player's, and diff state.log the same way attacks do for clicks.
  function snapshotAiPosition(): Axial | undefined {
    const slots = unactedLivingSlots(state, aiSide);
    if (slots.length === 0) return undefined;
    const actor = getCombatant(state, aiSide, slots[0]);
    return actor ? { ...actor.position } : undefined;
  }

  function runAiTurnLogged(): void {
    const slots = unactedLivingSlots(state, aiSide);
    if (slots.length === 0) return;
    const slotIndex = slots[0];
    const before = snapshotAiPosition();
    const beforeLog = state.log.length;
    runAiTurn(state, aiSide);
    const actor = getCombatant(state, aiSide, slotIndex);
    if (actor && before && (before.q !== actor.position.q || before.r !== actor.position.r)) {
      const distance = hexDistance(before, actor.position);
      recordMove(aiSide, slotIndex, distance);
      debugLog(`ai move: ${platoonLabel(aiSide, slotIndex)}: ${fmtHex(before)} -> ${fmtHex(actor.position)} (${distance} hex${distance === 1 ? "" : "es"})`);
    }
    logNewBattleEvents(beforeLog);
  }

  function advanceAi(): void {
    if (isBattleOver(state)) {
      finishBattle();
      return;
    }
    if (unactedLivingSlots(state, aiSide).length > 0) {
      runAiTurnLogged();
    }
    if (isBattleOver(state)) {
      finishBattle();
      return;
    }
    while (unactedLivingSlots(state, humanSide).length === 0 && unactedLivingSlots(state, aiSide).length > 0) {
      runAiTurnLogged();
      if (isBattleOver(state)) {
        finishBattle();
        return;
      }
    }
    refresh();
  }

  function finishBattle(): void {
    logMoveStats("battle end");
    const result = finalizeManualBattle(state);
    closeArena();
    showBattleResultCard({
      result,
      attackerLabel: humanSide === "attacker" ? "You" : "AI Opponent",
      defenderLabel: humanSide === "defender" ? "You" : "AI Opponent",
      onCarryOn: () => {},
    });
  }

  function handleClick(hex: Axial): void {
    if (isBattleOver(state)) {
      debugLog(`click ${fmtHex(hex)} -> ignored (battle over)`);
      return;
    }

    // Intercepts before the normal select/attack/move chain entirely, so a
    // Spy-armed click can never be misread as an attack — and so cancelling
    // (clicking a non-target hex) never disturbs the selected platoon's
    // actual moveRange/attackTargets underneath.
    if (spyMode) {
      const target = spyTargets.find((t) => t.position.q === hex.q && t.position.r === hex.r);
      if (target && selectedSlot !== null) {
        const spySlot = selectedSlot;
        const actor = getCombatant(state, humanSide, spySlot);
        if (actor) {
          debugLog(`click ${fmtHex(hex)} -> spy target ${platoonLabel(target.side, target.slotIndex)}`);
          openSpyCostDialog({
            combatant: actor,
            unitTypes: state.unitTypes,
            onConfirm: (unitTypeId) => {
              const ok = spyOnPlatoon(state, humanSide, spySlot, target.slotIndex, unitTypeId);
              debugLog(`spy ${ok ? "succeeded" : "FAILED"}: ${platoonLabel(humanSide, spySlot)} -> ${platoonLabel(target.side, target.slotIndex)} (spent 1x ${unitTypeId})`);
              spyMode = false;
              spyTargets = [];
              refresh();
              if (ok) showInfoPopupFor(target, spySlot);
            },
          });
        }
      } else {
        debugLog(`click ${fmtHex(hex)} -> cancel spy mode`);
        spyMode = false;
        spyTargets = [];
        refresh();
      }
      return;
    }

    // Clicking any of your own not-yet-acted platoons — on the grid or in
    // the status bar — selects it immediately and shows its info popup,
    // even while a different platoon is already selected. No need to
    // explicitly deselect first. Excludes the currently-selected platoon's
    // own hex so that click still falls through to the deselect branch
    // below rather than re-selecting itself.
    const candidates = unactedLivingSlots(state, humanSide);
    const humanCombatants = humanSide === "attacker" ? state.attacker : state.defender;
    const ownCombatant = humanCombatants.find(
      (c) => candidates.includes(c.slotIndex) && c.position.q === hex.q && c.position.r === hex.r,
    );
    if (ownCombatant && ownCombatant.slotIndex !== selectedSlot) {
      debugLog(`click ${fmtHex(hex)} -> select ${platoonLabel(humanSide, ownCombatant.slotIndex)}`);
      selectPlatoon(ownCombatant.slotIndex);
      return;
    }

    if (selectedSlot === null) {
      debugLog(`click ${fmtHex(hex)} -> no-op (no actable platoon there)`);
      return;
    }

    const target = attackTargets.find((t) => t.position.q === hex.q && t.position.r === hex.r);
    if (target) {
      debugLog(`click ${fmtHex(hex)} -> attack: ${platoonLabel(humanSide, selectedSlot)} -> ${platoonLabel(target.side, target.slotIndex)}`);
      const beforeLog = state.log.length;
      attackWithPlatoon(state, humanSide, selectedSlot, target.slotIndex);
      logNewBattleEvents(beforeLog);
      afterPlayerAction();
      return;
    }

    if (moveRange.some((h) => h.q === hex.q && h.r === hex.r)) {
      const actorBefore = getCombatant(state, humanSide, selectedSlot);
      const from = actorBefore ? { ...actorBefore.position } : hex;
      const distance = hexDistance(from, hex);
      const moved = movePlatoon(state, humanSide, selectedSlot, hex);
      if (moved) {
        recordMove(humanSide, selectedSlot, distance);
        const stillActor = getCombatant(state, humanSide, selectedSlot);
        const remainingSteps = stillActor ? getMovementRange(state, stillActor).length : 0;
        debugLog(
          `click ${fmtHex(hex)} -> move ${platoonLabel(humanSide, selectedSlot)}: ${fmtHex(from)} -> ${fmtHex(hex)}`,
          `(${distance} hex${distance === 1 ? "" : "es"}), movement left: ${remainingSteps > 0 ? `${remainingSteps} hexes reachable` : "none"}`,
        );
        logMoveStats(`after ${platoonLabel(humanSide, selectedSlot)} move`);
      } else {
        debugLog(`click ${fmtHex(hex)} -> move REJECTED by engine for ${platoonLabel(humanSide, selectedSlot)} (was shown in range)`);
      }
      refreshAfterMove();
      return;
    }

    const actor = getCombatant(state, humanSide, selectedSlot);
    if (actor && actor.position.q === hex.q && actor.position.r === hex.r) {
      debugLog(`click ${fmtHex(hex)} -> deselect ${platoonLabel(humanSide, selectedSlot)}`);
      selectedSlot = null;
      moveRange = [];
      attackTargets = [];
      infoPopup.hide();
      refresh();
      return;
    }

    // Not an attack/move/deselect — last chance is inspecting an enemy
    // you've already spied on (out of attack range, or you're simply
    // choosing to look rather than fight). Attack/move above always win
    // when both are possible, so this never steals a click from combat.
    const enemyCombatants = aiSide === "attacker" ? state.attacker : state.defender;
    const inspectable = enemyCombatants.find(
      (e) =>
        !e.retreated &&
        e.entries.some((entry) => entry.count > 0) &&
        e.position.q === hex.q &&
        e.position.r === hex.r &&
        e.scoutedBy.has(humanSide),
    );
    if (inspectable) {
      debugLog(`click ${fmtHex(hex)} -> inspect scouted ${platoonLabel(inspectable.side, inspectable.slotIndex)}`);
      showInfoPopupFor(inspectable, selectedSlot);
      return;
    }

    debugLog(`click ${fmtHex(hex)} -> no-op (not a legal move/attack/deselect target for ${platoonLabel(humanSide, selectedSlot)})`);
  }

  canvas.addEventListener("click", (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX - offsetX;
    const y = (e.clientY - rect.top) * scaleY - offsetY;
    handleClick(pixelToAxial(x, y, HEX_SIZE));
  });

  function renderSidePanel(): void {
    sidePanel.replaceChildren();

    if (unactedLivingSlots(state, humanSide).length === 0) {
      const waiting = document.createElement("div");
      waiting.textContent = "Waiting on the AI to finish its round...";
      waiting.style.opacity = "0.6";
      waiting.style.fontSize = "10px";
      sidePanel.appendChild(waiting);
    }
  }

  function renderStatusBars(): void {
    const actableSlots = unactedLivingSlots(state, humanSide);
    const attackerTiles = state.attacker.map((c) => {
      const tile = buildStatusTile(state, c, ATTACKER_ACCENT, humanSide === "attacker" && c.slotIndex === selectedSlot, humanSide);
      if (humanSide === "attacker" && actableSlots.includes(c.slotIndex)) {
        tile.style.cursor = "pointer";
        tile.addEventListener("click", () => selectPlatoon(c.slotIndex));
      }
      return tile;
    });
    attackerBar.replaceChildren(attackerBar.firstElementChild!, ...attackerTiles);

    const defenderTiles = state.defender.map((c) => {
      const tile = buildStatusTile(state, c, DEFENDER_ACCENT, humanSide === "defender" && c.slotIndex === selectedSlot, humanSide);
      if (humanSide === "defender" && actableSlots.includes(c.slotIndex)) {
        tile.style.cursor = "pointer";
        tile.addEventListener("click", () => selectPlatoon(c.slotIndex));
      }
      return tile;
    });
    defenderBar.replaceChildren(defenderBar.firstElementChild!, ...defenderTiles);
  }

  function refresh(): void {
    draw();
    renderSidePanel();
    renderStatusBars();
    renderFooter();
    renderFooterActions();
  }

  refresh();
  fitCanvasToContainer();
}
