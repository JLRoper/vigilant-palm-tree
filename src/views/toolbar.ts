import type { Game } from "../io/api";
import { api } from "../io/api";
import { forgetGame, listUserGames, type UserGameEntry } from "../io/userGames";
import type { GameState } from "../state/gameState";
import { openSettingsMenu } from "./settingsMenu";
import {
  PopupMenu,
  menuTheme,
  openCenteredModal,
  styleButton,
  styleInput,
} from "./menu";

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
}

export interface ToolbarCallbacks {
  onNew: (opts: {
    name: string;
    seed: number;
    castleSeed?: number;
    castleCount?: number;
  }) => void | Promise<void>;
  onLoad: (game: Game, tiles: Awaited<ReturnType<typeof api.getTiles>>) => void | Promise<void>;
  onSave: () => void | Promise<void>;
  onEndTurn: () => void | Promise<void>;
  onForget?: (id: number) => void;
}

export interface ToolbarOptions {
  parent: HTMLElement;
  state: ToolbarState;
  callbacks: ToolbarCallbacks;
}

export class Toolbar {
  private menu: PopupMenu;
  private newBtn: HTMLButtonElement;
  private loadBtn: HTMLButtonElement;
  private saveBtn: HTMLButtonElement;
  private endTurnBtn: HTMLButtonElement;
  private calendarEl: HTMLElement;
  private calendarActiveEl: HTMLElement;
  private busy = false;

