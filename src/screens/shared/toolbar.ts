import type { GameState } from "../../state/gameState";
import type { SaveStatus } from "../../managers/SessionManager";
import { openSettingsMenu, type MapInfo } from "@screens/home/settingsMenu";
import { openView } from "@screens/shared/viewLauncher";
import { openNewGameModal, type NewGameHandler } from "./newGameModal";
import { openLoadGameModal, type LoadGameHandler } from "./loadGameModal";
import { openHotkeysModal, attachHotkeysShortcut } from "./hotkeysModal";
import { makeStatPill } from "./statPill";
import { APP_VERSION, BUILD_TIME, BUILD_COMMIT, formatBuildTime } from "../../core/version";

const headerTheme = {
  bgTop: "var(--tb-bg-top, #1b2334)",
  bgBottom: "var(--tb-bg-bottom, #121826)",
  strip: "var(--tb-strip, #10151f)",
  surface: "var(--tb-surface, rgba(255,255,255,0.045))",
  surfaceHover: "var(--tb-surface-hover, rgba(255,255,255,0.1))",
  border: "var(--tb-border, rgba(148,163,184,0.22))",
  text: "var(--tb-text, #e9eef8)",
  textMuted: "var(--tb-text-muted, #9aa7bd)",
  textDim: "var(--tb-text-dim, #b6c0d4)",
  accent: "var(--tb-accent, #f2b93c)",
  accentLight: "var(--tb-accent-light, #ffd479)",
  accentInk: "var(--tb-accent-ink, #241a05)",
  menuBg: "var(--tb-menu-bg, rgba(20,26,40,0.98))",
  divider: "var(--tb-divider, rgba(148,163,184,0.18))",
  font: "var(--tb-font, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif)",
};

const BUTTON_TRANSITION =
  "background 120ms ease, border-color 120ms ease, box-shadow 120ms ease, filter 120ms ease, transform 80ms ease";

const SECONDARY_SHADOW = "var(--tb-shadow-control, inset 0 1px 0 rgba(255,255,255,0.05))";
// The ready ring is the header's "it's your turn" affordance: it only shows
// while End Turn is actionable, so a disabled button never glows.
const PRIMARY_READY_SHADOW =
  "var(--tb-shadow-ready, inset 0 1px 0 rgba(255,255,255,0.35), 0 2px 8px rgba(0,0,0,0.35), 0 0 0 3px rgba(242,185,60,0.16))";

type ButtonVariant = "primary" | "secondary" | "ghost";

function styleHeaderButton(btn: HTMLButtonElement, variant: ButtonVariant = "secondary"): void {
  const primary = variant === "primary";
  const ghost = variant === "ghost";
  Object.assign(btn.style, {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "7px",
    padding: "7px 13px",
    background: primary
      ? `linear-gradient(180deg, ${headerTheme.accentLight}, ${headerTheme.accent})`
      : ghost
        ? "transparent"
        : headerTheme.surface,
    color: primary ? headerTheme.accentInk : ghost ? headerTheme.textDim : headerTheme.text,
    border: `1px solid ${primary ? headerTheme.accentLight : headerTheme.border}`,
    borderRadius: "var(--tb-radius-control, 8px)",
    fontSize: "12.5px",
    fontWeight: primary ? "650" : "500",
    fontFamily: headerTheme.font,
    letterSpacing: "0.2px",
    whiteSpace: "nowrap",
    transition: BUTTON_TRANSITION,
    boxShadow: primary ? PRIMARY_READY_SHADOW : ghost ? "none" : SECONDARY_SHADOW,
  });
}

function makeKbdHint(text: string, onPrimary = false): HTMLSpanElement {
  const kbd = document.createElement("span");
  kbd.textContent = text;
  Object.assign(kbd.style, {
    fontSize: "9px",
    fontWeight: "700",
    lineHeight: "1.2",
    padding: "1px 4px",
    borderRadius: "var(--tb-radius-kbd, 4px)",
    color: onPrimary ? "rgba(36,26,5,0.55)" : headerTheme.textMuted,
    border: `1px solid ${onPrimary ? "rgba(36,26,5,0.25)" : headerTheme.border}`,
  });
  return kbd;
}

