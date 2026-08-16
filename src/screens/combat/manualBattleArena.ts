// Playable HoMM3-style manual fight arena: renders the battle grid on a
// canvas and lets the player click their own platoons (in whatever order
// they choose) to move + attack, alternating with a simple AI opponent, via
// the engine in shared/combat/manualBattle.ts. Currently only reachable from
// the "Test Battle" sandbox (src/screens/combat/testBattleSetup.ts) — see that file's
// header for the scope boundary against the real game's battle flow.
//
// Layout is battlefield-first: the grid takes whatever room is left after one
// narrow roster rail — the player's own — and it *reflows* (the hex size is
// solved for the available box) rather than being drawn at a fixed size and
// scaled down. There's no rail for the opponent; only your own units belong
// on your screen. A platoon strip's full detail (composition, stats, morale/
// fatigue, movement) stays collapsed until that platoon is hovered or
// selected, when the strip itself expands in place — see buildPlatoonStrip.
// Enemy platoons have no rail to expand into, so clicking one on the
// battlefield still opens the floating info card — see showInfoPopupFor.

import { axialToPixel, hexCorners, HEX_DIRECTIONS, hexDistance, nearestHexEdge, pixelToAxial, type Axial } from "../../core/hex";
import { totalHealth } from "@heroes/engine";
import { RANGED_ATTACK_RANGE, SURRENDER_COST_GOLD, SURRENDER_UNIT_VALUE_GOLD } from "@heroes/engine";
import {
  attackFromHex,
  attackWithPlatoon,
  computeSpecialty,
  endPlatoonTurn,
  finalizeManualBattle,
  getApproachHexes,
  getCombatant,
  getMovementPath,
  getMovementRange,
  getValidAttackTargets,
  getValidMeleeTargets,
  isBattleOver,
  isRangedPlatoon,
  movePlatoon,
  pickTarget,
  planAiTurn,
  platoonSpeed,
  retreatHero,
  startManualBattle,
  timeOfDayForRound,
  totalUnits,
  unactedLivingSlots,
  type AiTurnPlan,
  type ManualBattleState,
  type TimeOfDay,
} from "@heroes/engine";
import type { BattleLogEntry, BattleSide, Combatant } from "@heroes/engine";
import type { Platoon, UnitType } from "../../state/units";
import { showBattleResultCard } from "./battleResultCard";
import { openConfirmDialog } from "@screens/shared/confirmDialog";
import { PopupMenu, menuTheme, styleButton } from "@screens/shared/menu";
import { createPlatoonInfoPopup } from "./platoonInfoPopup";
import { launchView, registerView } from "@screens/shared/viewLauncher";

registerView("manualBattleArena", (opts) => {
  const o = opts as { playerPlatoons: Platoon[]; aiPlatoons: Platoon[]; unitTypes: Record<string, UnitType>; humanSide: BattleSide };
  openManualBattleArena(o.playerPlatoons, o.aiPlatoons, o.unitTypes, o.humanSide);
});

// Bounds for the solved-for hex size. The grid is fitted to the available
// battlefield box between these two — MAX so a large viewport gets genuinely
// large hexes rather than a small grid marooned in whitespace, MIN as a
// readability floor we'd rather overflow slightly than go below.
const HEX_SIZE_MAX = 44;
const HEX_SIZE_MIN = 14;

// Blank space kept between the outermost hexes and the canvas edge, on top of
// the one-hex radius already needed to fit those hexes' corners.
const CANVAS_MARGIN = 20;

// Width of the player's roster rail. A collapsed strip only needs enough
// room for identification and at-a-glance health, but an expanded one (the
// hovered/selected platoon) carries the full readout — composition, Atk/Def/
// Spd/Rng, morale/fatigue bars — so the rail is sized for that case rather
// than the collapsed one.
const RAIL_WIDTH = 230;

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

