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

import { RANGED_ATTACK_RANGE, SURRENDER_COST_GOLD, SURRENDER_UNIT_VALUE_GOLD } from "@heroes/engine";
import {
  finalizeManualBattle,
  getCombatant,
  getMovementRange,
  getValidAttackTargets,
  getValidMeleeTargets,
  isBattleOver,
  isRangedPlatoon,
  pickTarget,
  platoonSpeed,
  startManualBattle,
  timeOfDayForRound,
  unactedLivingSlots,
  type TimeOfDay,
} from "@heroes/engine";
import type { BattleLogEntry, BattleSide, Combatant } from "@heroes/engine";
import type { Platoon, UnitType } from "../../../state/units";
import { showBattleResultCard } from "../battleResultCard";
import { openConfirmDialog } from "@screens/shared/confirmDialog";
import { menuTheme, styleButton } from "@screens/shared/menu";
import { createPlatoonInfoPopup } from "../platoonInfoPopup";
import { launchView } from "@screens/shared/viewLauncher";
import { CANVAS_MARGIN, DEBUG_LOG, HEX_SIZE_MAX, LOG_PREFIX, RAIL_WIDTH, debugLog } from "./constants";
import { axialToPixel, fmtHex, gridExtent, fitHexSize, hexCorners, hexDistance, hpColor, hpRatio, isAlive, pixelToAxial, platoonLabel, specialtyIcon, visibleSpecialty, type Axial } from "./layout";
import { applyLeaveBehind, openLeaveBehindDialog } from "./leaveBehind";
import { attachRailHover, buildPlatoonStrip } from "./view";
import { createArenaInput, type ArenaInput } from "./input";
import { createArenaAi, type ArenaAi } from "./ai";
import { attackFromSelectedHex, attackFromTarget, endPlatoonTurnAction, moveSelectedTo, retreatAction, surrenderAction } from "./state";
import { buildArenaPaint2dDeps, paintSceneForArena, readUseSceneBuilder } from "./paint";

// Key for indexing a specific unit entry inside the arena's combatant list.
// `slotIndex` is the army-stack slot, `unitTypeId` is which entry within
// that slot (a platoon can hold up to MAX_PLATOON_ENTRIES distinct types).

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

  // Dev-only paint2d/ SceneNode[] rendering path. Off by default; opt in via
  // ?paint=scenebuilder in the URL. Per
  // plan/2026-08-17-combat-decomposition-finishing-breakout.md §9.4. All eight
  // battle-kind painters are real transcriptions now (5.B P1 #5, PR #136), so
  // this path renders standalone -- draw() no longer falls back to drawLegacy().
  const useSceneBuilder = readUseSceneBuilder(window.location.search);
  const arenaPaint2dDeps = buildArenaPaint2dDeps({
    fontFamily: menuTheme.font,
    attackerAccent: ATTACKER_ACCENT,
    defenderAccent: DEFENDER_ACCENT,
  });

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
    // Bumping the run token also aborts an AI sequence already parked on an await.
    ai.bumpRunToken();
    ai.clearTimer();
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
  let hoveredHex: Axial | null = null;

  // Directional melee targeting is owned by the arena/input module — see
  // createArenaInput below. The latch survives the cursor leaving the enemy
  // and moving onto one of its approach hexes, so the click can name the hex
  // directly rather than aiming at a sector. While a latch is live, a click
  // on an approach hex is an *attack*; with no latch the same click is an
  // ordinary move — see handleClick for the branch ordering that
  // disambiguates the two meanings.