export interface CalendarSnapshot {
  day: number;
  week: number;
  dayOfWeek: number;
  month: number;
  dayOfMonth: number;
  monthName: string;
  activePlayerName: string;
  activePlayerColor: string;
  activePlayerIsYou: boolean;
  nextTurnGold: number;
  wealth: number;
  morale: number | null;
  effectiveIncome: number | null;
}

export interface ToolbarState {
  backendOk: () => boolean;
  hasActiveGame: () => boolean;
  canEndTurnNow: () => boolean;
  // S3 (logistics-interface-fixes plan §5.8): the Logistics button mirrors the
  // controller's turn gate -- enabled only during the local seat's own
  // PLAYER_TURN. Absent provider keeps the button always enabled (today's
  // behavior).
  canOpenLogistics?: () => boolean;
  getCalendar: () => CalendarSnapshot | null;
  getSaveStatus: () => SaveStatus;
  getLastSavedAt: () => string | null;
  getZoom: () => number;
}

export interface ToolbarCallbacks {
  onNew: NewGameHandler;
  onLoad: LoadGameHandler;
  onSave: () => void | Promise<void>;
  onEndTurn: () => void | Promise<void>;
  onHeroes?: () => void;
  onSettlements?: () => void;
  onOpenLogistics?: () => void;
  onForget?: (id: number) => void;
  getMapInfo?: () => MapInfo | null;
  onStartCharter?: () => void;
  canStartCharter?: () => boolean;
}

export interface ToolbarOptions {
  parent: HTMLElement;
  state: ToolbarState;
  callbacks: ToolbarCallbacks;
}

// Keyboard accelerators for the command row. They route through the same
// buttons (and therefore the same enable/busy gates) as the mouse, so a
// shortcut can never fire an action the toolbar would have refused.
const HOTKEY_BUTTONS: Record<
  string,
  "endTurnBtn" | "heroesBtn" | "settlementsBtn" | "logisticsBtn" | "charterBtn"
> = {
  e: "endTurnBtn",
  h: "heroesBtn",
  s: "settlementsBtn",
  l: "logisticsBtn",
  c: "charterBtn",
};

export class Toolbar {
  readonly root: HTMLDivElement;
  readonly statusSlot: HTMLDivElement;
  private newBtn: HTMLButtonElement;
  private loadBtn: HTMLButtonElement;
  private saveBtn: HTMLButtonElement;
  private endTurnBtn: HTMLButtonElement;
  private heroesBtn: HTMLButtonElement;
  private settlementsBtn: HTMLButtonElement;
  private logisticsBtn: HTMLButtonElement;
  private charterBtn: HTMLButtonElement;
  private calendarActiveEl: HTMLElement;
  private dateEl: HTMLElement;
  private swatchEl: HTMLElement;
  private activeEl: HTMLElement;
  private busy = false;