interface GridExtent {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function gridExtent(state: ManualBattleState, size: number): GridExtent {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const hex of state.grid.hexes) {
    const { x, y } = axialToPixel(hex.q, hex.r, size);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

// Hex centers scale linearly with hex size, so one measurement of the grid at
// size 1 is enough to solve for any box. Total canvas span at size s is
// span1 * s + 2 * (s + CANVAS_MARGIN) — i.e. s * (span1 + 2) + 2 * MARGIN —
// so invert that per axis, take the tighter of the two, and clamp.
function fitHexSize(unitExtent: GridExtent, availW: number, availH: number): number {
  const spanX = unitExtent.maxX - unitExtent.minX;
  const spanY = unitExtent.maxY - unitExtent.minY;
  const byWidth = (availW - CANVAS_MARGIN * 2) / (spanX + 2);
  const byHeight = (availH - CANVAS_MARGIN * 2) / (spanY + 2);
  return Math.max(HEX_SIZE_MIN, Math.min(HEX_SIZE_MAX, Math.floor(Math.min(byWidth, byHeight))));
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
// buildResults in packages/engine/src/combat/resolveBattle.ts — it diffs
// original vs surviving counts and reports the gap). Called from the Leave
// Behind picker once the player has agreed to the sacrifice.
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

// Specialty only counts as visible if it makes up at least 40% of the
// platoon's surviving units — matches the "at least 40% archers → archery"
// threshold the design doc calls out, and prevents a single surviving
// unit of a different type from flipping the icon after one stray
// casualty.
const SPECIALTY_VISIBILITY_THRESHOLD = 0.4;

function isAlive(c: Combatant): boolean {
  return !c.retreated && c.entries.some((e) => e.count > 0);
}

// Dominant specialty, recomputed live from entries (no cached state) so it
// naturally shifts when casualties flip the dominant unit type — e.g. the
// last archer dies and the platoon drops below the archery threshold.
// Returns null when nothing clears the threshold.
function visibleSpecialty(
  state: ManualBattleState,
  c: Combatant,
): { tag: string; dominant: number; total: number } | null {
  const specialty = computeSpecialty(c.entries, state.unitTypes);
  if (!specialty) return null;
  const total = totalUnits(c.entries);
  if (total === 0) return null;
  let dominant = 0;
  for (const e of c.entries) {
    if (e.count <= 0) continue;
    if (state.unitTypes[e.unitTypeId]?.specialty === specialty) dominant += e.count;
  }
  return dominant / total >= SPECIALTY_VISIBILITY_THRESHOLD ? { tag: specialty, dominant, total } : null;
}

function hpRatio(state: ManualBattleState, c: Combatant): number {
  return c.maxHealth > 0 ? totalHealth(c.entries, state.unitTypes) / c.maxHealth : 0;
}

function hpColor(pct: number): string {
  return pct > 0.5 ? "#4caf50" : pct > 0.25 ? "#ffb300" : "#e53935";
}

// Detail shown only in a strip's expanded state — the same shape of data
// showInfoPopupFor computes for the enemy popup, just rendered inline
// instead of floating. Left optional/undefined when the strip is collapsed
// so buildPlatoonStrip's caller (fillRail) only has to compute it for
// whichever one platoon is actually expanded.
interface PlatoonStripDetail {
  unitTypes: Record<string, UnitType>;
  stats: { label: string; value: string }[];
  metrics: { label: string; value: number; color: string }[];
  movementRemaining: number;
  canAct: boolean;
}

function detailRow(label: string, value: string): HTMLElement {
  const row = document.createElement("div");
  Object.assign(row.style, { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "8px" });
  const l = document.createElement("span");
  l.textContent = label;
  Object.assign(l.style, { opacity: "0.7", fontSize: "10.5px" });
  const v = document.createElement("span");
  v.textContent = value;
  Object.assign(v.style, { fontVariantNumeric: "tabular-nums", textAlign: "right", fontSize: "10.5px" });
  row.append(l, v);
  return row;
}

// One row per platoon in a side's rail. Collapsed, it's enough to identify
// the platoon and read its health at a glance. Expanded (the currently
// hovered or selected platoon), it grows in place to show the full readout —
// composition, Atk/Def/Spd/Rng, morale, fatigue, movement left — that used
// to live only in a floating info card. This is the density change the rest
// of the layout depends on: sixteen always-on stat tiles previously consumed
// 640px of width that the battlefield now gets, with the detail spent only
// on the one platoon actually being looked at.
function buildPlatoonStrip(opts: {
  state: ManualBattleState;
  combatant: Combatant;
  accent: string;
  selected: boolean;
  // Rendered spent — "has already acted this round".
  dimmed: boolean;
  expanded: boolean;
  detail?: PlatoonStripDetail;
}): HTMLElement {
  const { state, combatant: c, accent, selected, dimmed, expanded, detail } = opts;
  const alive = isAlive(c);

  const strip = document.createElement("div");
  Object.assign(strip.style, {
    display: "flex",
    flexDirection: "column",
    gap: "3px",
    padding: "5px 7px",
    borderRadius: "4px",
    background: selected ? `${accent}33` : "rgba(255,255,255,0.03)",
    border: selected ? `1px solid ${accent}` : "1px solid rgba(255,255,255,0.07)",
    // Spent platoons stay legible but visibly dimmed, so "who still has a
    // turn left" reads without counting.
    opacity: !alive ? "0.35" : dimmed ? "0.55" : "1",
  });

  const top = document.createElement("div");
  Object.assign(top.style, { display: "flex", alignItems: "center", gap: "6px", fontSize: "11px" });

  const specialty = visibleSpecialty(state, c);
  const icon = document.createElement("span");
  Object.assign(icon.style, { width: "14px", textAlign: "center", flexShrink: "0", lineHeight: "1" });
  icon.textContent = !alive ? "✕" : specialty ? specialtyIcon(specialty.tag) : "·";
  top.appendChild(icon);

  const name = document.createElement("span");
  name.style.fontWeight = "600";
  name.textContent = `P${c.slotIndex + 1}`;
  top.appendChild(name);

  const spacer = document.createElement("span");
  spacer.style.flex = "1";
  top.appendChild(spacer);

  const count = document.createElement("span");
  Object.assign(count.style, { opacity: "0.85", fontVariantNumeric: "tabular-nums" });
  if (!alive) count.textContent = c.retreated ? "Retreated" : "Defeated";
  else count.textContent = `×${totalUnits(c.entries)}`;
  top.appendChild(count);

  strip.appendChild(top);

  if (alive) {
    const track = document.createElement("div");
    Object.assign(track.style, {
      height: "4px",
      borderRadius: "2px",
      background: "rgba(0,0,0,0.55)",
      overflow: "hidden",
    });
    const pct = hpRatio(state, c);
    const fill = document.createElement("div");
    Object.assign(fill.style, {
      height: "100%",
      width: `${Math.max(0, Math.min(1, pct)) * 100}%`,
      background: hpColor(pct),
    });
    track.appendChild(fill);
    strip.appendChild(track);

    if (expanded && detail) {
      const hp = totalHealth(c.entries, detail.unitTypes);
      strip.appendChild(detailRow("HP", `${hp} / ${c.maxHealth}`));

      const compList = document.createElement("div");
      Object.assign(compList.style, { display: "flex", flexDirection: "column", gap: "1px" });
      for (const e of c.entries) {
        if (e.count <= 0) continue;
        compList.appendChild(detailRow(detail.unitTypes[e.unitTypeId]?.name ?? e.unitTypeId, `x${e.count}`));
      }
      strip.appendChild(compList);

      strip.appendChild(detailRow("Movement", `${detail.movementRemaining} left`));

      if (detail.stats.length > 0) {
        const statRow = document.createElement("div");
        Object.assign(statRow.style, { display: "flex", flexWrap: "wrap", gap: "3px 4px", marginTop: "1px" });
        for (const s of detail.stats) {
          const chip = document.createElement("span");
          Object.assign(chip.style, {
            fontSize: "9.5px",
            padding: "2px 5px",
            borderRadius: "3px",
            background: "rgba(255,255,255,0.06)",
            fontVariantNumeric: "tabular-nums",
          });
          chip.innerHTML = `<span style="opacity:0.6">${s.label}</span> ${s.value}`;
          statRow.appendChild(chip);
        }
        strip.appendChild(statRow);
      }

      for (const m of detail.metrics) {
        const clamped = Math.max(0, Math.min(1, m.value));
        const line = document.createElement("div");
        line.appendChild(detailRow(m.label, String(Math.round(clamped * 100))));
        const mTrack = document.createElement("div");
        Object.assign(mTrack.style, { height: "4px", borderRadius: "2px", background: "rgba(0,0,0,0.5)", overflow: "hidden", marginTop: "2px" });
        const mFill = document.createElement("div");
        Object.assign(mFill.style, { height: "100%", width: `${clamped * 100}%`, background: m.color });
        mTrack.appendChild(mFill);
        line.appendChild(mTrack);
        strip.appendChild(line);
      }

      const canActChip = document.createElement("span");
      Object.assign(canActChip.style, {
        alignSelf: "flex-start",
        fontSize: "9.5px",
        padding: "2px 6px",
        borderRadius: "3px",
        border: "1px solid rgba(255,255,255,0.15)",
        opacity: "0.85",
        marginTop: "1px",
      });
      canActChip.textContent = detail.canAct ? "Can act" : "Acted";
      strip.appendChild(canActChip);
    }
  }

  return strip;
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

  const ATTACKER_ACCENT = "#3070c0";
  const DEFENDER_ACCENT = "#c04040";
  const humanAccent = humanSide === "attacker" ? ATTACKER_ACCENT : DEFENDER_ACCENT;

  // The fight takes over the whole viewport. Three stacked bands: a status
  // bar, the battle row (rail | battlefield | rail), and an action + log bar.
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

  // Round / time-of-day / turn state, previously split between a floating
  // translucent banner and the footer. Consolidated into one in-flow band so
  // the bottom of the screen is purely "things you can do" and the
  // battlefield owns everything between the two.
  const topBar = document.createElement("div");
  Object.assign(topBar.style, {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "0 14px",
    height: "40px",
    flexShrink: "0",
    background: menuTheme.panel.headerBackground,
    color: menuTheme.panel.headerColor,
    borderBottom: "1px solid rgba(255,255,255,0.1)",
    fontSize: "12px",
  });
  overlay.appendChild(topBar);

  const titleEl = document.createElement("div");
  Object.assign(titleEl.style, { fontWeight: "600", fontSize: "13px" });
  titleEl.textContent = "Test Battle — Manual Fight";
  topBar.appendChild(titleEl);

  const sideTag = document.createElement("span");
  Object.assign(sideTag.style, {
    fontSize: "10.5px",
    padding: "2px 7px",
    borderRadius: "3px",
    background: `${humanAccent}33`,
    border: `1px solid ${humanAccent}`,
  });
  sideTag.textContent = `You: ${humanSide === "attacker" ? "Blue" : "Red"}`;
  topBar.appendChild(sideTag);

  const topSpacer = document.createElement("div");
  topSpacer.style.flex = "1";
  topBar.appendChild(topSpacer);

  function buildStatusChip(): HTMLElement {
    const chip = document.createElement("div");
    Object.assign(chip.style, {
      padding: "3px 10px",
      borderRadius: "4px",
      background: "rgba(255,255,255,0.05)",
      fontVariantNumeric: "tabular-nums",
    });
    return chip;
  }

  const roundEl = buildStatusChip();
  const timeEl = buildStatusChip();
  const turnEl = buildStatusChip();
  topBar.append(roundEl, timeEl, turnEl);

  const settingsBtn = document.createElement("button");
  settingsBtn.textContent = "⚙";
  styleButton(settingsBtn);
  settingsBtn.title = "Open game settings";
  settingsBtn.addEventListener("click", () => {
    launchView("settingsMenu", { parent: overlay });
  });
  topBar.appendChild(settingsBtn);

  const TIME_OF_DAY_ICON: Record<TimeOfDay, string> = {
    Dawn: "🌅",
    Day: "☀️",
    Dusk: "🌇",
    Night: "🌙",
  };

  function closeArena(): void {
    // Must cancel any pending AI beat, or it fires against a detached overlay.
    // Bumping the token also aborts an AI sequence already parked on an await.
    aiRunToken++;
    clearAiTimer();
    clearAnimations();
    resizeObserver.disconnect();
    overlay.remove();
  }

  let selectedSlot: number | null = null;
  // The rail strip currently expanded by mouse hover, independent of
  // selectedSlot — hovering a different platoon than the selected one should
  // expand *that* one without disturbing the selection. Falls back to
  // selectedSlot when nothing's hovered — see fillRail.
  let hoveredSlot: number | null = null;
  let moveRange: Axial[] = [];
  let attackTargets: Combatant[] = [];

  // Directional melee targeting. Hovering a reachable enemy *latches* it as
  // pendingTarget and works out which of the hexes around it you'd close in
  // from, based on which sixth of the enemy's hex the cursor sits in. The
  // latch deliberately survives the cursor leaving the enemy and moving onto
  // one of those approach hexes — that's what lets you click the hex itself
  // instead of trusting the sector (see updateHover).
  //
  // While a latch is live, a click on an approach hex is an *attack*; with no
  // latch the same click is an ordinary move. That ordering, enforced in
  // handleClick, is the whole disambiguation between the two meanings.
  let pendingTarget: Combatant | null = null;
  let approachHexes: { hex: Axial; cost: number }[] = [];
  let approachChoice: Axial | null = null;

  function clearPendingAttack(): boolean {
    if (pendingTarget === null && approachChoice === null) return false;
    pendingTarget = null;
    approachHexes = [];
    approachChoice = null;
    return true;
  }

  // The AI used to resolve its whole turn synchronously inside advanceAi(),
  // with a single repaint at the end — the board simply teleported between the
  // player's clicks and you never saw the opponent move. It is now narrated in
  // discrete beats, one platoon per pass (see stepAi): telegraph the actor and
  // its intended target, walk it hex by hex along its real path, pause on
  // arrival, then land the attack with an impact flash and a floating casualty
  // count. `aiActing` blocks player input for the duration.
  const AI_TELEGRAPH_MS = 320;
  const AI_STEP_MS = 260;
  // Per hex of the walk, capped so a full-speed dash across the field still
  // resolves promptly rather than making the player wait out every step.
  const AI_MOVE_MS_PER_HEX = 90;
  const AI_MOVE_MS_MAX = 620;
  const AI_ARRIVE_PAUSE_MS = 140;
  const AI_IMPACT_HOLD_MS = 420;
  // Lifetimes of the two purely cosmetic overlays. Both outlive the beat that
  // spawns them so the float is still drifting as control returns.
  const IMPACT_MS = 300;
  const FLOAT_MS = 800;
  let aiActing = false;
  let aiActingSlot: number | null = null;
  // Hex the telegraphed platoon intends to hit, flashed during the first beat
  // so the player reads "who is about to act, and on whom" before anything
  // moves.
  let aiTargetHex: Axial | null = null;
  let aiTimer: number | null = null;
  // Bumped whenever the arena closes or the battle ends. The AI sequence
  // awaits between beats, so every step re-checks this before touching state
  // that may have been torn down mid-flight.
  let aiRunToken = 0;

  function clearAiTimer(): void {
    if (aiTimer !== null) {
      window.clearTimeout(aiTimer);
      aiTimer = null;
    }
  }

  // Sleeps between AI beats. Resolves false if the run was cancelled while
  // waiting, so the caller can bail instead of animating into a dead overlay.
  function aiWait(ms: number): Promise<boolean> {
    const token = aiRunToken;
    return new Promise((resolve) => {
      aiTimer = window.setTimeout(() => {
        aiTimer = null;
        resolve(token === aiRunToken);
      }, ms);
    });
  }

  // ---- cosmetic overlays -------------------------------------------------
  // None of this touches engine state: the platoon's authoritative position
  // is already its destination the moment movePlatoon returns. moveAnim just
  // makes draw() render it somewhere along the path for the next few frames.
  let moveAnim: { side: BattleSide; slotIndex: number; path: Axial[]; startedAt: number; durationMs: number } | null = null;
  let impact: { hex: Axial; startedAt: number } | null = null;
  const floats: { hex: Axial; text: string; startedAt: number }[] = [];
  let animFrame: number | null = null;

  function animationsActive(): boolean {
    const now = performance.now();
    if (moveAnim) return true;
    if (impact && now - impact.startedAt < IMPACT_MS) return true;
    return floats.length > 0;
  }

  // Drops overlays whose lifetime has elapsed. Called from draw() rather than
  // only from the animation loop: requestAnimationFrame is paused entirely
  // while the tab is hidden, and without this the effects queued during that
  // time would never expire — they would pile up and all repaint at once when
  // the tab came back. Pruning on every repaint makes the overlays correct
  // whatever the frame schedule happens to be.
  function pruneExpiredEffects(now: number): void {
    if (moveAnim && now - moveAnim.startedAt >= moveAnim.durationMs) moveAnim = null;
    if (impact && now - impact.startedAt >= IMPACT_MS) impact = null;
    for (let i = floats.length - 1; i >= 0; i--) {
      if (now - floats[i].startedAt >= FLOAT_MS) floats.splice(i, 1);
    }
  }

  // Repaints the canvas only — not the rails or the log, which rebuild their
  // DOM wholesale and have nothing to say frame to frame.
  function pumpAnimation(): void {
    if (animFrame !== null) return;
    const step = (): void => {
      animFrame = null;
      draw();
      if (animationsActive()) animFrame = window.requestAnimationFrame(step);
    };
    animFrame = window.requestAnimationFrame(step);
  }

  function clearAnimations(): void {
    if (animFrame !== null) {
      window.cancelAnimationFrame(animFrame);
      animFrame = null;
    }
    moveAnim = null;
    impact = null;
    floats.length = 0;
  }

  const battleRow = document.createElement("div");
  Object.assign(battleRow.style, {
    flex: "1 1 0",
    minHeight: "0",
    display: "flex",
    alignItems: "stretch",
    gap: "12px",
    padding: "12px",
  });
  overlay.appendChild(battleRow);

  // Bottom band: the contextual help text plus whatever actions apply to the
  // current selection, and under it the battle log. Full-bleed rather than
  // width-matched to the row above, since the battlefield's width is now
  // fluid and there's no fixed content span to line up with.
  const bottomBar = document.createElement("div");
  Object.assign(bottomBar.style, {
    flexShrink: "0",
    display: "flex",
    flexDirection: "column",
    background: menuTheme.panel.headerBackground,
    color: menuTheme.panel.headerColor,
    borderTop: "1px solid rgba(255,255,255,0.1)",
  });
  overlay.appendChild(bottomBar);

  const actionRow = document.createElement("div");
  Object.assign(actionRow.style, {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "8px 14px",
    fontSize: "12px",
  });
  bottomBar.appendChild(actionRow);

  const helpTextEl = document.createElement("div");
  Object.assign(helpTextEl.style, { opacity: "0.75", flex: "1", minWidth: "0" });
  actionRow.appendChild(helpTextEl);

  const endTurnBtn = document.createElement("button");
  endTurnBtn.textContent = "End Turn (Don't Attack)";
  styleButton(endTurnBtn, true);
  endTurnBtn.addEventListener("click", () => {
    if (selectedSlot === null) return;
    debugLog(`click End Turn -> ${platoonLabel(humanSide, selectedSlot)} ends its turn without attacking`);
    endPlatoonTurn(state, humanSide, selectedSlot);
    afterPlayerAction();
  });

  actionRow.append(endTurnBtn);

  // The engine has always produced a full replayable log (state.log); until
  // now the arena only forwarded it to console.log and the player saw none of
  // it. Collapsed to a single line by default so it costs almost no vertical
  // space, expandable when the round-by-round detail is wanted.
  const LOG_COLLAPSED_HEIGHT = "20px";
  const LOG_EXPANDED_HEIGHT = "128px";
  let logExpanded = false;

  const logBar = document.createElement("div");
  Object.assign(logBar.style, {
    display: "flex",
    alignItems: "flex-start",
    gap: "8px",
    padding: "0 14px 8px",
    fontSize: "11px",
  });
  bottomBar.appendChild(logBar);

  const logToggle = document.createElement("button");
  styleButton(logToggle);
  Object.assign(logToggle.style, { fontSize: "10.5px", padding: "2px 7px", flexShrink: "0" });
  logBar.appendChild(logToggle);

  const logFeed = document.createElement("div");
  Object.assign(logFeed.style, {
    flex: "1",
    minWidth: "0",
    height: LOG_COLLAPSED_HEIGHT,
    overflowY: "hidden",
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    lineHeight: "1.45",
  });
  logBar.appendChild(logFeed);

  function applyLogHeight(): void {
    logToggle.textContent = logExpanded ? "▾ Log" : "▸ Log";
    logFeed.style.height = logExpanded ? LOG_EXPANDED_HEIGHT : LOG_COLLAPSED_HEIGHT;
    logFeed.style.overflowY = logExpanded ? "auto" : "hidden";
    // Collapsed shows only the newest line, so anchor to the bottom either way.
    logFeed.scrollTop = logFeed.scrollHeight;
  }
  logToggle.addEventListener("click", () => {
    logExpanded = !logExpanded;
    applyLogHeight();
  });

  function sideName(side: BattleSide): string {
    return side === humanSide ? "You" : "Enemy";
  }

  function describeLogEntry(entry: BattleLogEntry): string {
    if (entry.kind === "damage") {
      const targetSide: BattleSide = entry.side === "attacker" ? "defender" : "attacker";
      const lost = entry.casualties.reduce((sum, c) => sum + c.count, 0);
      const tags: string[] = [];
      if (entry.isCounterattack) tags.push("counter");
      if (entry.advantageBonus) tags.push("advantage");
      if (entry.disadvantagePenalty) tags.push("disadvantage");
      return (
        `R${entry.round} · ${sideName(entry.side)} P${entry.attackerSlot + 1} → ` +
        `${sideName(targetSide)} P${entry.targetSlot + 1} · ${entry.damage} dmg` +
        (lost > 0 ? ` · ${lost} lost` : "") +
        (tags.length > 0 ? ` (${tags.join(", ")})` : "")
      );
    }
    if (entry.kind === "self_retreat") {
      const lost = entry.casualties.reduce((sum, c) => sum + c.count, 0);
      return `R${entry.round} · ${sideName(entry.side)} P${entry.slotIndex + 1} withdrew${lost > 0 ? ` · ${lost} lost` : ""}`;
    }
    if (entry.kind === "hero_retreat") {
      return `R${entry.round} · ${sideName(entry.side)} hero left the field`;
    }
    return `R${entry.round} · Stalemate — ${entry.detail}`;
  }

  // Appended incrementally rather than re-rendered, so the feed keeps its
  // scroll position instead of rebuilding the whole history every refresh.
  let renderedLogCount = 0;

  const logEmpty = document.createElement("div");
  logEmpty.textContent = "No engagements yet.";
  logEmpty.style.opacity = "0.4";
  logFeed.appendChild(logEmpty);

  function renderLog(): void {
    if (state.log.length === renderedLogCount) return;
    logEmpty.remove();
    for (let i = renderedLogCount; i < state.log.length; i++) {
      const entry = state.log[i];
      const line = document.createElement("div");
      line.textContent = describeLogEntry(entry);
      Object.assign(line.style, {
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        fontVariantNumeric: "tabular-nums",
        opacity: "0.85",
      });
      if (entry.kind !== "stalemate") {
        line.style.color = entry.side === humanSide ? "#9ecbff" : "#ff9e9e";
      }
      logFeed.appendChild(line);
    }
    renderedLogCount = state.log.length;
    logFeed.scrollTop = logFeed.scrollHeight;
  }

  applyLogHeight();

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

  function renderActions(): void {
    const over = isBattleOver(state);
    const waitingOnAi = !over && (aiActing || unactedLivingSlots(state, humanSide).length === 0);
    // Ranged platoons have no approach side to pick — they shoot from where
    // they stand — so they must never be told to hover for a direction.
    const selected = selectedSlot === null ? undefined : getCombatant(state, humanSide, selectedSlot);
    const ranged = selected ? isRangedPlatoon(selected, state.unitTypes) : false;
    helpTextEl.textContent = over
      ? "Battle over."
      : waitingOnAi
        ? "The AI is making its move..."
        : selectedSlot === null
          ? "Click one of your outlined platoons — on the grid or in the left rail — to act. Hover any platoon for its full details."
          : pendingTarget !== null
            ? "The arrow shows which side you'll attack from — move the cursor around the enemy to swing it, then click to close in and fight. Click the marked hex itself if you'd rather pick it directly."
            : ranged
              ? moveRange.length > 0
                ? "Click a ringed enemy to shoot it from where you stand, or a highlighted hex to reposition. Move again, shoot, or End Turn when done."
                : "Out of movement — click a ringed enemy to shoot, or End Turn."
              : moveRange.length > 0
                ? "Hover an enemy in reach to choose the side you attack from, or click a highlighted hex to just move (landing beside a lone enemy fights immediately). Move again, attack, or End Turn when done."
                : "Out of movement — hover an adjacent enemy to attack from where you stand, or End Turn.";
    endTurnBtn.style.display = selectedSlot !== null && !over && !aiActing ? "" : "none";

    // Cast Spell, Retreat, and Surrender live under the human's hero portrait
    // and only make sense while it's actually the human's turn to act — which
    // now excludes the beats where the AI is mid-move.
    const humanActing = unactedLivingSlots(state, humanSide).length > 0;
    const showHumanActions = !over && !aiActing && humanActing;
    humanCastBtn.style.display = showHumanActions ? "" : "none";
    retreatBtn.style.display = showHumanActions ? "" : "none";
    surrenderBtn.style.display = showHumanActions ? "" : "none";
  }

  // Hero portraits flank the battlefield, HoMM3-style — they stand outside
  // the grid rather than occupying a hex. Laid out horizontally (portrait
  // beside name + Cast Spell) rather than as a tall centered stack, so the
  // rail spends its height on platoons instead of chrome. Cast Spell is a
  // stub for now: no spell system exists yet, so the button just says so.
  function buildHeroPanel(label: string, accent: string): { panel: HTMLElement; castBtn: HTMLButtonElement } {
    const panel = document.createElement("div");
    Object.assign(panel.style, {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      flexShrink: "0",
      fontFamily: menuTheme.font,
      fontSize: "11px",
    });

    const portrait = document.createElement("div");
    Object.assign(portrait.style, {
      width: "38px",
      height: "38px",
      borderRadius: "50%",
      background: accent,
      border: "2px solid rgba(255,255,255,0.4)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: "16px",
      fontWeight: "700",
      color: "#fff",
      flexShrink: "0",
    });
    portrait.textContent = label.charAt(0);
    panel.appendChild(portrait);

    const meta = document.createElement("div");
    Object.assign(meta.style, { display: "flex", flexDirection: "column", gap: "4px", flex: "1", minWidth: "0" });

    const nameEl = document.createElement("div");
    nameEl.textContent = label;
    nameEl.style.opacity = "0.85";
    nameEl.style.fontWeight = "600";
    meta.appendChild(nameEl);

    const castBtn = document.createElement("button");
    castBtn.textContent = "Cast Spell";
    styleButton(castBtn);
    castBtn.disabled = true;
    castBtn.style.opacity = "0.4";
    castBtn.style.cursor = "not-allowed";
    castBtn.style.fontSize = "10.5px";
    castBtn.style.padding = "3px 7px";
    castBtn.title = "Spellcasting isn't implemented yet";
    meta.appendChild(castBtn);

    panel.appendChild(meta);
    return { panel, castBtn };
  }

  // The player's own roster rail: hero panel, then a scrolling column of
  // platoon strips, then any hero-level actions pinned to the bottom. Fixed
  // narrow width, so the battlefield's share of the viewport never depends on
  // how many platoons are in play — the old status bars were 320px each and
  // grew a second column of tiles, which is what squeezed the grid. There's
  // no equivalent rail for the opponent — only the player's own units belong
  // on the player's screen; enemy detail is inspected on the battlefield
  // itself (see showInfoPopupFor).
  function buildRail(
    heroLabel: string,
    railLabel: string,
    accent: string,
  ): { rail: HTMLElement; list: HTMLElement; castBtn: HTMLButtonElement; actions: HTMLElement } {
    const rail = document.createElement("div");
    Object.assign(rail.style, {
      width: `${RAIL_WIDTH}px`,
      flexShrink: "0",
      display: "flex",
      flexDirection: "column",
      gap: "8px",
      minHeight: "0",
      fontFamily: menuTheme.font,
    });

    const hero = buildHeroPanel(heroLabel, accent);
    rail.appendChild(hero.panel);

    const heading = document.createElement("div");
    Object.assign(heading.style, {
      fontSize: "10px",
      letterSpacing: "0.06em",
      textTransform: "uppercase",
      opacity: "0.55",
      borderBottom: "1px solid rgba(255,255,255,0.08)",
      paddingBottom: "4px",
      flexShrink: "0",
    });
    heading.textContent = railLabel;
    rail.appendChild(heading);

    const list = document.createElement("div");
    Object.assign(list.style, {
      flex: "1 1 0",
      minHeight: "0",
      overflowY: "auto",
      display: "flex",
      flexDirection: "column",
      gap: "4px",
    });
    rail.appendChild(list);

    const actions = document.createElement("div");
    Object.assign(actions.style, { display: "flex", flexDirection: "column", gap: "4px", flexShrink: "0" });
    rail.appendChild(actions);

    return { rail, list, castBtn: hero.castBtn, actions };
  }

  const humanRail = buildRail("You", "Your Army", humanAccent);

  // Takes all the width the rail doesn't. flex-basis 0 plus min-width/
  // min-height 0 makes this box's size depend purely on the row, never on the
  // canvas inside it — which is what keeps the ResizeObserver below from
  // feeding its own canvas resize back in as a layout change.
  const battlefield = document.createElement("div");
  Object.assign(battlefield.style, {
    flex: "1 1 0",
    minWidth: "0",
    minHeight: "0",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  });

  // Wrapped in its own positioned div so the info popup can be positioned in
  // simple canvas-local coordinates. Deliberately not overflow:hidden — the
  // card is allowed to escape the canvas bounds (see showInfoPopupFor).
  const canvasWrap = document.createElement("div");
  canvasWrap.style.position = "relative";
  canvasWrap.style.flexShrink = "0";
  battlefield.appendChild(canvasWrap);

  const canvas = document.createElement("canvas");
  canvas.style.background = "#14161a";
  canvas.style.borderRadius = "4px";
  canvas.style.display = "block";
  canvasWrap.appendChild(canvas);
  const ctx = canvas.getContext("2d")!;

  const infoPopup = createPlatoonInfoPopup(canvasWrap);

  battleRow.append(humanRail.rail, battlefield);

  // Retreat/Surrender are human-only actions, so they sit at the bottom of
  // the human's own rail rather than in the shared action bar — see the
  // comments where retreatBtn/surrenderBtn are built, and renderActions for
  // the turn-gated visibility.
  humanRail.actions.append(retreatBtn, surrenderBtn);
  const humanCastBtn = humanRail.castBtn;

  // The hex size is solved for the available battlefield box on every layout
  // change, rather than drawing at a fixed size and scaling the bitmap down.
  // The old approach kept a fixed 34px-hex buffer and shrank its CSS size to
  // fit, which at 1280x720 left the grid rendering at ~27% — roughly 12px
  // hexes. Reflowing instead keeps hexes legible at any viewport.
  let hexSize = HEX_SIZE_MAX;
  let offsetX = 0;
  let offsetY = 0;
  let canvasCssW = 0;
  let canvasCssH = 0;

  const unitExtent = gridExtent(state, 1);

  function relayoutCanvas(): void {
    const rect = battlefield.getBoundingClientRect();
    hexSize = fitHexSize(unitExtent, Math.max(160, rect.width), Math.max(160, rect.height));
    const extent = gridExtent(state, hexSize);
    const pad = hexSize + CANVAS_MARGIN;
    canvasCssW = Math.ceil(extent.maxX - extent.minX + pad * 2);
    canvasCssH = Math.ceil(extent.maxY - extent.minY + pad * 2);
    offsetX = -extent.minX + pad;
    offsetY = -extent.minY + pad;

    // Back the canvas at device resolution so hex outlines and unit counts
    // stay crisp on HiDPI displays. All drawing math stays in CSS pixels via
    // the setTransform in draw(), so the canvas stays 1:1 with its layout box
    // and hit-testing needs no rescaling.
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = `${canvasCssW}px`;
    canvas.style.height = `${canvasCssH}px`;
    canvas.width = Math.round(canvasCssW * dpr);
    canvas.height = Math.round(canvasCssH * dpr);
    draw();
    // An open enemy info card was anchored against the previous hex size and
    // offsets, so it would now point at the wrong hex — simplest is to just
    // dismiss it rather than re-anchor. Easy to hit by expanding the battle
    // log, which reflows the canvas underneath a card that is already
    // showing.
    infoPopup.hide();
  }

  const resizeObserver = new ResizeObserver(() => relayoutCanvas());
  resizeObserver.observe(battlefield);

  function toCanvas(q: number, r: number): { x: number; y: number } {
    const { x, y } = axialToPixel(q, r, hexSize);
    return { x: x + offsetX, y: y + offsetY };
  }

  // Which horizontal side of `subject` counts as "behind the line" — away
  // from the opposing army's average position, so an info popup anchored
  // there never covers the ground between the two armies. Computed live off
  // positions rather than hardcoded to a side, since attacker/defender can
  // deploy from either edge (see BattleGrid.sideChoice).
  function behindSide(subject: Combatant, opponents: Combatant[]): "left" | "right" {
    const living = opponents.filter(isAlive);
    if (living.length === 0) return "left";
    const subjectX = toCanvas(subject.position.q, subject.position.r).x;
    const avgOpponentX = living.reduce((sum, c) => sum + toCanvas(c.position.q, c.position.r).x, 0) / living.length;
    return subjectX >= avgOpponentX ? "right" : "left";
  }

  // The stat rows that used to sit on every always-on roster tile. They now
  // render inside the info card, so they're one hover away rather than
  // permanently occupying 640px of screen width.
  //
  // Atk/Def use the numerically dominant entry (most units) rather than an
  // average, since a platoon can mix up to MAX_PLATOON_ENTRIES unit types —
  // same "pick the entry that actually represents the platoon" idea as
  // computeSpecialty, just simpler since it's a single number. Speed instead
  // reuses platoonSpeed() directly: it's already the real mechanical value
  // (min speed across entries) movement range is computed from.
  function statsFor(c: Combatant): { label: string; value: string }[] {
    const living = c.entries.filter((e) => e.count > 0);
    if (living.length === 0) return [];
    const dominant = living.reduce((a, b) => (b.count > a.count ? b : a));
    const unit = state.unitTypes[dominant.unitTypeId];
    const stats: { label: string; value: string }[] = [];
    if (unit) {
      stats.push({ label: "Atk", value: String(unit.attack) });
      stats.push({ label: "Def", value: String(unit.defence) });
    }
    stats.push({ label: "Spd", value: String(platoonSpeed(c, state.unitTypes)) });
    stats.push({ label: "Rng", value: isRangedPlatoon(c, state.unitTypes) ? String(RANGED_ATTACK_RANGE) : "Melee" });
    // Terrain placeholder — the game has no terrain-bonus mechanic yet (see
    // docs/terrain-plan.md). Same pattern as the Morale/Fatigue placeholders
    // below: the slot exists ahead of the mechanic, so wiring in a real value
    // later is a one-line change here.
    stats.push({ label: "Terrain", value: "—" });
    return stats;
  }

  // Morale + Fatigue placeholders. No mechanic behind these yet — the values
  // are hard-coded (morale 100, fatigue 0) so the slot exists for when the
  // combat system tracks them; see docs/morale-fatigue-plan.md.
  function metricsFor(): { label: string; value: number; color: string }[] {
    const morale = 1;
    const fatigue = 0;
    return [
      { label: "Morale", value: morale, color: morale > 0.5 ? "#4caf50" : morale > 0.25 ? "#ffb300" : "#e53935" },
      { label: "Fatigue", value: fatigue, color: fatigue < 0.25 ? "#4caf50" : fatigue < 0.5 ? "#ffb300" : "#e53935" },
    ];
  }

  // Only ever called for an enemy platoon clicked on the battlefield — your
  // own platoons have no equivalent popup anymore, since their detail
  // expands inline in the roster rail instead (see buildPlatoonStrip and
  // renderRails). `winVsSlot` (a human slotIndex) adds the win-odds row when
  // one of your own platoons is selected while you inspect the enemy.
  function showInfoPopupFor(combatant: Combatant, winVsSlot: number | null): void {
    const accent = combatant.side === "attacker" ? ATTACKER_ACCENT : DEFENDER_ACCENT;
    const ownerLabel = combatant.side === humanSide ? "Your platoon" : "Enemy platoon";
    const opponents = combatant.side === "attacker" ? state.defender : state.attacker;
    const canAct = combatant.side === humanSide && unactedLivingSlots(state, humanSide).includes(combatant.slotIndex);
    const movementRemaining = getMovementRange(state, combatant).length;
    const anchor = toCanvas(combatant.position.q, combatant.position.r);
    const winner = winVsSlot === null ? undefined : getCombatant(state, humanSide, winVsSlot);
    const specialty = visibleSpecialty(state, combatant);
    // The canvas is snug around the hex grid — far too tight to fit a popup
    // beside an edge-column unit without covering it. canvasWrap has no
    // overflow:hidden, so give the popup the real on-screen room (the whole
    // viewport, minus a margin) rather than clamping it to the canvas bounds.
    const wrapRect = canvasWrap.getBoundingClientRect();
    const margin = 12;
    infoPopup.show({
      combatant,
      unitTypes: state.unitTypes,
      accent,
      ownerLabel,
      canAct,
      movementRemaining,
      specialty: specialty ? { icon: specialtyIcon(specialty.tag), label: specialty.tag } : undefined,
      stats: statsFor(combatant),
      metrics: metricsFor(),
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
    // All drawing below is in CSS pixels; the device-pixel backing store is
    // applied here rather than by inflating the layout coordinates, so
    // hit-testing in the click handler needs no rescaling.
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvasCssW, canvasCssH);
    pruneExpiredEffects(performance.now());

    // Hexes holding one of your platoons that hasn't acted yet. Every platoon
    // has to move each round, so rather than a separate turn-order readout,
    // the grid itself shows what's still waiting on you. Suppressed while the
    // AI is acting so the only thing lit up is the platoon actually moving.
    const availableHexes = aiActing
      ? []
      : unactedLivingSlots(state, humanSide)
          .map((slot) => getCombatant(state, humanSide, slot))
          .filter((c): c is Combatant => c !== undefined)
          .map((c) => c.position);

    for (const hex of state.grid.hexes) {
      const { x, y } = toCanvas(hex.q, hex.r);
      const corners = hexCorners(x, y, hexSize - 1);
      ctx.beginPath();
      corners.forEach((c, i) => (i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y)));
      ctx.closePath();
      const inRange = moveRange.some((h) => h.q === hex.q && h.r === hex.r);
      ctx.fillStyle = hex.impassable ? "#3a2a2a" : inRange ? "rgba(210,210,215,0.35)" : "#20242c";
      ctx.fill();

      const isAvailable = availableHexes.some((h) => h.q === hex.q && h.r === hex.r);
      ctx.strokeStyle = isAvailable ? "rgba(255,214,102,0.9)" : "rgba(255,255,255,0.08)";
      ctx.lineWidth = isAvailable ? 2 : 1;
      ctx.stroke();
    }

    for (const t of attackTargets) {
      const { x, y } = toCanvas(t.position.q, t.position.r);
      ctx.beginPath();
      ctx.arc(x, y, hexSize * 0.8, 0, Math.PI * 2);
      ctx.strokeStyle = "#e05050";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // The hex the telegraphed AI platoon is about to hit. Drawn during the
    // first beat only (cleared once the attack resolves), so the player knows
    // where the blow is coming before it lands rather than reconstructing it
    // from the health bars afterwards.
    if (aiTargetHex) {
      const { x, y } = toCanvas(aiTargetHex.q, aiTargetHex.r);
      const corners = hexCorners(x, y, hexSize - 1);
      ctx.beginPath();
      corners.forEach((c, i) => (i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y)));
      ctx.closePath();
      ctx.fillStyle = "rgba(224,80,80,0.22)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,120,120,0.95)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // The walked path, faded in behind a platoon while it is sliding along it,
    // so a five-hex move reads as a route rather than a blur.
    if (moveAnim) {
      ctx.strokeStyle = "rgba(255,255,255,0.28)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      moveAnim.path.forEach((hex, i) => {
        const { x, y } = toCanvas(hex.q, hex.r);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    // Expanding ring on the hex that just took a hit.
    if (impact) {
      const t = clamp01((performance.now() - impact.startedAt) / IMPACT_MS);
      const { x, y } = toCanvas(impact.hex.q, impact.hex.r);
      ctx.beginPath();
      ctx.arc(x, y, hexSize * (0.5 + t * 0.55), 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,190,90,${(1 - t) * 0.9})`;
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    // The AI platoon that is about to act, telegraphed for one beat before its
    // move resolves so the player can follow what the opponent is doing. Uses
    // the animated position so the ring travels with it during the walk.
    if (aiActingSlot !== null) {
      const acting = getCombatant(state, aiSide, aiActingSlot);
      if (acting && isAlive(acting)) {
        const { x, y } = renderPixelFor(acting);
        ctx.beginPath();
        ctx.arc(x, y, hexSize * 0.78, 0, Math.PI * 2);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 3;
        ctx.stroke();
      }
    }

    for (const side of ["attacker", "defender"] as const) {
      for (const c of side === "attacker" ? state.attacker : state.defender) {
        if (!isAlive(c)) continue;
        const { x, y } = renderPixelFor(c);
        const isSelected = side === humanSide && c.slotIndex === selectedSlot;
        ctx.beginPath();
        ctx.arc(x, y, hexSize * 0.55, 0, Math.PI * 2);
        ctx.fillStyle = side === "attacker" ? (isSelected ? "#5fb0ff" : "#3070c0") : isSelected ? "#ff7a7a" : "#c04040";
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = isSelected ? 2 : 1;
        ctx.stroke();

        const count = c.entries.reduce((sum, e) => sum + e.count, 0);
        ctx.fillStyle = "#fff";
        ctx.font = `${Math.round(hexSize * 0.4)}px ${menuTheme.font}`;
        ctx.textAlign = "center";
        ctx.fillText(String(count), x, y + hexSize * 0.14);

        const pct = hpRatio(state, c);
        const barW = hexSize * 1.1;
        const barX = x - barW / 2;
        const barY = y + hexSize * 0.55 + 3;
        ctx.fillStyle = "#000";
        ctx.fillRect(barX, barY, barW, 4);
        ctx.fillStyle = hpColor(pct);
        ctx.fillRect(barX, barY, barW * pct, 4);
      }
    }

    // Casualty counts drifting up off whoever just got hit — drawn last so
    // they sit above the platoon markers. Counterattacks spawn their own,
    // which is how a trade reads as a trade.
    for (const f of floats) {
      const t = clamp01((performance.now() - f.startedAt) / FLOAT_MS);
      const { x, y } = toCanvas(f.hex.q, f.hex.r);
      const alpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
      ctx.font = `700 ${Math.round(hexSize * 0.5)}px ${menuTheme.font}`;
      ctx.textAlign = "center";
      ctx.lineWidth = 3;
      ctx.strokeStyle = `rgba(0,0,0,${alpha * 0.85})`;
      ctx.strokeText(f.text, x, y - hexSize * (0.7 + t * 0.9));
      ctx.fillStyle = `rgba(255,214,102,${alpha})`;
      ctx.fillText(f.text, x, y - hexSize * (0.7 + t * 0.9));
    }
  }

  function clamp01(n: number): number {
    return n < 0 ? 0 : n > 1 ? 1 : n;
  }

  // Where a combatant should be *drawn*, which differs from where it is in
  // engine state only while it is mid-walk: movePlatoon has already put it on
  // its destination hex, and moveAnim rewinds that visually for the duration
  // of the slide. Interpolates in pixel space between consecutive path hexes.
  function renderPixelFor(c: Combatant): { x: number; y: number } {
    if (!moveAnim || moveAnim.side !== c.side || moveAnim.slotIndex !== c.slotIndex) {
      return toCanvas(c.position.q, c.position.r);
    }
    const path = moveAnim.path;
    if (path.length === 0) return toCanvas(c.position.q, c.position.r);
    if (path.length === 1) return toCanvas(path[0].q, path[0].r);
    const t = clamp01((performance.now() - moveAnim.startedAt) / moveAnim.durationMs);
    const scaled = t * (path.length - 1);
    const i = Math.min(path.length - 2, Math.floor(scaled));
    const localT = scaled - i;
    const a = toCanvas(path[i].q, path[i].r);
    const b = toCanvas(path[i + 1].q, path[i + 1].r);
    return { x: a.x + (b.x - a.x) * localT, y: a.y + (b.y - a.y) * localT };
  }

  function livingEnemyAt(hex: Axial): Combatant | undefined {
    const enemies = aiSide === "attacker" ? state.attacker : state.defender;
    return enemies.find((e) => isAlive(e) && e.position.q === hex.q && e.position.r === hex.r);
  }

  // The cursor's sector can point at a hex that's impassable, already taken,
  // or simply out of reach this round. Rather than offering nothing, snap to
  // the legal approach hex closest in angle — so hovering an enemy you *can*
  // reach always yields a usable attack, whichever way you point.
  function pickApproachForEdge(target: Combatant, approaches: { hex: Axial; cost: number }[], edge: number): Axial {
    const wanted = {
      q: target.position.q + HEX_DIRECTIONS[edge].q,
      r: target.position.r + HEX_DIRECTIONS[edge].r,
    };
    const exact = approaches.find((a) => a.hex.q === wanted.q && a.hex.r === wanted.r);
    if (exact) return exact.hex;

    let best = approaches[0];
    let bestGap = Infinity;
    for (const a of approaches) {
      const dir = HEX_DIRECTIONS.findIndex(
        (d) => target.position.q + d.q === a.hex.q && target.position.r + d.r === a.hex.r,
      );
      const raw = Math.abs(dir - edge);
      const gap = Math.min(raw, 6 - raw);
      if (gap < bestGap) {
        bestGap = gap;
        best = a;
      }
    }
    return best.hex;
  }

  function resolveHover(
    hex: Axial,
    localX: number,
    localY: number,
  ): { target: Combatant; approaches: { hex: Axial; cost: number }[]; choice: Axial } | null {
    if (aiActing || isBattleOver(state) || selectedSlot === null) return null;
    const actor = getCombatant(state, humanSide, selectedSlot);
    if (!actor || isRangedPlatoon(actor, state.unitTypes)) return null;

    // Over the enemy itself: latch it, and read the approach hex off whichever
    // sixth of its hex the cursor occupies.
    const enemy = livingEnemyAt(hex);
    if (enemy) {
      const approaches = getApproachHexes(state, actor, enemy);
      if (approaches.length === 0) return null;
      const center = axialToPixel(enemy.position.q, enemy.position.r, hexSize);
      const edge = nearestHexEdge(center.x, center.y, localX, localY);
      return { target: enemy, approaches, choice: pickApproachForEdge(enemy, approaches, edge) };
    }

    // Cursor has left the enemy and is sitting on one of its approach hexes.
    // Hold the latch and take that hex verbatim — this is the click fallback
    // for when you'd rather name the hex than aim at a sector.
    if (pendingTarget) {
      const onApproach = approachHexes.find((a) => a.hex.q === hex.q && a.hex.r === hex.r);
      if (onApproach) return { target: pendingTarget, approaches: approachHexes, choice: onApproach.hex };
    }
    return null;
  }

  // mousemove fires far too often to repaint on every event, so this diffs the
  // latch and the chosen hex and only redraws when one of them actually moved.
  function updateHover(localX: number, localY: number): void {
    const prevTarget = pendingTarget;
    const prevChoice = approachChoice;

    const resolved = resolveHover(pixelToAxial(localX, localY, hexSize), localX, localY);
    if (resolved) {
      pendingTarget = resolved.target;
      approachHexes = resolved.approaches;
      approachChoice = resolved.choice;
    } else {
      clearPendingAttack();
    }

    canvas.style.cursor = pendingTarget ? "crosshair" : "";
    // Latching or dropping a target changes the action-bar help text too, so
    // that case needs a full refresh; swinging the arrow around a target
    // already latched only moves pixels on the canvas.
    if (prevTarget !== pendingTarget) {
      refresh();
      return;
    }
    const sameChoice =
      prevChoice === approachChoice ||
      (prevChoice !== null && approachChoice !== null && prevChoice.q === approachChoice.q && prevChoice.r === approachChoice.r);
    if (!sameChoice) draw();
  }

  function selectPlatoon(slotIndex: number): void {
    selectedSlot = slotIndex;
    clearPendingAttack();
    const combatant = getCombatant(state, humanSide, slotIndex);
    if (!combatant) {
      selectedSlot = null;
      moveRange = [];
      attackTargets = [];
    } else {
      moveRange = getMovementRange(state, combatant);
      attackTargets = getValidAttackTargets(state, combatant);
    }
    refresh();
  }

  // Called after a successful move. If the move landed it adjacent to
  // exactly *one* enemy platoon, that's an unambiguous bump into melee
  // contact and the fight resolves immediately — no separate "attack" click
  // required.
  //
  // The "exactly one" is the point. This used to fire whenever *any* enemy
  // was adjacent, with pickTarget choosing which one to hit — so walking
  // between two enemies handed the target choice to the engine, which is
  // precisely what directional targeting exists to give back to the player.
  // With two or more in contact we fall through below: both light up as
  // attack targets and the click decides. Aiming a specific enemy from a
  // specific side never comes through here at all — that's attackFromHex,
  // driven by the hover latch in handleClick.
  //
  // Otherwise, re-show any in-range ranged targets (still
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
    clearPendingAttack();
    const combatant = getCombatant(state, humanSide, selectedSlot);
    if (!combatant) {
      selectedSlot = null;
      moveRange = [];
      attackTargets = [];
      refresh();
      return;
    }
    const adjacentEnemies = getValidMeleeTargets(state, combatant);
    if (adjacentEnemies.length === 1) {
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
      // Hands over to the AI exactly like the attack and End Turn paths do.
      // It used to jump straight to your next platoon instead, which is why
      // the opening round played as "you move all eight, then the AI moves
      // all eight": during the approach nothing is in range, so every platoon
      // took this branch and the AI never got a beat until your pool was
      // empty. See afterPlayerAction for the one-for-one alternation.
      afterPlayerAction();
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
    clearPendingAttack();
    infoPopup.hide();
    advanceAi();
  }

  // Every damage entry appended by the beat we just resolved becomes a
  // floating casualty count over whoever took it. Driven off the engine log
  // rather than before/after health diffing, so a counterattack shows up as
  // its own float on the other platoon without any special casing.
  function spawnDamageFloats(sinceLength: number): void {
    for (let i = sinceLength; i < state.log.length; i++) {
      const entry = state.log[i];
      if (entry.kind !== "damage") continue;
      const targetSide: BattleSide = entry.side === "attacker" ? "defender" : "attacker";
      const victim = getCombatant(state, targetSide, entry.targetSlot);
      if (!victim) continue;
      const lost = entry.casualties.reduce((sum, c) => sum + c.count, 0);
      floats.push({
        hex: { ...victim.position },
        text: lost > 0 ? `-${lost}` : "0",
        startedAt: performance.now(),
      });
    }
  }

  // Hands control back to the player once the AI has nothing more to do this
  // round. Focuses their next waiting platoon so its movement range is
  // already showing — the convenience the old auto-end path provided before
  // it was folded into the normal alternation.
  function endAiPhase(): void {
    aiActing = false;
    aiActingSlot = null;
    aiTargetHex = null;
    if (selectedSlot === null && !isBattleOver(state) && unactedLivingSlots(state, humanSide).length > 0) {
      focusNextUnactedPlatoon();
      return;
    }
    refresh();
  }

  // Plays one AI platoon's turn as a sequence of readable beats rather than
  // resolving it in a single frame:
  //
  //   1. ring the actor and flash the hex it intends to hit
  //   2. walk it hex by hex along the path it actually takes
  //   3. brief pause on arrival
  //   4. resolve the attack — impact ring plus floating casualty counts
  //   5. hand back, or take another platoon if the player has nothing waiting
  //
  // Steps 2 and 4 are skipped when the plan has no move / no attack. The
  // engine work is unchanged; planAiTurn just lets us decide first and apply
  // in pieces, so the visuals can sit between the decision and its effect.
  async function stepAi(): Promise<void> {
    const token = aiRunToken;
    if (isBattleOver(state)) {
      finishBattle();
      return;
    }
    const plan: AiTurnPlan | null = planAiTurn(state, aiSide);
    if (!plan) {
      endAiPhase();
      return;
    }

    const actor = getCombatant(state, aiSide, plan.slotIndex);
    aiActingSlot = plan.slotIndex;
    const plannedTarget =
      plan.attackTargetSlot !== null
        ? getCombatant(state, aiSide === "attacker" ? "defender" : "attacker", plan.attackTargetSlot)
        : undefined;
    aiTargetHex = plannedTarget ? { ...plannedTarget.position } : null;
    refresh();
    if (!(await aiWait(AI_TELEGRAPH_MS)) || token !== aiRunToken) return;

    if (plan.moveTo && actor) {
      const from = { ...actor.position };
      const path = getMovementPath(state, actor, plan.moveTo);
      const distance = hexDistance(from, plan.moveTo);
      movePlatoon(state, aiSide, plan.slotIndex, plan.moveTo);
      if (path.length > 0) {
        recordMove(aiSide, plan.slotIndex, distance);
        debugLog(`ai move: ${platoonLabel(aiSide, plan.slotIndex)}: ${fmtHex(from)} -> ${fmtHex(plan.moveTo)} (${distance} hex${distance === 1 ? "" : "es"})`);
        const durationMs = Math.min(path.length * AI_MOVE_MS_PER_HEX, AI_MOVE_MS_MAX);
        moveAnim = { side: aiSide, slotIndex: plan.slotIndex, path: [from, ...path], startedAt: performance.now(), durationMs };
        pumpAnimation();
        if (!(await aiWait(durationMs + AI_ARRIVE_PAUSE_MS)) || token !== aiRunToken) return;
      }
      moveAnim = null;
    }

    // The move is done and the walk has played out; drop the intent flash so
    // the impact reads as the consequence rather than more telegraphing.
    aiTargetHex = null;
    const beforeLog = state.log.length;
    const struck = plan.attackTargetSlot !== null ? getCombatant(state, aiSide === "attacker" ? "defender" : "attacker", plan.attackTargetSlot) : undefined;
    // Second half of executeAiPlan — the move above already ran, ahead of the
    // walk animation. Same fallback: if the attack is refused the platoon
    // still ends its turn, or its slot would never leave the unacted pool.
    if (plan.attackTargetSlot === null || !attackWithPlatoon(state, aiSide, plan.slotIndex, plan.attackTargetSlot)) {
      endPlatoonTurn(state, aiSide, plan.slotIndex);
    }
    logNewBattleEvents(beforeLog);
    const landedHits = state.log.length > beforeLog;
    if (landedHits) {
      if (struck) impact = { hex: { ...struck.position }, startedAt: performance.now() };
      spawnDamageFloats(beforeLog);
      pumpAnimation();
    }
    aiActingSlot = null;
    refresh();
    if (landedHits && (!(await aiWait(AI_IMPACT_HOLD_MS)) || token !== aiRunToken)) return;

    if (isBattleOver(state)) {
      finishBattle();
      return;
    }
    // Keep going only while the player has nothing in hand — that tail is how
    // the AI finishes a round in which it out-numbers the player's remaining
    // platoons. Otherwise control alternates back after this single beat.
    if (unactedLivingSlots(state, humanSide).length === 0 && unactedLivingSlots(state, aiSide).length > 0) {
      if (!(await aiWait(AI_STEP_MS)) || token !== aiRunToken) return;
      void stepAi();
      return;
    }
    endAiPhase();
  }

  function advanceAi(): void {
    if (isBattleOver(state)) {
      finishBattle();
      return;
    }
    if (unactedLivingSlots(state, aiSide).length === 0) {
      refresh();
      return;
    }
    aiActing = true;
    // Paint "AI's Turn" and lock the controls before the first beat lands.
    refresh();
    aiTimer = window.setTimeout(() => {
      aiTimer = null;
      void stepAi();
    }, AI_STEP_MS);
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
    // The AI's turn now takes real time, so the board can be mid-change when a
    // click lands. Ignore input until it hands control back.
    if (aiActing) {
      debugLog(`click ${fmtHex(hex)} -> ignored (AI is acting)`);
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

    // Directional melee, and it has to be tested before both the plain-attack
    // and the move branches below. A hex that is an approach hex for the
    // latched enemy is *also* an ordinary move-range hex, so whichever branch
    // runs first defines what the click means: with an enemy latched by hover
    // it means "close in from here and attack", and with nothing latched the
    // move branch below gives it its usual meaning.
    if (pendingTarget && approachChoice) {
      const clickedApproach = approachHexes.find((a) => a.hex.q === hex.q && a.hex.r === hex.r);
      const clickedTarget = hex.q === pendingTarget.position.q && hex.r === pendingTarget.position.r;
      if (clickedApproach || clickedTarget) {
        const from = clickedApproach ? clickedApproach.hex : approachChoice;
        const actorBefore = getCombatant(state, humanSide, selectedSlot);
        const origin = actorBefore ? { ...actorBefore.position } : from;
        const distance = hexDistance(origin, from);
        debugLog(
          `click ${fmtHex(hex)} -> directional attack: ${platoonLabel(humanSide, selectedSlot)}`,
          `from ${fmtHex(from)} -> ${platoonLabel(pendingTarget.side, pendingTarget.slotIndex)}`,
        );
        const beforeLog = state.log.length;
        if (attackFromHex(state, humanSide, selectedSlot, pendingTarget.slotIndex, from)) {
          if (distance > 0) recordMove(humanSide, selectedSlot, distance);
          logNewBattleEvents(beforeLog);
          afterPlayerAction();
        } else {
          debugLog(`click ${fmtHex(hex)} -> directional attack REJECTED by engine (was previewed as legal)`);
          clearPendingAttack();
          refresh();
        }
        return;
      }
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
      clearPendingAttack();
      infoPopup.hide();
      refresh();
      return;
    }

    // Not an attack/move/deselect — last chance is inspecting an enemy
    // platoon directly (out of attack range, or you're simply choosing to
    // look rather than fight). Attack/move above always win when both are
    // possible, so this never steals a click from combat.
    const enemyCombatants = aiSide === "attacker" ? state.attacker : state.defender;
    const inspectable = enemyCombatants.find(
      (e) =>
        !e.retreated &&
        e.entries.some((entry) => entry.count > 0) &&
        e.position.q === hex.q &&
        e.position.r === hex.r,
    );
    if (inspectable) {
      debugLog(`click ${fmtHex(hex)} -> inspect ${platoonLabel(inspectable.side, inspectable.slotIndex)}`);
      showInfoPopupFor(inspectable, selectedSlot);
      return;
    }

    debugLog(`click ${fmtHex(hex)} -> no-op (not a legal move/attack/deselect target for ${platoonLabel(humanSide, selectedSlot)})`);
  }

  // The canvas is sized 1:1 with its layout box (the device-pixel backing is
  // applied via ctx.setTransform in draw, not by inflating the layout size),
  // so a click's canvas-local position needs no rescaling.
  canvas.addEventListener("click", (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left - offsetX;
    const y = e.clientY - rect.top - offsetY;
    handleClick(pixelToAxial(x, y, hexSize));
  });

  // Drives the directional-melee preview. Same coordinate conversion as the
  // click handler above, and the grid-local result feeds both the hex lookup
  // and the sector angle, which is measured against the target's grid-local
  // centre from axialToPixel.
  canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    updateHover(e.clientX - rect.left - offsetX, e.clientY - rect.top - offsetY);
  });

  canvas.addEventListener("mouseleave", () => {
    if (clearPendingAttack()) {
      canvas.style.cursor = "";
      draw();
    }
  });

  function renderTopBar(): void {
    roundEl.textContent = `Round ${state.round} / ${state.maxRounds}`;
    const phase = timeOfDayForRound(state.round);
    timeEl.textContent = `${TIME_OF_DAY_ICON[phase]} ${phase}`;

    const over = isBattleOver(state);
    // aiActing wins over the unacted-slot count: with the AI stepped on a
    // timer the player can still have platoons in hand while it's mid-turn.
    const yours = !over && !aiActing && unactedLivingSlots(state, humanSide).length > 0;
    turnEl.textContent = over ? "Battle Over" : yours ? "Your Turn" : "AI's Turn";
    turnEl.style.color = over ? "" : yours ? "#9ecbff" : "#ff9e9e";
  }

  function humanCombatants(): Combatant[] {
    return humanSide === "attacker" ? state.attacker : state.defender;
  }

  // Hovering a strip expands it in place (see buildPlatoonStrip) — the inline
  // equivalent of the old floating info card. Falls back to the selected
  // platoon, if any, when the pointer leaves the rail entirely.
  //
  // Delegated onto the list container, which survives every refresh, rather
  // than bound per strip. renderRails() replaces its children on each
  // refresh, and a removed element never fires mouseleave — so per-strip
  // listeners could strand a strip expanded after the pointer had already
  // left it. mouseover/mouseout bubble, so the persistent container sees both.
  function attachRailHover(list: HTMLElement): void {
    list.addEventListener("mouseover", (e) => {
      const strip = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-slot]");
      if (!strip || !list.contains(strip)) return;
      const slot = Number(strip.dataset.slot);
      if (slot === hoveredSlot) return;
      const combatant = humanCombatants().find((c) => c.slotIndex === slot);
      if (!combatant || !isAlive(combatant)) return;
      hoveredSlot = slot;
      renderRails();
    });
    list.addEventListener("mouseout", (e) => {
      // Ignore crossings between two strips inside the same list; only clear
      // when the pointer actually leaves the rail.
      const to = e.relatedTarget as Node | null;
      if (to && list.contains(to)) return;
      if (hoveredSlot === null) return;
      hoveredSlot = null;
      renderRails();
    });
  }

  attachRailHover(humanRail.list);

  function renderRails(): void {
    const actableSlots = unactedLivingSlots(state, humanSide);
    const expandedSlot = hoveredSlot ?? selectedSlot;

    const strips = humanCombatants().map((c) => {
      const selectable = !aiActing && actableSlots.includes(c.slotIndex);
      const expanded = c.slotIndex === expandedSlot && isAlive(c);
      const strip = buildPlatoonStrip({
        state,
        combatant: c,
        accent: humanAccent,
        selected: c.slotIndex === selectedSlot,
        dimmed: !actableSlots.includes(c.slotIndex),
        expanded,
        detail: expanded
          ? {
              unitTypes: state.unitTypes,
              stats: statsFor(c),
              metrics: metricsFor(),
              movementRemaining: getMovementRange(state, c).length,
              canAct: actableSlots.includes(c.slotIndex),
            }
          : undefined,
      });
      strip.dataset.slot = String(c.slotIndex);
      if (selectable) {
        strip.style.cursor = "pointer";
        strip.addEventListener("click", () => selectPlatoon(c.slotIndex));
      }
      return strip;
    });
    humanRail.list.replaceChildren(...strips);
  }

  function refresh(): void {
    draw();
    renderRails();
    renderTopBar();
    renderActions();
    renderLog();
  }

  relayoutCanvas();
  refresh();
}
