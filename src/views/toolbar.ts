import type { Game } from "../io/api";
import { api } from "../io/api";
import { listUserGames, type UserGameEntry } from "../io/userGames";

export type NewGameOptions = {
  name: string;
  seed: number;
};

export interface ToolbarOptions {
  container: HTMLElement;
  backendOk: () => boolean;
  hasActiveGame: () => boolean;
  onNew: (opts: NewGameOptions) => void | Promise<void>;
  onLoad: (game: Game, tiles: Awaited<ReturnType<typeof api.getTiles>>) => void | Promise<void>;
  onSave: () => void | Promise<void>;
  onForget: (id: number) => void;
}

export class Toolbar {
  private buttonsRow: HTMLDivElement;
  private newBtn: HTMLButtonElement;
  private loadBtn: HTMLButtonElement;
  private saveBtn: HTMLButtonElement;
  private modalRoot: HTMLDivElement | null = null;

  constructor(private opts: ToolbarOptions) {
    this.buttonsRow = document.createElement("div");
    this.buttonsRow.style.display = "flex";
    this.buttonsRow.style.gap = "6px";

    this.newBtn = this.makeButton("New");
    this.loadBtn = this.makeButton("Load");
    this.saveBtn = this.makeButton("Save");

    this.newBtn.addEventListener("click", () => this.openNewModal());
    this.loadBtn.addEventListener("click", () => this.openLoadModal());
    this.saveBtn.addEventListener("click", () => {
      void this.opts.onSave();
    });

    this.buttonsRow.append(this.newBtn, this.loadBtn, this.saveBtn);
    opts.container.appendChild(this.buttonsRow);
    this.refresh();
  }

  refresh(): void {
    const ok = this.opts.backendOk();
    this.newBtn.disabled = !ok;
    this.loadBtn.disabled = !ok;
    this.saveBtn.disabled = !ok || !this.opts.hasActiveGame();
    for (const b of [this.newBtn, this.loadBtn, this.saveBtn]) {
      b.style.opacity = b.disabled ? "0.4" : "1";
      b.style.cursor = b.disabled ? "default" : "pointer";
    }
  }

  private makeButton(label: string): HTMLButtonElement {
    const b = document.createElement("button");
    b.textContent = label;
    b.style.padding = "6px 12px";
    b.style.background = "rgba(0, 0, 0, 0.6)";
    b.style.color = "#eee";
    b.style.border = "1px solid rgba(255,255,255,0.2)";
    b.style.borderRadius = "4px";
    b.style.fontSize = "12px";
    b.style.fontFamily = "inherit";
    return b;
  }

