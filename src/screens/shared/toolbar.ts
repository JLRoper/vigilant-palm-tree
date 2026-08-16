import type { Game } from "../../io/api";
import { api } from "../../io/api";
import { forgetGame, listUserGames, type UserGameEntry } from "../../io/userGames";
import type { GameState } from "../../state/gameState";
import type { SaveStatus } from "../../managers/SessionManager";
import { CASTLE_COUNT_MAX } from "../../map/castlePlacement";
import { openSettingsMenu, type MapInfo } from "@screens/home/settingsMenu";
import { openTestBattleSetup } from "@screens/combat/testBattleSetup";
import {
  menuTheme,
  openCenteredModal,
  styleButton,
  styleInput,
} from "./menu";

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
  onNew: (opts: {
    name: string;
    seed: number;
    castleSeed?: number;
    castleCount?: number;
    mapSize?: "small" | "medium" | "large";
  }) => void | Promise<void>;
  onLoad: (game: Game, tiles: Awaited<ReturnType<typeof api.getTiles>>) => void | Promise<void>;
  onSave: () => void | Promise<void>;
  onEndTurn: () => void | Promise<void>;
  onHeroes?: () => void;
  onSettlements?: () => void;
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
  private testBattleBtn: HTMLButtonElement;
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

    const settingsItem = makeMenuItem("⚙ Settings");
    settingsItem.addEventListener("click", () => {
      closeDropdown();
      openSettingsMenu({ parent: document.body, getMapInfo: this.opts.callbacks.getMapInfo });
    });

    this.newBtn.addEventListener("click", () => {
      closeDropdown();
      if (this.busy) return;
      if (this.opts.state.hasActiveGame()) {
        if (!confirm("Start a new game? Current game will be lost.")) return;
      }
      this.openNewModal();
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
      void this.openLoadModal();
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

    this.charterBtn = this.makeButton("⚒  Charter Settlement", true);
    this.charterBtn.addEventListener("click", () => {
      if (this.busy) return;
      this.opts.callbacks.onStartCharter?.();
    });

    this.testBattleBtn = this.makeButton("Test Battle", false);
    this.testBattleBtn.title = "Sandbox: player vs AI manual-fight arena (no effect on your real game)";
    this.testBattleBtn.addEventListener("click", () => {
      if (this.busy) return;
      openTestBattleSetup();
    });

    buttonsRow.appendChild(this.endTurnBtn);
    buttonsRow.appendChild(this.heroesBtn);
    buttonsRow.appendChild(this.settlementsBtn);
    buttonsRow.appendChild(this.charterBtn);
    buttonsRow.appendChild(this.testBattleBtn);
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
    this.setEnabled(this.testBattleBtn, !this.busy);

    if (this.charterBtn) {
      const canCharter = hasGameState && !this.busy && (this.opts.callbacks.canStartCharter?.() ?? false);
      this.setEnabled(this.charterBtn, canCharter);
      this.charterBtn.title = canCharter
        ? "Found a new settlement (2500g + 20 wood + 15 stone)"
        : "Hero must be on a friendly settlement with enough resources";
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

  private randomSuffix(): string {
    return Math.floor(Math.random() * 0xffff).toString(16).padStart(4, "0");
  }

  private defaultName(): string {
    const d = new Date();
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return `user-${ymd}-${this.randomSuffix()}`;
  }

  private openNewModal(): void {
    const content = document.createElement("div");
    content.style.fontFamily = menuTheme.font;
    content.style.fontSize = menuTheme.fontSize;
    content.style.color = menuTheme.panel.color;
    content.style.display = "flex";
    content.style.flexDirection = "column";
    content.style.gap = "6px";

    const nameLabel = document.createElement("label");
    nameLabel.textContent = "Name";
    nameLabel.style.opacity = "0.7";
    content.appendChild(nameLabel);

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.value = this.defaultName();
    styleInput(nameInput);
    content.appendChild(nameInput);

    const seedLabel = document.createElement("label");
    seedLabel.textContent = "Seed (random if blank)";
    seedLabel.style.opacity = "0.7";
    content.appendChild(seedLabel);

    const seedInput = document.createElement("input");
    seedInput.type = "number";
    seedInput.placeholder = "random";
    styleInput(seedInput);
    content.appendChild(seedInput);

    const castleSeedLabel = document.createElement("label");
    castleSeedLabel.textContent = "Castle seed (random if blank)";
    castleSeedLabel.style.opacity = "0.7";
    content.appendChild(castleSeedLabel);

    const castleSeedInput = document.createElement("input");
    castleSeedInput.type = "number";
    castleSeedInput.placeholder = "random";
    styleInput(castleSeedInput);
    content.appendChild(castleSeedInput);

    const castleCountLabel = document.createElement("label");
    castleCountLabel.textContent = `Castle count (2-${CASTLE_COUNT_MAX})`;
    castleCountLabel.style.opacity = "0.7";
    content.appendChild(castleCountLabel);

    const castleCountInput = document.createElement("input");
    castleCountInput.type = "number";
    castleCountInput.min = "2";
    castleCountInput.max = String(CASTLE_COUNT_MAX);
    castleCountInput.value = "3";
    styleInput(castleCountInput);
    content.appendChild(castleCountInput);

    const sizeLabel = document.createElement("label");
    sizeLabel.textContent = "Map size";
    sizeLabel.style.opacity = "0.7";
    content.appendChild(sizeLabel);

    const sizeSelect = document.createElement("select");
    sizeSelect.style.width = "100%";
    sizeSelect.style.padding = "8px";
    sizeSelect.style.fontSize = "12px";
    sizeSelect.style.border = "1px solid #444";
    sizeSelect.style.borderRadius = "4px";
    sizeSelect.style.backgroundColor = "#1a1a1a";
    sizeSelect.style.color = "#eee";
    const sizes: Array<{ value: string; label: string }> = [
      { value: "small", label: "Small (24x18)" },
      { value: "medium", label: "Medium (36x27)" },
      { value: "large", label: "Large (48x36)" },
    ];
    for (const s of sizes) {
      const opt = document.createElement("option");
      opt.value = s.value;
      opt.textContent = s.label;
      sizeSelect.appendChild(opt);
    }
    sizeSelect.value = "small";
    content.appendChild(sizeSelect);

    const errorLine = document.createElement("div");
    Object.assign(errorLine.style, { ...menuTheme.error, minHeight: "14px", marginTop: "4px" });
    content.appendChild(errorLine);

    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.justifyContent = "flex-end";
    row.style.gap = "8px";
    row.style.marginTop = "10px";

    const modal = openCenteredModal(document.body, "New Game", 400);
    const cancel = document.createElement("button");
    cancel.textContent = "Cancel";
    styleButton(cancel);
    cancel.addEventListener("click", () => modal.close());
    row.appendChild(cancel);

    const confirm = document.createElement("button");
    confirm.textContent = "Create";
    styleButton(confirm, true);
    confirm.addEventListener("click", async () => {
      const name = nameInput.value.trim();
      if (!name) {
        errorLine.textContent = "Name required.";
        return;
      }
      let seed: number;
      if (seedInput.value.trim() === "") {
        seed = Math.floor(Math.random() * 0x7fffffff);
      } else {
        seed = Number(seedInput.value);
        if (!Number.isFinite(seed)) {
          errorLine.textContent = "Seed must be a number.";
          return;
        }
      }
      let castleSeed: number | undefined;
      if (castleSeedInput.value.trim() !== "") {
        const v = Number(castleSeedInput.value);
        if (!Number.isFinite(v)) {
          errorLine.textContent = "Castle seed must be a number.";
          return;
        }
        castleSeed = v;
      }
      const castleCountRaw = Number(castleCountInput.value);
      if (!Number.isFinite(castleCountRaw)) {
        errorLine.textContent = "Castle count must be a number.";
        return;
      }
      const castleCount = Math.max(2, Math.min(CASTLE_COUNT_MAX, Math.floor(castleCountRaw)));
      const mapSize = (sizeSelect.value || "small") as "small" | "medium" | "large";
      confirm.disabled = true;
      cancel.disabled = true;
      errorLine.textContent = "Creating…";
      try {
        await this.opts.callbacks.onNew({ name, seed, castleSeed, castleCount, mapSize });
        modal.close();
      } catch (e) {
        confirm.disabled = false;
        cancel.disabled = false;
        const msg = e instanceof Error ? e.message : String(e);
        errorLine.textContent = `Failed: ${msg}`;
        console.error("[toolbar] new game failed:", e);
      }
    });
    row.appendChild(confirm);

    content.appendChild(row);
    modal.setContent(content);
    nameInput.focus();
    nameInput.select();
  }

  private async openLoadModal(): Promise<void> {
    let serverGames: Game[] = [];
    try {
      serverGames = await api.listGames();
    } catch (e) {
      console.error("[toolbar] listGames failed:", e);
    }

    const content = document.createElement("div");
    content.style.fontFamily = menuTheme.font;
    content.style.fontSize = menuTheme.fontSize;
    content.style.color = menuTheme.panel.color;
    content.style.display = "flex";
    content.style.flexDirection = "column";
    content.style.gap = "10px";

    const userGames = this.opts.state.backendOk()
      ? this.readUserGamesFromServer(serverGames)
      : this.readUserGamesFromCacheOnly();

    if (userGames.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = "No saved games yet — start a new game to begin.";
      empty.style.opacity = "0.7";
      empty.style.padding = "6px 0";
      content.appendChild(empty);
    } else {
      const list = document.createElement("div");
      list.style.maxHeight = "320px";
      list.style.overflowY = "auto";
      list.style.border = "1px solid rgba(255,255,255,0.1)";
      list.style.borderRadius = "3px";
      for (const entry of userGames) {
        list.appendChild(this.makeLoadRow(entry));
      }
      content.appendChild(list);
    }

    const closeRow = document.createElement("div");
    closeRow.style.display = "flex";
    closeRow.style.justifyContent = "flex-end";
    const close = document.createElement("button");
    close.textContent = "Close";
    styleButton(close);
    const modal = openCenteredModal(document.body, "Load Game", 420);
    close.addEventListener("click", () => modal.close());
    closeRow.appendChild(close);
    content.appendChild(closeRow);

    modal.setContent(content);
  }

  private readUserGamesFromCacheOnly(): UserGameEntry[] {
    return sortByLastSeen(listUserGames());
  }

  private readUserGamesFromServer(serverGames: Game[]): Array<UserGameEntry & { server?: Game }> {
    const cache = listUserGames();
    const byId = new Map<number, Game>();
    for (const g of serverGames) byId.set(g.id, g);
    const out: Array<UserGameEntry & { server?: Game }> = [];
    for (const entry of cache) {
      const server = byId.get(entry.id);
      if (server) {
        out.push({ ...entry, server });
        byId.delete(entry.id);
      } else {
        out.push({ ...entry });
      }
    }
    return sortByLastSeen(out);
  }

  private makeLoadRow(entry: UserGameEntry & { server?: Game }): HTMLDivElement {
    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.justifyContent = "space-between";
    row.style.padding = "8px 10px";
    row.style.borderBottom = "1px solid rgba(255,255,255,0.06)";
    row.style.cursor = entry.server ? "pointer" : "default";
    row.style.opacity = entry.server ? "1" : "0.5";

    const left = document.createElement("div");
    const nameDiv = document.createElement("div");
    nameDiv.textContent = entry.server ? entry.name : `${entry.name} (missing)`;
    nameDiv.style.fontWeight = "500";
    left.appendChild(nameDiv);

    const meta = document.createElement("div");
    meta.style.opacity = "0.6";
    meta.style.fontSize = "11px";
    if (entry.server) {
      meta.textContent = `turn ${entry.server.turn} · ${entry.server.gold}g · seen ${formatTime(entry.lastSeenAt)}`;
    } else {
      meta.textContent = `game no longer exists · seen ${formatTime(entry.lastSeenAt)}`;
    }
    left.appendChild(meta);

    row.appendChild(left);

    const right = document.createElement("div");
    right.style.display = "flex";
    right.style.gap = "6px";

    if (entry.server) {
      const open = document.createElement("button");
      open.textContent = "Open";
      styleButton(open);
      open.addEventListener("click", async (e) => {
        e.stopPropagation();
        const originalLabel = open.textContent;
        open.disabled = true;
        open.textContent = "Loading…";
        try {
          const game = await api.getGame(entry.name);
          const tiles = await api.getTiles(entry.name);
          await this.opts.callbacks.onLoad(game, tiles);
          this.closeAllModals();
        } catch (err) {
          open.disabled = false;
          open.textContent = originalLabel ?? "Open";
          console.error("[toolbar] load failed:", err);
        }
      });
      right.appendChild(open);
    }

    const forget = document.createElement("button");
    forget.textContent = "Forget";
    styleButton(forget);
    forget.addEventListener("click", (e) => {
      e.stopPropagation();
      forgetGame(entry.id);
      this.opts.callbacks.onForget?.(entry.id);
      row.remove();
    });
    right.appendChild(forget);

    row.appendChild(right);
    return row;
  }

  private closeAllModals(): void {
    const overlays = document.body.querySelectorAll("div[style*='z-index: 100']");
    overlays.forEach((el) => el.remove());
  }
}

function sortByLastSeen<T extends { lastSeenAt: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.lastSeenAt < b.lastSeenAt ? 1 : -1));
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}
