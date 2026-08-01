// Playable HoMM3-style manual fight arena: renders the battle grid on a
// canvas and lets the player click their own platoons (in whatever order
// they choose) to move + attack, alternating with a simple AI opponent, via
// the engine in shared/combat/manualBattle.ts. Currently only reachable from
// the "Test Battle" sandbox (src/views/testBattleSetup.ts) — see that file's
// header for the scope boundary against the real game's battle flow.

import { axialToPixel, hexCorners, hexDistance, pixelToAxial, type Axial } from "../core/hex";
import { totalHealth } from "../../shared/combat/damage";
import {
  attackWithPlatoon,
  computeSpecialty,
  endPlatoonTurn,
  finalizeManualBattle,
  getCombatant,
  getMovementRange,
  getValidAttackTargets,
  getValidMeleeTargets,
  isBattleOver,
  movePlatoon,
  pickTarget,
  platoonSpeed,
  runAiTurn,
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
import { menuTheme, styleButton } from "./menu";

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
  const revealSpecialty =
    meetsThreshold && (c.side === viewerSide || c.scoutedBy.has(viewerSide));

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

  for (const e of c.entries) {
    if (e.count <= 0) continue;
    const line = document.createElement("div");
    line.style.fontSize = "10px";
    line.style.opacity = "0.85";
    line.textContent = `${state.unitTypes[e.unitTypeId]?.name ?? e.unitTypeId} x${e.count}`;
    tile.appendChild(line);
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
  });

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

  const header = document.createElement("div");
  Object.assign(header.style, {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 16px",
    background: menuTheme.panel.headerBackground,
    color: menuTheme.panel.headerColor,
    borderBottom: "1px solid rgba(255,255,255,0.08)",
    fontSize: "14px",
    fontWeight: "600",
    flexShrink: "0",
  });
  const titleEl = document.createElement("div");
  titleEl.textContent = `Test Battle — Manual Fight (You: ${humanSide === "attacker" ? "Blue" : "Red"})`;
  header.appendChild(titleEl);
  overlay.appendChild(header);

  function closeArena(): void {
    overlay.remove();
  }

  let selectedSlot: number | null = null;
  let moveRange: Axial[] = [];
  let attackTargets: Combatant[] = [];

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

  function renderFooterActions(): void {
    helpTextEl.textContent =
      selectedSlot === null
        ? "Click one of your platoons in the status bar (or on the grid) to act."
        : moveRange.length > 0
          ? "Click a highlighted hex to move (moving next to an enemy fights immediately). Steps left over can still be used — move again, attack a ringed enemy, or End Turn when done."
          : "Out of movement — click a ringed enemy to attack, or End Turn.";
    endTurnBtn.style.display = selectedSlot !== null ? "" : "none";
  }

  // Hero portraits flank the battlefield, HoMM3-style — they stand outside
  // the grid rather than occupying a hex. Cast Spell is a stub for now: no
  // spell system exists yet, so the button just explains that.
  function buildHeroPanel(label: string, accent: string): HTMLElement {
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

    return panel;
  }

  // Status bars flank the battlefield, one per side, each showing every
  // platoon on that side as a tile (composition + HP). Each bar is grouped
  // under its own hero portrait in one column, so the two armies read as
  // two distinct, color-coded blocks instead of a scattered row of panels.
  function buildStatusBar(label: string): HTMLElement {
    const bar = document.createElement("div");
    Object.assign(bar.style, {
      width: "150px",
      flexShrink: "0",
      display: "flex",
      flexDirection: "column",
      gap: "6px",
      maxHeight: "calc(100vh - 260px)",
      overflowY: "auto",
      fontFamily: menuTheme.font,
    });
    const heading = document.createElement("div");
    heading.textContent = label;
    Object.assign(heading.style, {
      fontWeight: "600",
      fontSize: "12px",
      opacity: "0.85",
      textAlign: "center",
    });
    bar.appendChild(heading);
    return bar;
  }

  function buildSideColumn(heroLabel: string, barLabel: string, accent: string): { column: HTMLElement; bar: HTMLElement } {
    const column = document.createElement("div");
    Object.assign(column.style, {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: "10px",
      flexShrink: "0",
    });
    column.appendChild(buildHeroPanel(heroLabel, accent));
    const bar = buildStatusBar(barLabel);
    column.appendChild(bar);
    return { column, bar };
  }

  const ATTACKER_ACCENT = "#3070c0";
  const DEFENDER_ACCENT = "#c04040";

  const { column: attackerColumn, bar: attackerBar } = buildSideColumn(
    humanSide === "attacker" ? "You" : "AI Opponent",
    humanSide === "attacker" ? "Your Platoons" : "Enemy Platoons",
    ATTACKER_ACCENT,
  );
  container.appendChild(attackerColumn);

  const canvas = document.createElement("canvas");
  canvas.style.background = "#14161a";
  canvas.style.borderRadius = "4px";
  canvas.style.flexShrink = "0";
  container.appendChild(canvas);
  const ctx = canvas.getContext("2d")!;

  const { column: defenderColumn, bar: defenderBar } = buildSideColumn(
    humanSide === "defender" ? "You" : "AI Opponent",
    humanSide === "defender" ? "Your Platoons" : "Enemy Platoons",
    DEFENDER_ACCENT,
  );
  container.appendChild(defenderColumn);

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
  container.appendChild(sidePanel);

  const layout = computeLayout(state);
  const pad = HEX_SIZE + 20;
  canvas.width = layout.maxX - layout.minX + pad * 2;
  canvas.height = layout.maxY - layout.minY + pad * 2;
  canvas.style.width = `${canvas.width}px`;
  canvas.style.height = `${canvas.height}px`;
  const offsetX = -layout.minX + pad;
  const offsetY = -layout.minY + pad;

  function toCanvas(q: number, r: number): { x: number; y: number } {
    const { x, y } = axialToPixel(q, r, HEX_SIZE);
    return { x: x + offsetX, y: y + offsetY };
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
    } else {
      moveRange = getMovementRange(state, combatant);
      attackTargets = getValidAttackTargets(state, combatant);
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

    if (selectedSlot === null) {
      const candidates = unactedLivingSlots(state, humanSide);
      const humanCombatants = humanSide === "attacker" ? state.attacker : state.defender;
      const combatant = humanCombatants.find(
        (c) => candidates.includes(c.slotIndex) && c.position.q === hex.q && c.position.r === hex.r,
      );
      if (combatant) {
        debugLog(`click ${fmtHex(hex)} -> select ${platoonLabel(humanSide, combatant.slotIndex)}`);
        selectPlatoon(combatant.slotIndex);
      } else {
        debugLog(`click ${fmtHex(hex)} -> no-op (no actable platoon there)`);
      }
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
      refresh();
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
}