  private openModal(content: HTMLElement): void {
    this.closeModal();
    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.background = "rgba(0,0,0,0.6)";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.zIndex = "100";

    const panel = document.createElement("div");
    panel.style.background = "#1a1a1a";
    panel.style.color = "#eee";
    panel.style.border = "1px solid rgba(255,255,255,0.15)";
    panel.style.borderRadius = "6px";
    panel.style.padding = "16px 20px";
    panel.style.minWidth = "320px";
    panel.style.maxWidth = "520px";
    panel.style.fontFamily = "system-ui, sans-serif";
    panel.style.fontSize = "13px";
    panel.appendChild(content);
    overlay.appendChild(panel);

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) this.closeModal();
    });

    document.body.appendChild(overlay);
    this.modalRoot = overlay;
  }

  private closeModal(): void {
    if (this.modalRoot) {
      this.modalRoot.remove();
      this.modalRoot = null;
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

    const title = document.createElement("div");
    title.textContent = "New Game";
    title.style.fontSize = "15px";
    title.style.fontWeight = "600";
    title.style.marginBottom = "12px";
    content.appendChild(title);

    const nameLabel = document.createElement("label");
    nameLabel.textContent = "Name";
    nameLabel.style.display = "block";
    nameLabel.style.marginBottom = "4px";
    nameLabel.style.opacity = "0.7";
    content.appendChild(nameLabel);

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.value = this.defaultName();
    nameInput.style.width = "100%";
    nameInput.style.boxSizing = "border-box";
    nameInput.style.padding = "6px 8px";
    nameInput.style.background = "#0e0e0e";
    nameInput.style.color = "#eee";
    nameInput.style.border = "1px solid rgba(255,255,255,0.2)";
    nameInput.style.borderRadius = "3px";
    nameInput.style.marginBottom = "12px";
    nameInput.style.fontFamily = "inherit";
    content.appendChild(nameInput);

    const seedLabel = document.createElement("label");
    seedLabel.textContent = "Seed (random if blank)";
    seedLabel.style.display = "block";
    seedLabel.style.marginBottom = "4px";
    seedLabel.style.opacity = "0.7";
    content.appendChild(seedLabel);

    const seedInput = document.createElement("input");
    seedInput.type = "number";
    seedInput.placeholder = "random";
    seedInput.style.width = "100%";
    seedInput.style.boxSizing = "border-box";
    seedInput.style.padding = "6px 8px";
    seedInput.style.background = "#0e0e0e";
    seedInput.style.color = "#eee";
    seedInput.style.border = "1px solid rgba(255,255,255,0.2)";
    seedInput.style.borderRadius = "3px";
    seedInput.style.marginBottom = "16px";
    seedInput.style.fontFamily = "inherit";
    content.appendChild(seedInput);

    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.justifyContent = "flex-end";
    row.style.gap = "8px";

    const cancel = document.createElement("button");
    cancel.textContent = "Cancel";
    cancel.style.cssText = this.newBtn.style.cssText;
    cancel.addEventListener("click", () => this.closeModal());
    row.appendChild(cancel);

    const confirm = document.createElement("button");
    confirm.textContent = "Create";
    confirm.style.cssText = this.newBtn.style.cssText;
    confirm.style.background = "rgba(40,90,40,0.7)";
    const errorLine = document.createElement("div");
    errorLine.style.color = "#f88";
    errorLine.style.fontSize = "11px";
    errorLine.style.marginTop = "8px";
    errorLine.style.minHeight = "14px";
    content.appendChild(errorLine);
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
        await this.opts.onNew({ name, seed });
        this.closeModal();
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
    this.openModal(content);
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

    const title = document.createElement("div");
    title.textContent = "Load Game";
    title.style.fontSize = "15px";
    title.style.fontWeight = "600";
    title.style.marginBottom = "12px";
    content.appendChild(title);

    const userGames = this.opts.backendOk()
      ? this.readUserGamesFromServer(serverGames)
      : this.readUserGamesFromCacheOnly();

    if (userGames.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = "No saved games yet — start a new game to begin.";
      empty.style.opacity = "0.7";
      empty.style.padding = "12px 0";
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
    closeRow.style.marginTop = "12px";
    const close = document.createElement("button");
    close.textContent = "Close";
    close.style.cssText = this.newBtn.style.cssText;
    close.addEventListener("click", () => this.closeModal());
    closeRow.appendChild(close);
    content.appendChild(closeRow);

    this.openModal(content);
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
      open.style.cssText = this.newBtn.style.cssText;
      open.addEventListener("click", async (e) => {
        e.stopPropagation();
        const originalLabel = open.textContent;
        open.disabled = true;
        open.textContent = "Loading…";
        try {
          const game = await api.getGame(entry.name);
          const tiles = await api.getTiles(entry.name);
          await this.opts.onLoad(game, tiles);
          this.closeModal();
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
    forget.style.cssText = this.newBtn.style.cssText;
    forget.addEventListener("click", (e) => {
      e.stopPropagation();
      this.opts.onForget(entry.id);
      row.remove();
    });
    right.appendChild(forget);

    row.appendChild(right);
    return row;
  }
}

function sortByLastSeen<T extends { lastSeenAt: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.lastSeenAt < b.lastSeenAt ? 1 : -1));
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}
