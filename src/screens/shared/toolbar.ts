import type { GameState } from "../../state/gameState";
import type { SaveStatus } from "../../managers/SessionManager";
import { openSettingsMenu, type MapInfo } from "@screens/home/settingsMenu";
import { openTestBattleSetup } from "@screens/combat/testBattleSetup";
import { openNewGameModal, type NewGameHandler } from "./newGameModal";
import { openLoadGameModal, type LoadGameHandler } from "./loadGameModal";
import { openHotkeysModal, attachHotkeysShortcut } from "./hotkeysModal";

const headerTheme = {
  bg: "var(--header-blue, #1c2f57)",
  bgDark: "var(--header-blue-dark, #142145)",
  gold: "var(--header-gold, #c9a227)",
  goldLight: "var(--header-gold-light, #e9cf7d)",
  cream: "var(--header-cream, #f1e4c3)",
  font: "var(--header-font, Georgia, 'Times New Roman', serif)",
};

function styleHeaderButton(btn: HTMLButtonElement, primary = false): void {
  Object.assign(btn.style, {
    padding: "6px 12px",
    background: primary ? headerTheme.gold : headerTheme.bgDark,
    color: primary ? "#241a05" : headerTheme.cream,
    border: `1px solid ${primary ? headerTheme.goldLight : headerTheme.gold}`,
    borderRadius: "3px",
    fontSize: "12px",
    fontWeight: primary ? "700" : "400",
    fontFamily: headerTheme.font,
    cursor: "pointer",
    whiteSpace: "nowrap",
  });
}

function makeStatChip(labelText: string): { chip: HTMLDivElement; value: HTMLSpanElement } {
  const chip = document.createElement("div");
  Object.assign(chip.style, {
    display: "inline-flex",
    alignItems: "baseline",
    gap: "4px",
  });
  const label = document.createElement("span");
  label.textContent = labelText;
  Object.assign(label.style, {
    opacity: "0.65",
    fontSize: "10px",
    textTransform: "uppercase",
    letterSpacing: "0.4px",
  });
  const value = document.createElement("span");
  Object.assign(value.style, { fontSize: "12px", fontWeight: "600" });
  chip.appendChild(label);
  chip.appendChild(value);
  return { chip, value };
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
  nextTurnGold: number;
  wealth: number;
  morale: number | null;
  effectiveIncome: number | null;
}

export interface ToolbarState {
  backendOk: () => boolean;
  hasActiveGame: () => boolean;
  canEndTurnNow: () => boolean;
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

export class Toolbar {
  readonly root: HTMLDivElement;
  readonly statusSlot: HTMLDivElement;
  private newBtn: HTMLButtonElement;
  private loadBtn: HTMLButtonElement;
  private saveBtn: HTMLButtonElement;
  private endTurnBtn: HTMLButtonElement;
  private heroesBtn: HTMLButtonElement;
  private settlementsBtn: HTMLButtonElement;
  private charterBtn: HTMLButtonElement;
  private calendarEl: HTMLElement;
  private calendarActiveEl: HTMLElement;
  private busy = false;