  constructor(private opts: ToolbarOptions) {
    this.root = document.createElement("div");
    Object.assign(this.root.style, {
      width: "100%",
      boxSizing: "border-box",
      background: `linear-gradient(180deg, ${headerTheme.bgTop}, ${headerTheme.bgBottom})`,
      borderBottom: `1px solid ${headerTheme.border}`,
      boxShadow: "var(--tb-shadow-header, 0 10px 28px rgba(0,0,0,0.45))",
      fontFamily: headerTheme.font,
      color: headerTheme.text,
      userSelect: "none",
    });

    // ── Row 1: status ────────────────────────────────────────────────
    // One date pill, then the HUD economy pills (buildHud appends into
    // statusSlot), then the turn indicator on the right.
    const statusRow = document.createElement("div");
    Object.assign(statusRow.style, {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      padding: "0 20px",
      minHeight: "34px",
      background: headerTheme.strip,
      borderBottom: `1px solid ${headerTheme.border}`,
      fontSize: "11.5px",
    });
    this.root.appendChild(statusRow);

    const datePill = makeStatPill();
    datePill.value.id = "toolbar-date-value";
    this.dateEl = datePill.value;
    statusRow.appendChild(datePill.chip);

    this.statusSlot = document.createElement("div");
    Object.assign(this.statusSlot.style, {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      flex: "1 1 auto",
      minWidth: "0",
    });
    statusRow.appendChild(this.statusSlot);

    this.calendarActiveEl = document.createElement("div");
    Object.assign(this.calendarActiveEl.style, {
      display: "inline-flex",
      alignItems: "center",
      gap: "8px",
      marginLeft: "auto",
      padding: "3px 12px 3px 10px",
      background: "rgba(242,185,60,0.1)",
      border: "1px solid rgba(242,185,60,0.45)",
      borderRadius: "var(--tb-radius-chip, 999px)",
      fontSize: "12px",
    });
    const swatch = document.createElement("span");
    swatch.id = "toolbar-active-swatch";
    Object.assign(swatch.style, {
      display: "inline-block",
      width: "9px",
      height: "9px",
      borderRadius: "50%",
      background: "#888",
      border: "1px solid rgba(0,0,0,0.4)",
      boxShadow: "0 0 0 2px rgba(255,255,255,0.08)",
    });
    this.swatchEl = swatch;
    this.calendarActiveEl.appendChild(swatch);
    const activeLabel = document.createElement("span");
    activeLabel.id = "toolbar-active-label";
    activeLabel.textContent = "—";
    Object.assign(activeLabel.style, { fontWeight: "600", color: headerTheme.text });
    this.activeEl = activeLabel;
    this.calendarActiveEl.appendChild(activeLabel);
    statusRow.appendChild(this.calendarActiveEl);

    // ── Row 2: commands, grouped by frequency ────────────────────────
    const buttonsWrap = document.createElement("div");
    Object.assign(buttonsWrap.style, { padding: "9px 20px" });

    const buttonsRow = document.createElement("div");
    Object.assign(buttonsRow.style, {
      display: "flex",
      flexWrap: "wrap",
      alignItems: "center",
      gap: "8px",
    });
    buttonsWrap.appendChild(buttonsRow);

    const makeGroup = (first: boolean): HTMLDivElement => {
      const group = document.createElement("div");
      Object.assign(group.style, {
        display: "inline-flex",
        alignItems: "center",
        gap: "8px",
      });
      if (!first) {
        group.style.marginLeft = "6px";
        group.style.paddingLeft = "14px";
        group.style.borderLeft = `1px solid ${headerTheme.divider}`;
      }
      buttonsRow.appendChild(group);
      return group;
    };

    this.endTurnBtn = this.makeButton("▶ End Turn", "primary");
    this.endTurnBtn.appendChild(makeKbdHint("E", true));
    this.endTurnBtn.addEventListener("click", () => {
      if (this.busy) return;
      if (!this.opts.state.canEndTurnNow()) return;
      void this.runAsync(async () => {
        await this.opts.callbacks.onEndTurn();
      });
    });
    makeGroup(true).appendChild(this.endTurnBtn);

    this.heroesBtn = this.makeButton("⚔ Heroes", "secondary");
    this.heroesBtn.appendChild(makeKbdHint("H"));
    this.heroesBtn.addEventListener("click", () => {
      if (this.busy) return;
      this.opts.callbacks.onHeroes?.();
    });

    this.settlementsBtn = this.makeButton("⌂ Settlements", "secondary");
    this.settlementsBtn.appendChild(makeKbdHint("S"));
    this.settlementsBtn.addEventListener("click", () => {
      if (this.busy) return;
      this.opts.callbacks.onSettlements?.();
    });

    this.logisticsBtn = this.makeButton("🚚 Logistics", "secondary");
    this.logisticsBtn.appendChild(makeKbdHint("L"));
    this.logisticsBtn.addEventListener("click", () => {
      if (this.busy) return;
      this.opts.callbacks.onOpenLogistics?.();
    });

    const manageGroup = makeGroup(false);
    manageGroup.append(this.heroesBtn, this.settlementsBtn, this.logisticsBtn);

    this.saveBtn = this.makeButton("💾 Save", "ghost");
    this.saveBtn.title = "Save game";
    this.saveBtn.addEventListener("click", () => {
      if (this.busy) return;
      void this.runAsync(async () => {
        await this.opts.callbacks.onSave();
      });
    });

    this.loadBtn = this.makeButton("📂 Load", "ghost");
    this.loadBtn.title = "Load game";
    this.loadBtn.addEventListener("click", () => {
      if (this.busy) return;
      void openLoadGameModal({
        backendOk: this.opts.state.backendOk,
        onLoad: this.opts.callbacks.onLoad,
        onForget: this.opts.callbacks.onForget,
      });
    });

    const withGhostHover = (b: HTMLButtonElement): void => {
      b.addEventListener("mouseenter", () => { b.style.background = headerTheme.surfaceHover; });
      b.addEventListener("mouseleave", () => { b.style.background = "transparent"; });
    };
    withGhostHover(this.saveBtn);
    withGhostHover(this.loadBtn);
    makeGroup(false).append(this.saveBtn, this.loadBtn);

    this.charterBtn = this.makeButton("⚒ Charter Settlement", "secondary");
    this.charterBtn.appendChild(makeKbdHint("C"));
    this.charterBtn.addEventListener("click", () => {
      if (this.busy) return;
      this.opts.callbacks.onStartCharter?.();
    });
    makeGroup(false).appendChild(this.charterBtn);

    // ── Gear menu: rare + destructive actions only ───────────────────
    const menuWrap = document.createElement("div");
    Object.assign(menuWrap.style, { position: "relative", flexShrink: "0", marginLeft: "auto", display: "flex", alignItems: "center" });

    const gear = document.createElement("button");
    gear.textContent = "⚙";
    gear.title = "Menu";
    Object.assign(gear.style, {
      width: "30px",
      height: "30px",
      padding: "0",
      fontSize: "15px",
      lineHeight: "1",
      background: headerTheme.surface,
      border: `1px solid ${headerTheme.border}`,
      borderRadius: "var(--tb-radius-control, 8px)",
      color: headerTheme.text,
      fontFamily: headerTheme.font,
      flexShrink: "0",
      transition: BUTTON_TRANSITION,
    });
    menuWrap.appendChild(gear);

    const dropdown = document.createElement("div");
    Object.assign(dropdown.style, {
      position: "absolute",
      top: "calc(100% + 8px)",
      right: "0",
      minWidth: "210px",
      background: headerTheme.menuBg,
      border: `1px solid ${headerTheme.border}`,
      borderRadius: "var(--tb-radius-menu, 12px)",
      boxShadow: "0 18px 44px rgba(0,0,0,0.6)",
      padding: "6px",
      display: "none",
      flexDirection: "column",
      gap: "2px",
      zIndex: "50",
    });
    menuWrap.appendChild(dropdown);
    buttonsRow.appendChild(menuWrap);

    const closeDropdown = () => {
      dropdown.style.display = "none";
    };
    gear.addEventListener("click", (e) => {
      e.stopPropagation();
      dropdown.style.display = dropdown.style.display === "none" ? "flex" : "none";
    });
    document.addEventListener("click", (e) => {
      if (!menuWrap.contains(e.target as Node)) closeDropdown();
    });

    const makeMenuItem = (label: string): HTMLButtonElement => {
      const item = document.createElement("button");
      item.textContent = label;
      Object.assign(item.style, {
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: "7px 10px",
        background: "transparent",
        color: headerTheme.text,
        border: "none",
        borderRadius: "var(--tb-radius-menu-item, 7px)",
        fontSize: "12.5px",
        fontFamily: headerTheme.font,
        transition: "background 120ms ease",
      });
      item.addEventListener("mouseenter", () => { item.style.background = headerTheme.surfaceHover; });
      item.addEventListener("mouseleave", () => { item.style.background = "transparent"; });
      dropdown.appendChild(item);
      return item;
    };

    this.newBtn = makeMenuItem("+  New Game");
    this.newBtn.addEventListener("click", () => {
      closeDropdown();
      if (this.busy) return;
      if (this.opts.state.hasActiveGame()) {
        if (!confirm("Start a new game? Current game will be lost.")) return;
      }
      openNewGameModal({ onNew: this.opts.callbacks.onNew });
    });

    const testBattleItem = makeMenuItem("⚔ Test Battle");
    testBattleItem.title = "Sandbox: player vs AI manual-fight arena (no effect on your real game)";
    testBattleItem.addEventListener("click", () => {
      closeDropdown();
      if (this.busy) return;
      void openView("testBattleSetup");
    });

    const hotkeysItem = makeMenuItem("⌨ Shortcuts");
    hotkeysItem.title = "Keyboard & mouse reference (also press ?)";
    hotkeysItem.addEventListener("click", () => {
      closeDropdown();
      openHotkeysModal();
    });

    makeMenuItem("⚙ Settings").addEventListener("click", () => {
      closeDropdown();
      openSettingsMenu({ parent: document.body, getMapInfo: this.opts.callbacks.getMapInfo });
    });

    const buildInfo = document.createElement("div");
    buildInfo.setAttribute("data-testid", "toolbar-build-info");
    Object.assign(buildInfo.style, {
      fontSize: "10.5px",
      color: headerTheme.textMuted,
      fontVariantNumeric: "tabular-nums",
      lineHeight: "1.35",
      padding: "5px 10px 3px 10px",
      marginTop: "4px",
      borderTop: `1px solid ${headerTheme.divider}`,
      userSelect: "text",
      cursor: "default",
    });

    const versionLine = document.createElement("div");
    versionLine.textContent = `v${APP_VERSION} (${BUILD_COMMIT})`;
    buildInfo.appendChild(versionLine);

    const builtLine = document.createElement("div");
    builtLine.textContent = `Built: ${formatBuildTime(BUILD_TIME)}`;
    builtLine.title = `Built: ${BUILD_TIME}`;
    buildInfo.appendChild(builtLine);

    dropdown.appendChild(buildInfo);

    attachHotkeysShortcut();

    document.addEventListener("keydown", (ev: KeyboardEvent) => {
      if (ev.ctrlKey || ev.metaKey || ev.altKey) {
        if (ev.key.toLowerCase() === "s") {
          ev.preventDefault();
          this.press(this.saveBtn);
        }
        return;
      }
      if (ev.key.length !== 1) return;
      const target = ev.target as HTMLElement | null;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      if (target?.isContentEditable) return;
      // openDialog marks its full-viewport wrapper, so an open dialog
      // (settings, load, charter requirements, ...) swallows the keystroke
      // instead of firing an action behind it.
      if (document.querySelector("[data-modal]")) return;
      const which = HOTKEY_BUTTONS[ev.key.toLowerCase()];
      if (which) this.press(this[which]);
    });

    this.root.appendChild(buttonsWrap);
    opts.parent.appendChild(this.root);

    this.refresh();
  }

