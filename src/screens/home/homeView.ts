import { api, type Game } from "../../io/api";
import { forgetGame, listUserGames, rememberGame, type UserGameEntry } from "../../io/userGames";
import {
  checkSession,
  clearAuth,
  getCachedAuth,
  logout,
  requestLoginCode,
  verifyLoginCode,
  type AuthState,
} from "../../io/auth";
import { styleButton, styleInput, panelTheme } from "@screens/shared/panel";
import { openDialog } from "@screens/shared/dialog";
import { openConfirmDialog } from "@screens/shared/confirmDialog";
// The Load Game progress line is ONE function for both Load surfaces (this
// landing list and the in-game toolbar modal). It reads the ROUND; see
// loadRowProgress for why `games.turn` must not be rendered.
import { loadRowProgress } from "@screens/shared/loadGameModal";
import type { MapSize } from "../../map/gameMap";
import { openSettingsMenu } from "./settingsMenu";
import { createNewGameScreen } from "./newGameScreen";
import type { FactionId, GameMode } from "@heroes/contracts";

export interface HomeViewOptions {
  onEnterGame: () => void;
  onNewGame: (opts: {
    name: string;
    seed: number;
    castleSeed?: number;
    castleCount?: number;
    mapSize?: MapSize;
    playerCount?: 1 | 2 | 3 | 4;
    humanSeatCount?: number;
    enemyCount?: number;
    factionId?: FactionId;
    uncharted?: boolean;
    /** The game mode the Create Game form picked (SETTLERS-PLAN.md §4 W4). */
    gameMode?: GameMode;
  }) => Promise<void>;
  onLoadGame: (game: Game) => Promise<void>;
  isBackendOk: () => boolean;
  onJoinMultiplayerGame?: (game: Game) => Promise<void>;
}

export interface HomeView {
  root: HTMLElement;
  show: () => void;
  hide: () => void;
  isVisible: () => boolean;
  destroy: () => void;
}

