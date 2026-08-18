// Playable HoMM3-style manual fight arena: renders the battle grid on a
// canvas and lets the player click their own platoons (in whatever order
// they choose) to move + attack, alternating with a simple AI opponent, via
// the engine in shared/combat/manualBattle.ts. Currently only reachable from
// the "Test Battle" sandbox (src/screens/combat/testBattleSetup.ts) â€” see that file's
// header for the scope boundary against the real game's battle flow.
//
// Layout is battlefield-first: the grid takes whatever room is left after one
// narrow roster rail â€” the player's own â€” and it *reflows* (the hex size is
// solved for the available box) rather than being drawn at a fixed size and
// scaled down. There's no rail for the opponent; only your own units belong
// on your screen. A platoon strip's full detail (composition, stats, morale/
// fatigue, movement) stays collapsed until that platoon is hovered or
// selected, when the strip itself expands in place â€” see buildPlatoonStrip.
// Enemy platoons have no rail to expand into, so clicking one on the
// battlefield still opens the floating info card â€” see showInfoPopupFor.

import { RANGED_ATTACK_RANGE, SURRENDER_COST_GOLD, SURRENDER_UNIT_VALUE_GOLD } from "@heroes/engine";
import {
  attackFromHex,
  attackWithPlatoon,
  endPlatoonTurn,
  finalizeManualBattle,
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
  unactedLivingSlots,
  type AiTurnPlan,
  type ManualBattleState,
  type TimeOfDay,
} from "@heroes/engine";
import type { BattleLogEntry, BattleSide, Combatant } from "@heroes/engine";
import type { Platoon, UnitType } from "../../state/units";
import { showBattleResultCard } from "./battleResultCard";
import { openConfirmDialog } from "@screens/shared/confirmDialog";
import { menuTheme, styleButton } from "@screens/shared/menu";
import { createPlatoonInfoPopup } from "./platoonInfoPopup";
import { launchView, registerView } from "@screens/shared/viewLauncher";
import { CANVAS_MARGIN, DEBUG_LOG, LOG_PREFIX, RAIL_WIDTH, debugLog } from "./arena/constants";
import { axialToPixel, fmtHex, gridExtent, fitHexSize, hexCorners, hexDistance, hpColor, hpRatio, isAlive, pixelToAxial, platoonLabel, type Axial, type GridExtent, specialtyIcon, visibleSpecialty } from "./arena/layout";
import { applyLeaveBehind, openLeaveBehindDialog } from "./arena/leaveBehind";
import { attachRailHover, buildPlatoonStrip, type PlatoonStripDetail } from "./arena/view";
import { createArenaInput, type ArenaInput } from "./arena/input";

registerView("manualBattleArena", (opts) => {
  const o = opts as { playerPlatoons: Platoon[]; aiPlatoons: Platoon[]; unitTypes: Record<string, UnitType>; humanSide: BattleSide };
  openManualBattleArena(o.playerPlatoons, o.aiPlatoons, o.unitTypes, o.humanSide);
});

// Key for indexing a specific unit entry inside the arena's combatant list.
// `slotIndex` is the army-stack slot, `unitTypeId` is which entry within
// that slot (a platoon can hold up to MAX_PLATOON_ENTRIES distinct types).
type LeaveBehindKey = string;

function leaveBehindKey(slotIndex: number, unitTypeId: string): LeaveBehindKey {
  return `${slotIndex}:${unitTypeId}`;
}

// Strips the selected unit counts off the human side's surviving
// combatants so they show up as casualties on the final result card (see
// buildResults in packages/engine/src/combat/resolveBattle.ts â€” it diffs
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
// behind" (sacrifice) until the gold shortfall is met â€” each unit is
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
    `You can't cover the surrender cost. Pick units to leave behind â€” each ` +
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
      label.textContent = `Platoon ${c.slotIndex + 1} â€” ${name} Ã—${e.count}`;
      row.appendChild(label);

      const controls = document.createElement("div");
      Object.assign(controls.style, { display: "flex", gap: "4px", alignItems: "center" });

      const minus = document.createElement("button");
      minus.textContent = "âˆ’";
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
      (enough ? " âœ“" : "");
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
// platoon's surviving units â€” matches the "at least 40% archers â†’ archery"
// threshold the design doc calls out, and prevents a single surviving
// unit of a different type from flipping the icon after one stray
// casualty.
const SPECIALTY_VISIBILITY_THRESHOLD = 0.4;

function isAlive(c: Combatant): boolean {
  return !c.retreated && c.entries.some((e) => e.count > 0);
}

// Dominant specialty, recomputed live from entries (no cached state) so it
// naturally shifts when casualties flip the dominant unit type â€” e.g. the
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

// Detail shown only in a strip's expanded state â€” the same shape of data
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
// hovered or selected platoon), it grows in place to show the full readout â€”
// composition, Atk/Def/Spd/Rng, morale, fatigue, movement left â€” that used
// to live only in a floating info card. This is the density change the rest
// of the layout depends on: sixteen always-on stat tiles previously consumed
// 640px of width that the battlefield now gets, with the detail spent only
// on the one platoon actually being looked at.
function buildPlatoonStrip(opts: {
  state: ManualBattleState;
  combatant: Combatant;
  accent: string;
  selected: boolean;
  // Rendered spent â€” "has already acted this round".
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
  icon.textContent = !alive ? "âœ•" : specialty ? specialtyIcon(specialty.tag) : "Â·";
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
  else count.textContent = `Ã—${totalUnits(c.entries)}`;
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