  refresh(): void {
    const ok = this.opts.state.backendOk();
    const active = this.opts.state.hasActiveGame();
    const endTurnOk = this.opts.state.canEndTurnNow();
    const cal = this.opts.state.getCalendar();
    const hasGameState = cal !== null;
    this.setEnabled(this.newBtn, ok && !this.busy);
    this.setEnabled(this.loadBtn, ok && !this.busy);
    this.setEnabled(this.saveBtn, ok && active && !this.busy);
    this.setEnabled(this.endTurnBtn, endTurnOk && !this.busy);
    this.setEnabled(this.heroesBtn, hasGameState && !this.busy);
    this.setEnabled(this.settlementsBtn, hasGameState && !this.busy);
    const logisticsOk = hasGameState && !this.busy && (this.opts.state.canOpenLogistics?.() ?? true);
    this.setEnabled(this.logisticsBtn, logisticsOk);
    this.logisticsBtn.title = logisticsOk
      ? "Wagon pools, stockpiles and trade routes"
      : "Available on your turn";

    if (this.charterBtn) {
      const canOpen = hasGameState && !this.busy && (this.opts.callbacks.canStartCharter?.() ?? false);
      this.setEnabled(this.charterBtn, canOpen);
      this.charterBtn.title = !hasGameState
        ? "No active game"
        : canOpen
          ? "Charter a new settlement — 2500g + 20 wood + 15 stone"
          : "Requires a selected hero on your turn";
    }

    this.newBtn.title = !ok ? "Backend unavailable" : active ? "New game (current game will be lost)" : "Start a new game";
    this.loadBtn.title = !ok ? "Backend unavailable" : "Open a saved game";
    this.saveBtn.title = !ok ? "Backend unavailable" : active ? "Save current game" : "No active game to save";
    this.endTurnBtn.title = endTurnOk ? "End the current turn" : "Not your turn or action in progress";
    this.heroesBtn.title = hasGameState ? "View and manage heroes" : "No active game";
    this.settlementsBtn.title = hasGameState ? "View and manage settlements" : "No active game";

    this.refreshCalendar(cal);
  }

