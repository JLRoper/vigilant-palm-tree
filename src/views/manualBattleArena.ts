// Playable HoMM3-style manual fight arena: renders the battle grid on a
// canvas and lets the player click their own platoons (in whatever order
// they choose) to move + attack, alternating with a simple AI opponent, via
// the engine in shared/combat/manualBattle.ts. Currently only reachable from
// the "Test Battle" sandbox (src/views/testBattleSetup.ts) — see that file's
// header for the scope boundary against the real game's battle flow.

import { axialToPixel, hexCorners, pixelToAxial, type Axial } from "../core/hex";
import { totalHealth } from "../../shared/combat/damage";
import {
  attackWithPlatoon,
  endPlatoonTurn,
  finalizeManualBattle,
  getCombatant,
  getMovementRange,
  getValidAttackTargets,
  isBattleOver,
  movePlatoon,
  runAiTurn,
  startManualBattle,
  unactedLivingSlots,
  type ManualBattleState,
} from "../../shared/combat/manualBattle";
import type { Combatant } from "../../shared/combat/types";
import type { Platoon, UnitType } from "../state/units";
import { showBattleResultCard } from "./battleResultCard";
import { menuTheme, openCenteredModal, styleButton } from "./menu";

const HEX_SIZE = 26;

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

function describeCombatant(state: ManualBattleState, c: Combatant): string {
  const parts = c.entries.map((e) => `${state.unitTypes[e.unitTypeId]?.name ?? e.unitTypeId} x${e.count}`);
  return parts.length > 0 ? parts.join(", ") : "(empty)";
}