  constructor(private opts: ToolbarOptions) {
    this.root = document.createElement("div");
    Object.assign(this.root.style, {
      width: "100%",
      boxSizing: "border-box",
      background: headerTheme.bg,
      borderBottom: `4px double ${headerTheme.gold}`,
      boxShadow: "0 2px 10px rgba(0,0,0,0.5)",
      fontFamily: headerTheme.font,
      color: headerTheme.cream,
      userSelect: "none",
    });

    const menuWrap = document.createElement("div");
    Object.assign(menuWrap.style, { position: "relative", flexShrink: "0", marginLeft: "auto" });

    const gear = document.createElement("button");
    gear.textContent = "⚙";
    gear.title = "Menu";
    Object.assign(gear.style, {
      width: "24px",
      height: "24px",
      padding: "0",
      fontSize: "14px",
      lineHeight: "1",
      cursor: "pointer",
      background: headerTheme.bgDark,
      border: `1px solid ${headerTheme.gold}`,
      borderRadius: "3px",
      color: headerTheme.cream,
      fontFamily: headerTheme.font,
      flexShrink: "0",
    });
    menuWrap.appendChild(gear);

    const dropdown = document.createElement("div");
    Object.assign(dropdown.style, {
      position: "absolute",
      top: "calc(100% + 6px)",
      right: "0",
      minWidth: "170px",
      background: headerTheme.bgDark,
      border: `1px solid ${headerTheme.gold}`,
      borderRadius: "4px",
      boxShadow: "0 4px 14px rgba(0,0,0,0.6)",
      padding: "6px",
      display: "none",
      flexDirection: "column",
      gap: "2px",
      zIndex: "50",
    });
    menuWrap.appendChild(dropdown);

    const closeDropdown = () => {
      dropdown.style.display = "none";
    };
    const toggleDropdown = () => {
      dropdown.style.display = dropdown.style.display === "none" ? "flex" : "none";
    };
    gear.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleDropdown();
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
        padding: "6px 10px",
        background: "transparent",
        color: headerTheme.cream,
        border: "none",
        borderRadius: "3px",
        fontSize: "12px",
        fontFamily: headerTheme.font,
        cursor: "pointer",
      });
      item.addEventListener("mouseenter", () => { item.style.background = "rgba(201,162,39,0.18)"; });
      item.addEventListener("mouseleave", () => { item.style.background = "transparent"; });
      dropdown.appendChild(item);
      return item;
    };

    this.newBtn = makeMenuItem("New Game");
    this.saveBtn = makeMenuItem("💾 Save");
    this.saveBtn.title = "Save game";
    this.loadBtn = makeMenuItem("📂 Load");
    this.loadBtn.title = "Load game";

    const divider = document.createElement("div");
    Object.assign(divider.style, {
      height: "1px",
      background: "rgba(201,162,39,0.3)",
      margin: "4px 2px",
    });
    dropdown.appendChild(divider);

    const testBattleItem = makeMenuItem("⚔ Test Battle");
    testBattleItem.title = "Sandbox: player vs AI manual-fight arena (no effect on your real game)";
    testBattleItem.addEventListener("click", () => {
      closeDropdown();
      if (this.busy) return;
      openTestBattleSetup();
    });

    const hotkeysItem = makeMenuItem("⌨ Shortcuts");
    hotkeysItem.title = "Keyboard & mouse reference (also press ?)";
    hotkeysItem.addEventListener("click", () => {
      closeDropdown();
      openHotkeysModal();
    });

    const settingsItem = makeMenuItem("⚙ Settings");
    settingsItem.addEventListener("click", () => {
      closeDropdown();
      openSettingsMenu({ parent: document.body, getMapInfo: this.opts.callbacks.getMapInfo });
    });

    attachHotkeysShortcut();

    this.newBtn.addEventListener("click", () => {
      closeDropdown();
      if (this.busy) return;
      if (this.opts.state.hasActiveGame()) {
        if (!confirm("Start a new game? Current game will be lost.")) return;
      }
      openNewGameModal({ onNew: this.opts.callbacks.onNew });
    });
    this.saveBtn.addEventListener("click", () => {
      closeDropdown();
      if (this.busy) return;
      void this.runAsync(async () => {
        await this.opts.callbacks.onSave();
      });
    });
    this.loadBtn.addEventListener("click", () => {
      closeDropdown();
      if (this.busy) return;
      void openLoadGameModal({
        backendOk: this.opts.state.backendOk,
        onLoad: this.opts.callbacks.onLoad,
        onForget: this.opts.callbacks.onForget,
      });
    });

    const calendarWrap = document.createElement("div");
    Object.assign(calendarWrap.style, { padding: "8px 16px 0" });

    this.calendarEl = document.createElement("div");
    Object.assign(this.calendarEl.style, {
      display: "flex",
      flexWrap: "wrap",
      alignItems: "center",
      gap: "6px 20px",
      paddingBottom: "8px",
      marginBottom: "8px",
      borderBottom: "1px solid rgba(201,162,39,0.3)",
      fontSize: "12px",
    });

    const dayChip = makeStatChip("Day");
    dayChip.value.id = "toolbar-day-value";
    this.calendarEl.appendChild(dayChip.chip);

    const weekChip = makeStatChip("Week");
    weekChip.value.id = "toolbar-week-value";
    this.calendarEl.appendChild(weekChip.chip);

    const monthChip = makeStatChip("Month");
    monthChip.value.id = "toolbar-month-value";
    this.calendarEl.appendChild(monthChip.chip);

    this.calendarActiveEl = document.createElement("div");
    Object.assign(this.calendarActiveEl.style, {
      display: "inline-flex",
      alignItems: "center",
      gap: "6px",
      fontSize: "12px",
    });
    const swatch = document.createElement("span");
    swatch.id = "toolbar-active-swatch";
    Object.assign(swatch.style, {
      display: "inline-block",
      width: "10px",
      height: "10px",
      borderRadius: "50%",
      background: "#888",
      border: "1px solid rgba(0,0,0,0.4)",
    });
    this.calendarActiveEl.appendChild(swatch);
    const activeLabel = document.createElement("span");
    activeLabel.id = "toolbar-active-label";
    activeLabel.textContent = "—";
    Object.assign(activeLabel.style, { fontWeight: "600" });
    this.calendarActiveEl.appendChild(activeLabel);
    this.calendarEl.appendChild(this.calendarActiveEl);

    calendarWrap.appendChild(this.calendarEl);
    this.root.appendChild(calendarWrap);

    this.statusSlot = document.createElement("div");
    this.root.appendChild(this.statusSlot);

    const buttonsWrap = document.createElement("div");
    Object.assign(buttonsWrap.style, { padding: "8px 16px 10px" });

    const buttonsRow = document.createElement("div");
    Object.assign(buttonsRow.style, {
      display: "flex",
      flexWrap: "wrap",
      gap: "8px",
      alignItems: "center",
    });

    this.endTurnBtn = this.makeButton("▶  End Turn", true);
    this.endTurnBtn.addEventListener("click", () => {
      if (this.busy) return;
      if (!this.opts.state.canEndTurnNow()) return;
      void this.runAsync(async () => {
        await this.opts.callbacks.onEndTurn();
      });
    });

    this.heroesBtn = this.makeButton("⚔  Heroes", false);
    this.heroesBtn.addEventListener("click", () => {
      if (this.busy) return;
      this.opts.callbacks.onHeroes?.();
    });

    this.settlementsBtn = this.makeButton("⌂  Settlements", false);
    this.settlementsBtn.addEventListener("click", () => {
      if (this.busy) return;
      this.opts.callbacks.onSettlements?.();
    });

    const logisticsBtn = this.makeButton("🚚  Logistics", false);
    logisticsBtn.addEventListener("click", () => {
      if (this.busy) return;
      this.opts.callbacks.onOpenLogistics?.();
    });

    this.charterBtn = this.makeButton("⚒  Charter Settlement", true);
    this.charterBtn.addEventListener("click", () => {
      if (this.busy) return;
      this.opts.callbacks.onStartCharter?.();
    });

    buttonsRow.appendChild(this.endTurnBtn);
    buttonsRow.appendChild(this.heroesBtn);
    buttonsRow.appendChild(this.settlementsBtn);
    buttonsRow.appendChild(logisticsBtn);
    buttonsRow.appendChild(this.charterBtn);
    buttonsRow.appendChild(menuWrap);
    buttonsWrap.appendChild(buttonsRow);

    this.root.appendChild(buttonsWrap);
    opts.parent.appendChild(this.root);

    this.refresh();
  }

  refresh(): void {
    const ok = this.opts.state.backendOk();
    const active = this.opts.state.hasActiveGame();
    const endTurnOk = this.opts.state.canEndTurnNow();
    const hasGameState = this.opts.state.getCalendar() !== null;
    this.setEnabled(this.newBtn, ok && !this.busy);
    this.setEnabled(this.loadBtn, ok && !this.busy);
    this.setEnabled(this.saveBtn, ok && active && !this.busy);
    this.setEnabled(this.endTurnBtn, endTurnOk && !this.busy);
    this.setEnabled(this.heroesBtn, hasGameState && !this.busy);
    this.setEnabled(this.settlementsBtn, hasGameState && !this.busy);

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

    this.refreshCalendar();
  }

  private refreshCalendar(): void {
    const cal = this.opts.state.getCalendar();
    const dayEl = this.root.querySelector<HTMLElement>("#toolbar-day-value");
    const weekEl = this.root.querySelector<HTMLElement>("#toolbar-week-value");
    const monthEl = this.root.querySelector<HTMLElement>("#toolbar-month-value");
    const swatchEl = this.root.querySelector<HTMLElement>("#toolbar-active-swatch");
    const activeEl = this.root.querySelector<HTMLElement>("#toolbar-active-label");
    if (!dayEl || !weekEl || !monthEl || !swatchEl || !activeEl) return;
    if (!cal) {
      dayEl.textContent = "—";
      weekEl.textContent = "—";
      monthEl.textContent = "—";
      swatchEl.style.background = "#888";
      activeEl.textContent = "—";
      return;
    }
    dayEl.textContent = `Day ${cal.dayOfWeek} of 7`;
    weekEl.textContent = `Week ${cal.week}`;
    monthEl.textContent = `${cal.monthName} · day ${cal.dayOfMonth}`;
    swatchEl.style.background = cal.activePlayerColor;
    activeEl.textContent = `${cal.activePlayerName}'s turn`;
  }

  applyGameState(_state: GameState): void {
    this.refresh();
  }

  setBusy(value: boolean): void {
    this.busy = value;
    this.refresh();
  }

  private makeButton(label: string, primary: boolean): HTMLButtonElement {
    const b = document.createElement("button");
    b.textContent = label;
    styleHeaderButton(b, primary);
    return b;
  }

  private setEnabled(b: HTMLButtonElement, enabled: boolean): void {
    b.disabled = !enabled;
    b.style.opacity = enabled ? "1" : "0.4";
    b.style.cursor = enabled ? "pointer" : "default";
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