// The AI used to resolve its whole turn synchronously inside advanceAi(),
// with a single repaint at the end — the board simply teleported between the
// player's clicks and you never saw the opponent move. It is now narrated in
// discrete beats, one platoon per pass (see createArenaAi in arena/ai.ts):
// telegraph the actor and its intended target, walk it hex by hex along its
// real path, pause on arrival, then land the attack with an impact flash and
// a floating casualty count. `ai.isActing()` blocks player input for the
// duration. Timing constants and the run-token bookkeeping live in
// arena/ai.ts so closeArena() can cancel timers without juggling them here.
// Lifetimes of the two purely cosmetic overlays. Both outlive the beat that
// spawns them so the float is still drifting as control returns.
const IMPACT_MS = 300;
const FLOAT_MS = 800;

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
    endPlatoonTurnAction(state, humanSide, selectedSlot);
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
        retreatAction(state, humanSide);
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
          surrenderAction(state, humanSide);
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
          surrenderAction(state, humanSide);
          finishBattle();
        },
      });
    }
  });
  // Also moved into the human's hero panel — see the retreatBtn comment above.

  function renderActions(): void {
    const over = isBattleOver(state);
    const waitingOnAi = !over && (ai.isActing() || unactedLivingSlots(state, humanSide).length === 0);
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
          : input.getPendingTarget() !== null
            ? "The arrow shows which side you'll attack from — move the cursor around the enemy to swing it, then click to close in and fight. Click the marked hex itself if you'd rather pick it directly."
            : ranged
              ? moveRange.length > 0
                ? "Click a ringed enemy to shoot it from where you stand, or a highlighted hex to reposition. Move again, shoot, or End Turn when done."
                : "Out of movement — click a ringed enemy to shoot, or End Turn."
              : moveRange.length > 0
                ? "Hover an enemy in reach to choose the side you attack from, or click a highlighted hex to just move (landing beside a lone enemy fights immediately). Move again, attack, or End Turn when done."
                : "Out of movement — hover an adjacent enemy to attack from where you stand, or End Turn.";
    endTurnBtn.style.display = selectedSlot !== null && !over && !ai.isActing() ? "" : "none";

    // Cast Spell, Retreat, and Surrender live under the human's hero portrait
    // and only make sense while it's actually the human's turn to act — which
    // now excludes the beats where the AI is mid-move.
    const humanActing = unactedLivingSlots(state, humanSide).length > 0;
    const showHumanActions = !over && !ai.isActing() && humanActing;
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
    if (useSceneBuilder) {
      resetCanvasForFrame();
      paintSceneForArena({
        ctx,
        state,
        humanSide,
        aiSide,
        selectedSlot,
        moveRange,
        attackTargets,
        aiActing: ai.isActing(),
        aiActingSlot: ai.getActingSlot(),
        aiTargetHex: ai.getTargetHex(),
        moveAnim,
        impact,
        floats,
        hexSize,
        offsetX,
        offsetY,
        canvasCssW,
        canvasCssH,
        paint2d: arenaPaint2dDeps,
      });
    } else {
      drawLegacy();
    }
  }

  // All drawing is in CSS pixels; the device-pixel backing store is applied
  // here rather than by inflating the layout coordinates, so hit-testing in
  // the click handler needs no rescaling. Shared by both draw paths -- when
  // drawFallback still existed, drawLegacy() ran unconditionally every frame
  // and did this setup for both; now each path must do it for itself.
  function resetCanvasForFrame(): void {
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvasCssW, canvasCssH);
    pruneExpiredEffects(performance.now());
  }

  function drawLegacy(): void {
    resetCanvasForFrame();

    // Hexes holding one of your platoons that hasn't acted yet. Every platoon
    // has to move each round, so rather than a separate turn-order readout,
    // the grid itself shows what's still waiting on you. Suppressed while the
    // AI is acting so the only thing lit up is the platoon actually moving.
    const availableHexes = ai.isActing()
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

      const isHovered =
        !hex.impassable &&
        !ai.isActing() &&
        !isBattleOver(state) &&
        hoveredHex !== null &&
        hoveredHex.q === hex.q &&
        hoveredHex.r === hex.r;
      if (isHovered) {
        ctx.fillStyle = "rgba(180,220,255,0.12)";
        ctx.fill();
        ctx.strokeStyle = "rgba(180,220,255,0.85)";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
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
    const aiTargetHex = ai.getTargetHex();
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
    const aiActingSlot = ai.getActingSlot();
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

  function selectPlatoon(slotIndex: number): void {
    selectedSlot = slotIndex;
    input.clearPendingAttack();
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
    input.clearPendingAttack();
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
      attackFromTarget(state, humanSide, selectedSlot, target.slotIndex);
      logNewBattleEvents(beforeLog);
      afterPlayerAction();
      return;
    }
    moveRange = getMovementRange(state, combatant);
    attackTargets = getValidAttackTargets(state, combatant);
    if (moveRange.length === 0 && attackTargets.length === 0) {
      debugLog(`auto-end turn: ${platoonLabel(humanSide, selectedSlot)} exhausted movement with no attack targets`);
      endPlatoonTurnAction(state, humanSide, selectedSlot);
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
    input.clearPendingAttack();
    infoPopup.hide();
    ai.advance();
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
// it was folded into the normal alternation. This is the callback the
// ArenaAi module invokes via deps.endAiPhase() once its stepAi resolves.
function endAiPhase(): void {
  if (selectedSlot === null && !isBattleOver(state) && unactedLivingSlots(state, humanSide).length > 0) {
    focusNextUnactedPlatoon();
    return;
  }
  refresh();
}

// AI pacing itself (advance/step/endAiPhase setup) lives in arena/ai.ts via
// createArenaAi — the orchestrator just calls `ai.advance()` after each
// player action and lets the module own the run-token, timers, and the
// per-beat telegraph/walk/attack sequence. See plan/2026-08-17-combat-
// decomposition-finishing-breakout.md §6.2.
const ai: ArenaAi = createArenaAi({
  getState: () => state,
  getAiSide: () => aiSide,
  getHumanSide: () => humanSide,
  debugLog,
  recordMove,
  logNewBattleEvents,
  spawnDamageFloats,
  refresh: () => refresh(),
  pumpAnimation: () => pumpAnimation(),
  finishBattle: () => finishBattle(),
  endAiPhase: () => endAiPhase(),
  setMoveAnim: (anim) => {
    moveAnim = anim;
  },
  setImpact: (fx) => {
    impact = fx;
  },
});
// decomposition-finishing-breakout.md §6.2.

function finishBattle(): void {
    logMoveStats("battle end");
    const result = finalizeManualBattle(state);
    ai.bumpRunToken();
    ai.clearTimer();
    clearAnimations();
    selectedSlot = null;
    moveRange = [];
    attackTargets = [];
    input.clearPendingAttack();
    infoPopup.hide();
    refresh();
    showBattleResultCard({
      result,
      attackerLabel: humanSide === "attacker" ? "You" : "AI Opponent",
      defenderLabel: humanSide === "defender" ? "You" : "AI Opponent",
      onCarryOn: () => { closeArena(); },
    });
  }

  function handleClick(hex: Axial): void {
    if (isBattleOver(state)) {
      debugLog(`click ${fmtHex(hex)} -> ignored (battle over)`);
      return;
    }
    // The AI's turn now takes real time, so the board can be mid-change when a
    // click lands. Ignore input until it hands control back.
    if (ai.isActing()) {
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
    if (input.getPendingTarget() && input.getApproachChoice()) {
      const clickedApproach = input.getApproachHexes().find((a) => a.hex.q === hex.q && a.hex.r === hex.r);
      const clickedTarget = hex.q === input.getPendingTarget()!.position.q && hex.r === input.getPendingTarget()!.position.r;
      if (clickedApproach || clickedTarget) {
        const from = clickedApproach ? clickedApproach.hex : input.getApproachChoice()!;
        const actorBefore = getCombatant(state, humanSide, selectedSlot);
        const origin = actorBefore ? { ...actorBefore.position } : from;
        const distance = hexDistance(origin, from);
        debugLog(
          `click ${fmtHex(hex)} -> directional attack: ${platoonLabel(humanSide, selectedSlot)}`,
          `from ${fmtHex(from)} -> ${platoonLabel(input.getPendingTarget()!.side, input.getPendingTarget()!.slotIndex)}`,
        );
        const beforeLog = state.log.length;
        if (attackFromSelectedHex(state, humanSide, selectedSlot, input.getPendingTarget()!.slotIndex, from)) {
          if (distance > 0) recordMove(humanSide, selectedSlot, distance);
          logNewBattleEvents(beforeLog);
          afterPlayerAction();
        } else {
          debugLog(`click ${fmtHex(hex)} -> directional attack REJECTED by engine (was previewed as legal)`);
          input.clearPendingAttack();
          refresh();
        }
        return;
      }
    }

    const target = attackTargets.find((t) => t.position.q === hex.q && t.position.r === hex.r);
    if (target) {
      debugLog(`click ${fmtHex(hex)} -> attack: ${platoonLabel(humanSide, selectedSlot)} -> ${platoonLabel(target.side, target.slotIndex)}`);
      const beforeLog = state.log.length;
      attackFromTarget(state, humanSide, selectedSlot, target.slotIndex);
      logNewBattleEvents(beforeLog);
      afterPlayerAction();
      return;
    }

    if (moveRange.some((h) => h.q === hex.q && h.r === hex.r)) {
      const result = moveSelectedTo(state, humanSide, selectedSlot, hex);
      const from = result.from ?? hex;
      if (result.moved) {
        recordMove(humanSide, selectedSlot, result.distance);
        debugLog(
          `click ${fmtHex(hex)} -> move ${platoonLabel(humanSide, selectedSlot)}: ${fmtHex(from)} -> ${fmtHex(hex)}`,
          `(${result.distance} hex${result.distance === 1 ? "" : "es"}), movement left: ${result.remainingSteps > 0 ? `${result.remainingSteps} hexes reachable` : "none"}`,
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
      input.clearPendingAttack();
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
  const input: ArenaInput = createArenaInput({
    getState: () => state,
    getHumanSide: () => humanSide,
    getAiSide: () => aiSide,
    getHexSize: () => hexSize,
    getSelectedSlot: () => selectedSlot,
    isAiActing: () => ai.isActing(),
    isBattleOver: () => isBattleOver(state),
    getCursorTarget: () => canvas,
    draw: () => draw(),
    refresh: () => refresh(),
  });

  canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    const localX = e.clientX - rect.left - offsetX;
    const localY = e.clientY - rect.top - offsetY;
    const prevHex = hoveredHex;
    hoveredHex = pixelToAxial(localX, localY, hexSize);
    input.updateHover(localX, localY);
    const hoverChanged =
      (prevHex === null) !== (hoveredHex === null) ||
      (prevHex !== null &&
        hoveredHex !== null &&
        (prevHex.q !== hoveredHex.q || prevHex.r !== hoveredHex.r));
    if (
      hoverChanged &&
      input.getPendingTarget() === null &&
      input.getApproachChoice() === null
    ) {
      draw();
    }
  });

  canvas.addEventListener("mouseleave", () => {
    const hadPending = input.clearPendingAttack();
    const hadHovered = hoveredHex !== null;
    if (hadPending) canvas.style.cursor = "";
    hoveredHex = null;
    if (hadPending || hadHovered) draw();
  });

  function renderTopBar(): void {
    roundEl.textContent = `Round ${state.round} / ${state.maxRounds}`;
    const phase = timeOfDayForRound(state.round);
    timeEl.textContent = `${TIME_OF_DAY_ICON[phase]} ${phase}`;

    const over = isBattleOver(state);
    // aiActing wins over the unacted-slot count: with the AI stepped on a
    // timer the player can still have platoons in hand while it's mid-turn.
    const yours = !over && !ai.isActing() && unactedLivingSlots(state, humanSide).length > 0;
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
  // The listener wiring itself lives in arena/view.ts (attachRailHover); this
  // file passes the closure it needs to update hoveredSlot and re-render.
  attachRailHover({
    list: humanRail.list,
    getHumanCombatants: () => humanCombatants(),
    getHoveredSlot: () => hoveredSlot,
    onHoverChange: (slot) => {
      hoveredSlot = slot;
      renderRails();
    },
  });

  function renderRails(): void {
    const actableSlots = unactedLivingSlots(state, humanSide);
    const expandedSlot = hoveredSlot ?? selectedSlot;

    const strips = humanCombatants().map((c) => {
      const selectable = !ai.isActing() && actableSlots.includes(c.slotIndex);
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