  private refreshCalendar(cal: CalendarSnapshot | null): void {
    const dateEl = this.dateEl;
    const swatchEl = this.swatchEl;
    const activeEl = this.activeEl;
    if (!dateEl || !swatchEl || !activeEl) return;
    if (!cal) {
      if (dateEl.textContent !== "—") dateEl.textContent = "—";
      if (swatchEl.style.background !== "#888") swatchEl.style.background = "#888";
      if (activeEl.textContent !== "—") activeEl.textContent = "—";
      return;
    }
    const dateText = `Week ${cal.week} · Day ${cal.dayOfWeek} of 7 · ${cal.monthName} ${cal.dayOfMonth}`;
    if (dateEl.textContent !== dateText) dateEl.textContent = dateText;
    if (swatchEl.style.background !== cal.activePlayerColor) swatchEl.style.background = cal.activePlayerColor;
    const activeText = cal.activePlayerIsYou ? "Your turn" : `${cal.activePlayerName}'s turn`;
    if (activeEl.textContent !== activeText) activeEl.textContent = activeText;
  }

  applyGameState(_state: GameState): void {
    this.refresh();
  }

  setBusy(value: boolean): void {
    this.busy = value;
    this.refresh();
  }

  private makeButton(label: string, variant: ButtonVariant): HTMLButtonElement {
    const b = document.createElement("button");
    b.textContent = label;
    styleHeaderButton(b, variant);
    return b;
  }

  private press(btn: HTMLButtonElement): void {
    if (this.busy || btn.disabled) return;
    btn.click();
  }

  private setEnabled(b: HTMLButtonElement, enabled: boolean): void {
    b.disabled = !enabled;
    if (b === this.endTurnBtn) {
      b.style.boxShadow = enabled ? PRIMARY_READY_SHADOW : SECONDARY_SHADOW;
    }
  }

  private async runAsync(fn: () => Promise<void>): Promise<void> {
    this.setBusy(true);
    try {
      await fn();
    } catch (e) {
      console.error("[toolbar] action failed:", e);
    } finally {
      this.setBusy(false);
    }
  }
}