export function createHomeView(opts: HomeViewOptions): HomeView {
  const root = document.createElement("div");
  Object.assign(root.style, {
    position: "fixed",
    inset: "0",
    zIndex: "200",
    display: "flex",
    // Centring that SURVIVES overflow (playthrough finding 20): the card is
    // centred by its own auto margins, not by `align-items`, and the overlay
    // itself scrolls. A centred flex item taller than its container spills past
    // the scroll origin, and nothing can scroll to what is above that origin --
    // measured at the turnover tip on a 566px-tall viewport, where the Create
    // Game button sat 43px below the fold, the overlay's scrollTop would not
    // move, a real click at its centre hit nothing, and the client quietly
    // quick-started a starter classic game instead of the game the player asked
    // for. The full-screen form is the app's own chrome on a laptop viewport,
    // so "it fits" is not an assumption this screen may make.
    alignItems: "flex-start",
    justifyContent: "center",
    overflowY: "auto",
    overflowX: "hidden",
    padding: "24px 16px",
    boxSizing: "border-box",
    background:
      "radial-gradient(ellipse at top, #1c2f57 0%, #0d1730 60%, #06091a 100%)",
    fontFamily: "Georgia, 'Times New Roman', serif",
    color: "#f1e4c3",
    userSelect: "none",
  });

  const card = document.createElement("div");
  Object.assign(card.style, {
    // `auto` on both cross-axis margins is what re-centres the card when there
    // IS room and degrades to "flush to the top, scroll for the rest" when
    // there is not (auto margins resolve to zero once the item overflows).
    margin: "auto",
    width: "min(560px, 100%)",
    padding: "36px 32px 28px",
    background: "rgba(10, 16, 32, 0.78)",
    border: "1px solid rgba(201,162,39,0.55)",
    borderRadius: "8px",
    boxShadow: "0 12px 48px rgba(0,0,0,0.6)",
    display: "flex",
    flexDirection: "column",
    gap: "18px",
    textAlign: "center",
  });
  root.appendChild(card);

  const title = document.createElement("h1");
  title.textContent = "Heroes JS";
  Object.assign(title.style, {
    margin: "0",
    fontSize: "40px",
    letterSpacing: "2px",
    color: "#e9cf7d",
    textShadow: "0 2px 8px rgba(0,0,0,0.6)",
  });
  card.appendChild(title);

  const tagline = document.createElement("div");
  tagline.textContent = "A turn-based, hex-grid adventure";
  Object.assign(tagline.style, {
    fontSize: "13px",
    color: "rgba(241,228,195,0.75)",
    fontStyle: "italic",
  });
  card.appendChild(tagline);

  const buttonStack = document.createElement("div");
  Object.assign(buttonStack.style, {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    marginTop: "8px",
  });
  card.appendChild(buttonStack);

  const newBtn = makeBigButton("New Game", true);
  const loadBtn = makeBigButton("Load Game", false);
  const mpBtn = makeBigButton("Multiplayer", false);
  const settingsBtn = makeBigButton("Settings", false);
  const authBtn = makeBigButton("Sign In", false);
  buttonStack.appendChild(newBtn);
  buttonStack.appendChild(loadBtn);
  buttonStack.appendChild(mpBtn);
  buttonStack.appendChild(settingsBtn);
  buttonStack.appendChild(authBtn);

  const footer = document.createElement("div");
  footer.style.marginTop = "8px";
  footer.style.fontSize = "11px";
  footer.style.opacity = "0.7";
  card.appendChild(footer);

  const newGameSlot = document.createElement("div");
  newGameSlot.style.display = "none";
  card.appendChild(newGameSlot);

  let authState: AuthState | null = getCachedAuth();
  let busy = false;
  let newGameScreenHandle: ReturnType<typeof createNewGameScreen> | null = null;

  function refreshAuthUi(): void {
    if (authState) {
      authBtn.textContent = `Sign out (${authState.email})`;
      footer.textContent = "Signed in. Your seat in multiplayer games is secured to your email.";
    } else {
      authBtn.textContent = "Sign In";
      footer.textContent =
        "Sign-in is optional — you can play right now. Signing in secures your seat in multiplayer games and lets you pick up games from any device.";
    }
  }

  function setBusy(value: boolean): void {
    busy = value;
    newBtn.disabled = value;
    loadBtn.disabled = value;
    mpBtn.disabled = value;
    settingsBtn.disabled = value;
    authBtn.disabled = value;
    for (const b of [newBtn, loadBtn, mpBtn, settingsBtn, authBtn]) {
      b.style.opacity = value ? "0.6" : "1";
      b.style.cursor = value ? "default" : "pointer";
    }
  }

  newBtn.addEventListener("click", () => {
    if (busy) return;
    openNewGameModal();
  });

  loadBtn.addEventListener("click", () => {
    if (busy) return;
    void openLoadModal();
  });

  mpBtn.addEventListener("click", async () => {
    if (busy) return;
    if (!opts.isBackendOk()) {
      alert("Backend offline. Multiplayer requires the API.");
      return;
    }
    const { createMultiplayerLobby } = await import("@screens/multiplayer/multiplayerLobby");
    createMultiplayerLobby({
      isBackendOk: opts.isBackendOk,
      onEnterGame: () => {
        hide();
        opts.onEnterGame();
      },
      onJoinGame: async (game) => {
        hide();
        if (opts.onJoinMultiplayerGame) {
          await opts.onJoinMultiplayerGame(game);
        } else {
          await opts.onLoadGame(game);
        }
      },
    });
  });

  settingsBtn.addEventListener("click", () => {
    if (busy) return;
    openSettingsMenu({ parent: document.body });
  });

  authBtn.addEventListener("click", () => {
    if (busy) return;
    if (authState) {
      void handleLogout();
    } else {
      openLoginModal();
    }
  });

  async function validateCachedSession(): Promise<void> {
    if (!authState) return;
    try {
      const valid = await checkSession(authState.token);
      if (!valid) {
        clearAuth();
        authState = null;
      } else {
        authState = valid;
      }
    } catch {
      // backend offline — keep cached session
    }
    refreshAuthUi();
  }

  function openNewGameModal(): void {
    if (busy) return;
    if (newGameScreenHandle) {
      newGameScreenHandle.destroy();
      newGameScreenHandle = null;
    }
    const screen = createNewGameScreen({
      defaultName: defaultName(),
      defaultSeed: Math.floor(Math.random() * 0x7fffffff),
      isBackendOk: opts.isBackendOk,
      busy,
      onCancel: () => showLanding(),
      onCreate: async (values) => {
        setBusy(true);
        screen.setBusy(true);
        screen.clearError();
        try {
          await opts.onNewGame({
            name: values.name,
            seed: values.seed,
            mapSize: values.mapSize,
            playerCount: values.playerCount,
            humanSeatCount: values.playerCount,
            enemyCount: values.enemyCount,
            factionId: values.factionId,
            uncharted: values.uncharted,
            gameMode: values.gameMode,
          });
          rememberGameEntry(values.name);
          screen.destroy();
          newGameScreenHandle = null;
          hide();
          opts.onEnterGame();
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          screen.showError(`Failed: ${msg}`);
          screen.setBusy(false);
          console.error("[home] new game failed:", e);
        } finally {
          setBusy(false);
        }
      },
    });
    newGameScreenHandle = screen;
    newGameSlot.replaceChildren(screen.root);
    showCreateGame();
  }

  function showLanding(): void {
    buttonStack.style.display = "flex";
    footer.style.display = "block";
    title.style.display = "block";
    tagline.style.display = "block";
    newGameSlot.style.display = "none";
    if (newGameScreenHandle) {
      newGameScreenHandle.destroy();
      newGameScreenHandle = null;
    }
  }

  function showCreateGame(): void {
    buttonStack.style.display = "none";
    footer.style.display = "none";
    title.style.display = "none";
    tagline.style.display = "none";
    newGameSlot.style.display = "block";
  }

  async function openLoadModal(): Promise<void> {
    let serverGames: Game[] = [];
    try {
      serverGames = await api.listGames();
    } catch (e) {
      console.error("[home] listGames failed:", e);
    }
    const userGames = readLoadEntries(serverGames);
    const modal = openDialog(document.body, "Load Game", 420);

    const content = document.createElement("div");
    content.style.fontFamily = panelTheme.font;
    content.style.fontSize = panelTheme.fontSize;
    content.style.color = panelTheme.panel.color;
    content.style.display = "flex";
    content.style.flexDirection = "column";
    content.style.gap = "10px";

    function showEmptyState(): void {
      const empty = document.createElement("div");
      empty.textContent = "No saved games yet — start a new game to begin.";
      empty.style.opacity = "0.7";
      empty.style.padding = "6px 0";
      content.appendChild(empty);
    }

    if (userGames.length === 0) {
      showEmptyState();
    } else {
      const list = document.createElement("div");
      list.style.maxHeight = "320px";
      list.style.overflowY = "auto";
      list.style.border = "1px solid rgba(255,255,255,0.1)";
      list.style.borderRadius = "3px";
      for (const entry of userGames) {
        list.appendChild(
          makeLoadRow(entry, () => modal.close(), () => {
            if (list.children.length === 0) {
              list.remove();
              showEmptyState();
            }
          }),
        );
      }
      content.appendChild(list);
    }

    const closeRow = document.createElement("div");
    Object.assign(closeRow.style, {
      display: "flex",
      justifyContent: "flex-end",
    });
    const close = document.createElement("button");
    close.textContent = "Close";
    styleButton(close);
    close.addEventListener("click", () => modal.close());
    closeRow.appendChild(close);
    content.appendChild(closeRow);

    modal.setContent(content);
  }

  function readLoadEntries(serverGames: Game[]): Array<UserGameEntry & { server?: Game }> {
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
    return out.sort((a, b) => (a.lastSeenAt < b.lastSeenAt ? 1 : -1));
  }

  function makeLoadRow(
    entry: UserGameEntry & { server?: Game },
    onLoaded: () => void,
    onRowRemoved: () => void,
  ): HTMLDivElement {
    const row = document.createElement("div");
    Object.assign(row.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "8px 10px",
      borderBottom: "1px solid rgba(255,255,255,0.06)",
      opacity: entry.server ? "1" : "0.5",
    });

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
      open.addEventListener("click", async () => {
        open.disabled = true;
        open.textContent = "Loading…";
        const serverGame = entry.server;
        if (!serverGame) return;
        try {
          await opts.onLoadGame(serverGame);
          rememberGameEntry(serverGame.name);
          onLoaded();
          hide();
          opts.onEnterGame();
        } catch (e) {
          open.disabled = false;
          open.textContent = "Open";
          console.error("[home] load failed:", e);
        }
      });
      right.appendChild(open);
    }
    const del = document.createElement("button");
    del.textContent = "Delete";
    styleButton(del);
    const performDelete = async (): Promise<void> => {
      del.disabled = true;
      del.textContent = "Deleting…";
      try {
        if (entry.server) {
          await api.deleteGame(entry.name);
        }
        forgetGame(entry.id);
        row.remove();
        onRowRemoved();
      } catch (e) {
        del.disabled = false;
        del.textContent = "Delete";
        console.error("[home] delete failed:", e);
      }
    };
    del.addEventListener("click", () => {
      openConfirmDialog({
        title: "Delete saved game",
        message: `Delete saved game "${entry.name}"? This cannot be undone.`,
        confirmLabel: "Delete",
        destructive: true,
        // The row lives in the Load dialog (300), which is itself above the
        // home overlay (200), so the prompt has to clear both.
        zIndex: 320,
        onConfirm: () => {
          void performDelete();
        },
      });
    });
    right.appendChild(del);
    row.appendChild(right);
    return row;
  }

  function openLoginModal(): void {
    const modal = openDialog(document.body, "Sign In", 380);
    const content = document.createElement("div");
    content.style.fontFamily = panelTheme.font;
    content.style.fontSize = panelTheme.fontSize;
    content.style.color = panelTheme.panel.color;
    content.style.display = "flex";
    content.style.flexDirection = "column";
    content.style.gap = "8px";

    const intro = document.createElement("div");
    intro.textContent =
      "Enter your email — we'll send you a one-time sign-in code. (Short-term: the code is shown here for dev; real email delivery comes later.)";
    intro.style.opacity = "0.7";
    intro.style.fontSize = "11px";
    content.appendChild(intro);

    const emailLabel = document.createElement("label");
    emailLabel.textContent = "Email";
    emailLabel.style.opacity = "0.7";
    content.appendChild(emailLabel);
    const emailInput = document.createElement("input");
    emailInput.type = "email";
    emailInput.placeholder = "you@example.com";
    styleInput(emailInput);
    content.appendChild(emailInput);

    const codeLabel = document.createElement("label");
    codeLabel.textContent = "6-digit code";
    codeLabel.style.opacity = "0.7";
    content.appendChild(codeLabel);
    const codeInput = document.createElement("input");
    codeInput.type = "text";
    codeInput.placeholder = "123456";
    codeInput.maxLength = 6;
    codeInput.disabled = true;
    styleInput(codeInput);
    content.appendChild(codeInput);

    const status = document.createElement("div");
    Object.assign(status.style, { ...panelTheme.error, minHeight: "16px", marginTop: "2px" });
    content.appendChild(status);

    const row = document.createElement("div");
    Object.assign(row.style, {
      display: "flex",
      justifyContent: "flex-end",
      gap: "8px",
      marginTop: "10px",
    });
    const cancel = document.createElement("button");
    cancel.textContent = "Cancel";
    styleButton(cancel);
    cancel.addEventListener("click", () => modal.close());
    row.appendChild(cancel);

    const sendBtn = document.createElement("button");
    sendBtn.textContent = "Send code";
    styleButton(sendBtn, true);
    sendBtn.addEventListener("click", async () => {
      const email = emailInput.value.trim();
      if (!email) {
        status.textContent = "Email required.";
        return;
      }
      sendBtn.disabled = true;
      status.style.color = panelTheme.error.color;
      status.textContent = "Sending…";
      try {
        const { devCode } = await requestLoginCode(email);
        status.style.color = "rgba(201,162,39,1)";
        status.textContent = devCode
          ? `Dev code: ${devCode} (also logged to server console). Check your email.`
          : "Check your email for the code.";
        codeInput.disabled = false;
        codeInput.focus();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        status.textContent = `Failed: ${msg}`;
      } finally {
        sendBtn.disabled = false;
      }
    });
    row.appendChild(sendBtn);

    const verifyBtn = document.createElement("button");
    verifyBtn.textContent = "Verify";
    styleButton(verifyBtn, true);
    verifyBtn.disabled = true;
    verifyBtn.addEventListener("click", async () => {
      const email = emailInput.value.trim();
      const code = codeInput.value.trim();
      if (!email || code.length !== 6) {
        status.style.color = panelTheme.error.color;
        status.textContent = "Enter the 6-digit code.";
        return;
      }
      verifyBtn.disabled = true;
      sendBtn.disabled = true;
      cancel.disabled = true;
      try {
        const next = await verifyLoginCode(email, code);
        authState = next;
        refreshAuthUi();
        modal.close();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        status.style.color = panelTheme.error.color;
        status.textContent = `Failed: ${msg}`;
        verifyBtn.disabled = false;
        sendBtn.disabled = false;
        cancel.disabled = false;
      }
    });
    row.appendChild(verifyBtn);
    content.appendChild(row);

    codeInput.addEventListener("input", () => {
      verifyBtn.disabled = codeInput.value.length !== 6;
    });

    modal.setContent(content);
    emailInput.focus();
  }

  async function handleLogout(): Promise<void> {
    if (!authState) return;
    try {
      await logout(authState.token);
    } finally {
      authState = null;
      refreshAuthUi();
    }
  }

  function rememberGameEntry(name: string): void {
    const known = listUserGames().find((g) => g.name === name);
    if (known) return;
    rememberGame(Date.now() & 0xffff, name);
  }

  function show(): void {
    if (!document.body.contains(root)) document.body.appendChild(root);
    root.style.display = "flex";
    void validateCachedSession();
  }

  function hide(): void {
    root.style.display = "none";
  }

  function isVisible(): boolean {
    return root.style.display !== "none";
  }

  function destroy(): void {
    root.remove();
  }

  refreshAuthUi();

  return { root, show, hide, isVisible, destroy };
}

function makeBigButton(label: string, primary: boolean): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.textContent = label;
  Object.assign(btn.style, {
    padding: "14px 18px",
    fontSize: "15px",
    fontFamily: "Georgia, 'Times New Roman', serif",
    letterSpacing: "1px",
    background: primary
      ? "linear-gradient(180deg, #c9a227 0%, #a6801a 100%)"
      : "rgba(20, 33, 69, 0.85)",
    color: primary ? "#241a05" : "#f1e4c3",
    border: primary
      ? "1px solid #e9cf7d"
      : "1px solid rgba(201,162,39,0.55)",
    borderRadius: "4px",
    cursor: "pointer",
    boxShadow: primary
      ? "0 2px 0 rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.25)"
      : "none",
  });
  btn.addEventListener("mouseenter", () => {
    btn.style.filter = "brightness(1.15)";
  });
  btn.addEventListener("mouseleave", () => {
    btn.style.filter = "none";
  });
  return btn;
}

function defaultName(): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const suffix = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, "0");
  return `user-${ymd}-${suffix}`;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}
