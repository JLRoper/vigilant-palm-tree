import type { Game } from "../../io/api";
import { api } from "../../io/api";
import { forgetGame, mergeLoadList, type UserGameEntry } from "../../io/userGames";
import { panelTheme, styleButton } from "./panel";
import { openDialog } from "./dialog";

// The Open button awaits this, so a load that fails must REJECT it: a handler
// that returns void (the shape that landed in PR #289) settles the await
// immediately, the dialog closes over the failure and the retryable row below
// is unreachable. See src/managers/toolbarLoadCallback.ts.
export type LoadGameHandler = (
  game: Game,
  tiles?: Awaited<ReturnType<typeof api.getTiles>>,
) => Promise<void>;

export interface LoadGameModalOptions {
  backendOk: () => boolean;
  onLoad: LoadGameHandler;
  onForget?: (id: number) => void;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

/**
 * What a Load surface says when it has no rows to show. Both Load surfaces use
 * these exact strings (the landing list imports them), because the whole point
 * of the finding is that a list's WORDS must be true: "no saved games yet" is a
 * claim about the account, and it is only sayable when the server was actually
 * read and actually holds none. An unreadable list is not an empty account.
 */
export const LOAD_LIST_EMPTY = "No saved games yet — start a new game to begin.";
export const LOAD_LIST_UNREACHABLE =
  "Could not reach the server, so your saved games cannot be listed. Nothing was loaded or started — reopen this dialog when the server is back.";
/**
 * A saved game's progress line, shared by BOTH Load surfaces -- the landing
 * page's list (homeView) and the in-game toolbar modal. It reads the ROUND,
 * not `games.turn`: that column is written once when the game is created (by
 * its DEFAULT 1 -- POST /games' INSERT never names it) and never advances, so
 * a game on round 37 advertised itself as "turn 1" (C-POLISH-1 on the in-game
 * list, F4 of playthrough round 2b on the landing one). `round` is the same
 * counter the HUD's Round pill and the End Turn cycle move.
 */
export function loadRowProgress(server: Game, lastSeenAt: string): string {
  return `round ${server.round} · ${server.gold}g · seen ${formatTime(lastSeenAt)}`;
}

/**
 * One row of the Load list. `closeModal` is the owning dialog's own close
 * (`FloatingPanel.close`: unregister from panelManager, run the dialog's
 * wrapper teardown, remove the panel root). A successful Open MUST go through
 * it -- F5 of playthrough round 2b was a modal that stayed on screen over the
 * loaded game with its row stuck on "Loading…", because the old teardown swept
 * `document.body` for `div[style*='z-index: 100']` (the battle arena's layer)
 * while `openDialog` mounts its wrapper at z-index 300: the selector matched
 * nothing, so the panel stayed registered in panelManager AND its fullscreen
 * `rgba(0,0,0,0.6)` backdrop kept swallowing every later click on the map.
 * Closing the panel we actually opened is the only teardown that removes the
 * overlay and the panelManager entry together.
 */
function makeLoadRow(
  entry: UserGameEntry & { server?: Game },
  opts: LoadGameModalOptions,
  closeModal: () => void,
): HTMLDivElement {
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
    meta.textContent = loadRowProgress(entry.server, entry.lastSeenAt);
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
        await opts.onLoad(game);
        // After this the row (and the button still reading "Loading…") is
        // detached with the dialog's wrapper, so nothing is left to reset.
        closeModal();
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
  // `null` means the list could not be READ, which is not the same as a list
  // that came back empty: the two must never render the same words.
  let serverGames: Game[] | null = null;
  if (opts.backendOk()) {
    try {
      serverGames = await api.listGames();
    } catch (e) {
      console.error("[toolbar] listGames failed:", e);
      serverGames = null;
    }
  }

  // The dialog is built BEFORE its rows so every row's Open can close THIS
  // panel (see makeLoadRow). Its content is mounted once the list is built.
  const modal = openDialog(document.body, "Load Game", 420);

  const content = document.createElement("div");
  content.style.fontFamily = panelTheme.font;
  content.style.fontSize = panelTheme.fontSize;
  content.style.color = panelTheme.panel.color;
  content.style.display = "flex";
  content.style.flexDirection = "column";
  content.style.gap = "10px";

  const userGames = mergeLoadList(serverGames);

  if (userGames.length === 0) {
    const empty = document.createElement("div");
    // Only say "no saved games yet" when the server was read and holds none.
    empty.textContent = serverGames === null ? LOAD_LIST_UNREACHABLE : LOAD_LIST_EMPTY;
    empty.style.opacity = "0.7";
    empty.style.padding = "6px 0";
    content.appendChild(empty);
  } else {
    // The list can be complete OR partial. When it is partial (server
    // unreadable) the rows are the cache's memory, and the dialog says so
    // instead of presenting a possibly-stale list as the account's games.
    if (serverGames === null) {
      const warn = document.createElement("div");
      warn.textContent = LOAD_LIST_UNREACHABLE;
      warn.style.opacity = "0.8";
      warn.style.fontSize = "11px";
      warn.style.padding = "4px 0";
      content.appendChild(warn);
    }
    const list = document.createElement("div");
    list.style.maxHeight = "320px";
    list.style.overflowY = "auto";
    list.style.border = "1px solid rgba(255,255,255,0.1)";
    list.style.borderRadius = "3px";
    for (const entry of userGames) {
      list.appendChild(makeLoadRow(entry, opts, () => modal.close()));
    }
    content.appendChild(list);
  }

  const closeRow = document.createElement("div");
  closeRow.style.display = "flex";
  closeRow.style.justifyContent = "flex-end";
  const close = document.createElement("button");
  close.textContent = "Close";
  styleButton(close);
  close.addEventListener("click", () => modal.close());
  closeRow.appendChild(close);
  content.appendChild(closeRow);

  modal.setContent(content);
}
