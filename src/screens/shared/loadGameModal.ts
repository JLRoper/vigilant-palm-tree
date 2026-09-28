import type { Game } from "../../io/api";
import { api } from "../../io/api";
import { forgetGame, listUserGames, type UserGameEntry } from "../../io/userGames";
import { menuTheme, openCenteredModal, styleButton } from "./menu";

export type LoadGameHandler = (
  game: Game,
  tiles: Awaited<ReturnType<typeof api.getTiles>>,
) => void | Promise<void>;

export interface LoadGameModalOptions {
  backendOk: () => boolean;
  onLoad: LoadGameHandler;
  onForget?: (id: number) => void;
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

function readUserGamesFromCacheOnly(): UserGameEntry[] {
  return sortByLastSeen(listUserGames());
}

function readUserGamesFromServer(serverGames: Game[]): Array<UserGameEntry & { server?: Game }> {
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

function closeAllModals(): void {
  const overlays = document.body.querySelectorAll("div[style*='z-index: 100']");
  overlays.forEach((el) => el.remove());
}

function makeLoadRow(entry: UserGameEntry & { server?: Game }, opts: LoadGameModalOptions): HTMLDivElement {
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
        await opts.onLoad(game, tiles);
        closeAllModals();
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
    opts.onForget?.(entry.id);
    row.remove();
  });
  right.appendChild(forget);

  row.appendChild(right);
  return row;
}

export async function openLoadGameModal(opts: LoadGameModalOptions): Promise<void> {
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

  const userGames = opts.backendOk()
    ? readUserGamesFromServer(serverGames)
    : readUserGamesFromCacheOnly();

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
      list.appendChild(makeLoadRow(entry, opts));
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
