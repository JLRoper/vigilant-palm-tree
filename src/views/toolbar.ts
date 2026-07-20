import type { Game } from "../io/api";
import { api } from "../io/api";
import { forgetGame, listUserGames, type UserGameEntry } from "../io/userGames";
import {
  PopupMenu,
  menuTheme,
  openCenteredModal,
  styleButton,
  styleInput,
} from "./menu";

export interface ToolbarState {
  backendOk: () => boolean;
  hasActiveGame: () => boolean;
}

export interface ToolbarCallbacks {
  onNew: (opts: { name: string; seed: number }) => void | Promise<void>;
  onLoad: (game: Game, tiles: Awaited<ReturnType<typeof api.getTiles>>) => void | Promise<void>;
  onSave: () => void | Promise<void>;
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
  private busy = false;

  constructor(private opts: ToolbarOptions) {
    this.menu = new PopupMenu({
      parent: opts.parent,
      title: "Heroes of JS",
      initialPosition: { x: 16, y: 16 },
      width: 200,
      closeable: false,
      draggable: true,
    });

    this.newBtn = this.makeButton("New Game", false);
    this.loadBtn = this.makeButton("Load Game", false);
    this.saveBtn = this.makeButton("Save Game", false);

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

    this.menu.appendContent(this.newBtn);
    this.menu.appendContent(this.loadBtn);
    this.menu.appendContent(this.saveBtn);
    this.refresh();
  }

  refresh(): void {
    const ok = this.opts.state.backendOk();
    const active = this.opts.state.hasActiveGame();
    this.setEnabled(this.newBtn, ok && !this.busy);
    this.setEnabled(this.loadBtn, ok && !this.busy);
    this.setEnabled(this.saveBtn, ok && active && !this.busy);
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

    const errorLine = document.createElement("div");
    Object.assign(errorLine.style, { ...menuTheme.error, minHeight: "14px", marginTop: "4px" });
    content.appendChild(errorLine);

    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.justifyContent = "flex-end";
    row.style.gap = "8px";
    row.style.marginTop = "10px";

    const modal = openCenteredModal(document.body, "New Game", 380);
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
      confirm.disabled = true;
      cancel.disabled = true;
      errorLine.textContent = "Creating…";
      try {
        await this.opts.callbacks.onNew({ name, seed });
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