export function openManualBattleArena(playerPlatoons: Platoon[], aiPlatoons: Platoon[], unitTypes: Record<string, UnitType>): void {
  const state = startManualBattle(playerPlatoons, aiPlatoons, {
    unitTypes,
    obstacleSeed: Math.floor(Math.random() * 1_000_000),
  });

  const modal = openCenteredModal(document.body, "Test Battle — Manual Fight", 1380, true);

  let selectedSlot: number | null = null;
  let moveRange: Axial[] = [];
  let attackTargets: Combatant[] = [];

  const container = document.createElement("div");
  container.style.display = "flex";
  container.style.gap = "10px";
  container.style.overflowX = "auto";
  modal.setContent(container);

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

  container.appendChild(buildHeroPanel("You", "#3070c0"));

  const canvas = document.createElement("canvas");
  canvas.style.background = "#14161a";
  canvas.style.borderRadius = "4px";
  canvas.style.flexShrink = "0";
  container.appendChild(canvas);
  const ctx = canvas.getContext("2d")!;

  container.appendChild(buildHeroPanel("AI Opponent", "#c04040"));

  const sidePanel = document.createElement("div");
  Object.assign(sidePanel.style, {
    width: "200px",
    flexShrink: "0",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    fontFamily: menuTheme.font,
    fontSize: "12px",
    maxHeight: "560px",
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
        const isSelected = side === "attacker" && c.slotIndex === selectedSlot;
        ctx.beginPath();
        ctx.arc(x, y, HEX_SIZE * 0.55, 0, Math.PI * 2);
        ctx.fillStyle = side === "attacker" ? (isSelected ? "#5fb0ff" : "#3070c0") : "#c04040";
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = isSelected ? 2 : 1;
        ctx.stroke();

        const count = c.entries.reduce((sum, e) => sum + e.count, 0);
        ctx.fillStyle = "#fff";
        ctx.font = `10px ${menuTheme.font}`;
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
    const combatant = getCombatant(state, "attacker", slotIndex);
    if (!combatant) {
      selectedSlot = null;
      moveRange = [];
      attackTargets = [];
    } else {
      // Movement range is calculated once, here, at the start of the
      // platoon's turn. After it moves (see handleClick's move branch) we
      // must NOT recompute it again from the new position — the engine
      // already refuses a second move via movePlatoon's moved-set check,
      // but getMovementRange would also just return [] for an
      // already-moved platoon, so this stays accurate either way.
      moveRange = getMovementRange(state, combatant);
      attackTargets = getValidAttackTargets(state, combatant);
    }
    refresh();
  }

  // Called after a successful move: the platoon has spent its one move for
  // this turn, so no further movement is offered — only an immediate attack
  // from the new position (if now in range) or ending the turn.
  function refreshAfterMove(): void {
    if (selectedSlot === null) return;
    const combatant = getCombatant(state, "attacker", selectedSlot);
    if (!combatant) {
      selectedSlot = null;
      moveRange = [];
      attackTargets = [];
      refresh();
      return;
    }
    moveRange = [];
    attackTargets = getValidAttackTargets(state, combatant);
    refresh();
  }

  function afterPlayerAction(): void {
    selectedSlot = null;
    moveRange = [];
    attackTargets = [];
    advanceAi();
  }

  function advanceAi(): void {
    if (isBattleOver(state)) {
      finishBattle();
      return;
    }
    if (unactedLivingSlots(state, "defender").length > 0) {
      runAiTurn(state, "defender");
    }
    if (isBattleOver(state)) {
      finishBattle();
      return;
    }
    while (unactedLivingSlots(state, "attacker").length === 0 && unactedLivingSlots(state, "defender").length > 0) {
      runAiTurn(state, "defender");
      if (isBattleOver(state)) {
        finishBattle();
        return;
      }
    }
    refresh();
  }

  function finishBattle(): void {
    const result = finalizeManualBattle(state);
    modal.close();
    showBattleResultCard({
      result,
      attackerLabel: "You",
      defenderLabel: "AI Opponent",
      onCarryOn: () => {},
    });
  }

  function handleClick(hex: Axial): void {
    if (isBattleOver(state)) return;

    if (selectedSlot === null) {
      const candidates = unactedLivingSlots(state, "attacker");
      const combatant = state.attacker.find(
        (c) => candidates.includes(c.slotIndex) && c.position.q === hex.q && c.position.r === hex.r,
      );
      if (combatant) selectPlatoon(combatant.slotIndex);
      return;
    }

    const target = attackTargets.find((t) => t.position.q === hex.q && t.position.r === hex.r);
    if (target) {
      attackWithPlatoon(state, "attacker", selectedSlot, target.slotIndex);
      afterPlayerAction();
      return;
    }

    if (moveRange.some((h) => h.q === hex.q && h.r === hex.r)) {
      movePlatoon(state, "attacker", selectedSlot, hex);
      refreshAfterMove();
      return;
    }

    const actor = getCombatant(state, "attacker", selectedSlot);
    if (actor && actor.position.q === hex.q && actor.position.r === hex.r) {
      selectedSlot = null;
      moveRange = [];
      attackTargets = [];
      refresh();
    }
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

    const roundLine = document.createElement("div");
    roundLine.textContent = `Round ${state.round}`;
    roundLine.style.fontWeight = "600";
    sidePanel.appendChild(roundLine);

    const instructions = document.createElement("div");
    instructions.style.opacity = "0.65";
    instructions.style.fontSize = "10px";
    instructions.textContent =
      selectedSlot === null
        ? "Click one of your platoons below (or on the grid) to act."
        : moveRange.length > 0
          ? "Click a highlighted hex to move, or a ringed enemy to attack."
          : "Already moved this turn — click a ringed enemy to attack, or End Turn.";
    sidePanel.appendChild(instructions);

    const listLabel = document.createElement("div");
    listLabel.textContent = "Your platoons:";
    listLabel.style.marginTop = "4px";
    sidePanel.appendChild(listLabel);

    for (const slot of unactedLivingSlots(state, "attacker")) {
      const c = getCombatant(state, "attacker", slot);
      if (!c) continue;
      const btn = document.createElement("button");
      btn.textContent = describeCombatant(state, c);
      styleButton(btn, slot === selectedSlot);
      btn.style.textAlign = "left";
      btn.style.whiteSpace = "normal";
      btn.addEventListener("click", () => selectPlatoon(slot));
      sidePanel.appendChild(btn);
    }

    if (unactedLivingSlots(state, "attacker").length === 0) {
      const waiting = document.createElement("div");
      waiting.textContent = "Waiting on the AI to finish its round...";
      waiting.style.opacity = "0.6";
      waiting.style.fontSize = "10px";
      sidePanel.appendChild(waiting);
    }

    if (selectedSlot !== null) {
      const endTurnBtn = document.createElement("button");
      endTurnBtn.textContent = "End Turn (Don't Attack)";
      styleButton(endTurnBtn);
      endTurnBtn.style.marginTop = "6px";
      endTurnBtn.addEventListener("click", () => {
        endPlatoonTurn(state, "attacker", selectedSlot!);
        afterPlayerAction();
      });
      sidePanel.appendChild(endTurnBtn);
    }
  }

  function refresh(): void {
    draw();
    renderSidePanel();
  }

  refresh();
}