  constructor(private opts: ToolbarOptions) {
    this.menu = new PopupMenu({
      parent: opts.parent,
      title: "Heroes of JS",
      initialPosition: { x: 16, y: 16 },
      width: 220,
      closeable: false,
      draggable: true,
    });

    const gear = document.createElement("button");
    gear.textContent = "\u2699";
    gear.title = "Settings";
    Object.assign(gear.style, {
      position: "absolute",
      top: "6px",
      right: "8px",
      width: "22px",
      height: "22px",
      padding: "0",
      fontSize: "14px",
      lineHeight: "1",
      cursor: "pointer",
      background: "transparent",
      border: "1px solid rgba(255,255,255,0.20)",
      borderRadius: "3px",
      color: menuTheme.panel.color,
      fontFamily: menuTheme.font,
      zIndex: "1",
    });
    gear.addEventListener("click", (e) => {
      e.stopPropagation();
      openSettingsMenu(document.body);
    });
    gear.addEventListener("mousedown", (e) => e.stopPropagation());
    this.menu.root.appendChild(gear);

    this.calendarEl = document.createElement("div");
    Object.assign(this.calendarEl.style, {
      display: "flex",
      flexDirection: "column",
      gap: "2px",
      paddingBottom: "8px",
      borderBottom: "1px solid rgba(255,255,255,0.08)",
      marginBottom: "4px",
      fontFamily: menuTheme.font,
      color: menuTheme.panel.color,
    });
    const calendarTopRow = document.createElement("div");
    Object.assign(calendarTopRow.style, {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "baseline",
      fontSize: "14px",
      fontWeight: "600",
    });
    const dayLabel = document.createElement("span");
    dayLabel.textContent = "Day";
    calendarTopRow.appendChild(dayLabel);
    const dayValue = document.createElement("span");
    dayValue.id = "toolbar-day-value";
    calendarTopRow.appendChild(dayValue);
    this.calendarEl.appendChild(calendarTopRow);

    const subRow = document.createElement("div");
    Object.assign(subRow.style, {
      display: "flex",
      justifyContent: "space-between",
      fontSize: "11px",
      opacity: "0.7",
    });
    const weekLabel = document.createElement("span");
    weekLabel.textContent = "Week";
    subRow.appendChild(weekLabel);
    const weekValue = document.createElement("span");
    weekValue.id = "toolbar-week-value";
    subRow.appendChild(weekValue);
    this.calendarEl.appendChild(subRow);

    const monthRow = document.createElement("div");
    Object.assign(monthRow.style, {
      display: "flex",
      justifyContent: "space-between",
      fontSize: "11px",
      opacity: "0.7",
    });
    const monthLabel = document.createElement("span");
    monthLabel.textContent = "Month";
    monthRow.appendChild(monthLabel);
    const monthValue = document.createElement("span");
    monthValue.id = "toolbar-month-value";
    monthRow.appendChild(monthValue);
    this.calendarEl.appendChild(monthRow);

    this.calendarActiveEl = document.createElement("div");
    Object.assign(this.calendarActiveEl.style, {
      display: "flex",
      alignItems: "center",
      gap: "6px",
      fontSize: "11px",
      opacity: "0.85",
      paddingTop: "4px",
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
    this.calendarActiveEl.appendChild(activeLabel);
    this.calendarEl.appendChild(this.calendarActiveEl);

    const incomeRow = document.createElement("div");
    Object.assign(incomeRow.style, {
      display: "flex",
      justifyContent: "space-between",
      fontSize: "11px",
      opacity: "0.85",
      paddingTop: "2px",
    });
    const incomeLabel = document.createElement("span");
    incomeLabel.textContent = "Income";
    incomeRow.appendChild(incomeLabel);
    const incomeValue = document.createElement("span");
    incomeValue.id = "toolbar-income-value";
    incomeRow.appendChild(incomeValue);
    this.calendarEl.appendChild(incomeRow);

    const wealthRow = document.createElement("div");
    Object.assign(wealthRow.style, {
      display: "flex",
      justifyContent: "space-between",
      fontSize: "11px",
      opacity: "0.85",
      paddingTop: "2px",
    });
    const wealthLabel = document.createElement("span");
    wealthLabel.textContent = "Wealth";
    wealthRow.appendChild(wealthLabel);
    const wealthValue = document.createElement("span");
    wealthValue.id = "toolbar-wealth-value";
    wealthRow.appendChild(wealthValue);
    this.calendarEl.appendChild(wealthRow);

    const moraleRow = document.createElement("div");
    Object.assign(moraleRow.style, {
      display: "flex",
      justifyContent: "space-between",
      fontSize: "11px",
      opacity: "0.85",
      paddingTop: "2px",
    });
    const moraleLabel = document.createElement("span");
    moraleLabel.textContent = "Morale";
    moraleRow.appendChild(moraleLabel);
    const moraleValue = document.createElement("span");
    moraleValue.id = "toolbar-morale-value";
    moraleRow.appendChild(moraleValue);
    this.calendarEl.appendChild(moraleRow);

    this.menu.body.appendChild(this.calendarEl);

    this.newBtn = this.makeButton("New Game", false);
    this.loadBtn = this.makeButton("Load Game", false);
    this.saveBtn = this.makeButton("Save Game", false);
    this.endTurnBtn = this.makeButton("End Turn", true);

    this.newBtn.addEventListener("click", () => {
      if (this.busy) return;
      this.openNewModal();
    });
    this.loadBtn.addEventListener("click", () => {
      if (this.busy) return;
      void this.openLoadModal();
    });
    this.saveBtn.addEventListener("click", () => {
      if (this.busy) return;
      void this.runAsync(async () => {
        await this.opts.callbacks.onSave();
      });
    });
    this.endTurnBtn.addEventListener("click", () => {
      if (this.busy) return;
      if (!this.opts.state.canEndTurnNow()) return;
      void this.runAsync(async () => {
        await this.opts.callbacks.onEndTurn();
      });
    });

    this.menu.appendContent(this.newBtn);
    this.menu.appendContent(this.loadBtn);
    this.menu.appendContent(this.saveBtn);
    this.menu.appendContent(this.endTurnBtn);
    this.refresh();
  }

  refresh(): void {
    const ok = this.opts.state.backendOk();
    const active = this.opts.state.hasActiveGame();
    const endTurnOk = this.opts.state.canEndTurnNow();
    this.setEnabled(this.newBtn, ok && !this.busy);
    this.setEnabled(this.loadBtn, ok && !this.busy);
    this.setEnabled(this.saveBtn, ok && active && !this.busy);
    this.setEnabled(this.endTurnBtn, endTurnOk && !this.busy);
    this.refreshCalendar();
  }

  private refreshCalendar(): void {
    const cal = this.opts.state.getCalendar();
    const dayEl = this.menu.root.querySelector<HTMLElement>("#toolbar-day-value");
    const weekEl = this.menu.root.querySelector<HTMLElement>("#toolbar-week-value");
    const monthEl = this.menu.root.querySelector<HTMLElement>("#toolbar-month-value");
    const swatchEl = this.menu.root.querySelector<HTMLElement>("#toolbar-active-swatch");
    const activeEl = this.menu.root.querySelector<HTMLElement>("#toolbar-active-label");
    const incomeEl = this.menu.root.querySelector<HTMLElement>("#toolbar-income-value");
    const wealthEl = this.menu.root.querySelector<HTMLElement>("#toolbar-wealth-value");
    const moraleEl = this.menu.root.querySelector<HTMLElement>("#toolbar-morale-value");
    if (!dayEl || !weekEl || !monthEl || !swatchEl || !activeEl || !incomeEl || !wealthEl || !moraleEl) return;
    if (!cal) {
      dayEl.textContent = "—";
      weekEl.textContent = "—";
      monthEl.textContent = "—";
      swatchEl.style.background = "#888";
      activeEl.textContent = "—";
      incomeEl.textContent = "—";
      wealthEl.textContent = "—";
      moraleEl.textContent = "—";
      return;
    }
    dayEl.textContent = `${cal.day} (d${cal.dayOfWeek})`;
    weekEl.textContent = `${cal.week}`;
    monthEl.textContent = `${cal.monthName} ${cal.month} (d${cal.dayOfMonth})`;
    swatchEl.style.background = cal.activePlayerColor;
    activeEl.textContent = `${cal.activePlayerName}'s turn`;
    incomeEl.textContent = `+${cal.nextTurnGold}g/turn`;
    wealthEl.textContent = `${cal.wealth}g`;
    if (cal.morale === null || cal.effectiveIncome === null) {
      moraleEl.textContent = "—";
    } else {
      moraleEl.textContent = `${cal.morale}% · ${cal.effectiveIncome}g`;
    }
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
    styleButton(b, primary);
    b.style.width = "100%";
    b.style.textAlign = "left";
    b.style.fontSize = "13px";
    b.style.padding = "7px 10px";
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
    castleCountLabel.textContent = "Castle count (2-5)";
    castleCountLabel.style.opacity = "0.7";
    content.appendChild(castleCountLabel);

    const castleCountInput = document.createElement("input");
    castleCountInput.type = "number";
    castleCountInput.min = "2";
    castleCountInput.max = "5";
    castleCountInput.value = "3";
    styleInput(castleCountInput);
    content.appendChild(castleCountInput);

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
      const castleCount = Math.max(2, Math.min(5, Math.floor(castleCountRaw)));
      confirm.disabled = true;
      cancel.disabled = true;
      errorLine.textContent = "Creating…";
      try {
        await this.opts.callbacks.onNew({ name, seed, castleSeed, castleCount });
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
