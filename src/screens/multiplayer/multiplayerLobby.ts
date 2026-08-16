import { api, type Game } from "../../io/api";
import { openCenteredModal, styleButton, styleInput, menuTheme } from "@screens/shared/menu";
import { PLAYER_COLORS } from "../../state/playerColors";
import {
  setInMemoryLocalPlayerId,
  setLocalPlayerId,
} from "../../players/localPlayer";

interface LobbySeat {
  id: number;
  handle?: string;
  isLocal: boolean;
}

interface LobbySnapshot {
  gameName: string;
  seats: LobbySeat[];
  started: boolean;
}

interface CreateMultiplayerLobbyOptions {
  isBackendOk: () => boolean;
  onEnterGame: () => void;
  onJoinGame: (game: Game) => Promise<void>;
}

const SEAT_COUNTS: Array<2 | 3 | 4> = [2, 3, 4];

function defaultGameName(): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const suffix = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, "0");
  return `lan-${ymd}-${suffix}`;
}

function snapshotFromGame(game: Game, localPlayerId: number | null): LobbySnapshot {
  const claimed = (game as unknown as { lobby?: { claimed?: Record<string, { handle: string }>; startedAt?: string; seats?: number } }).lobby ?? {};
  const seatTotal = claimed.seats ?? game.players.length;
  const seats: LobbySeat[] = [];
  for (let i = 0; i < seatTotal; i++) {
    const claim = claimed.claimed?.[String(i)];
    seats.push({
      id: i,
      handle: claim?.handle,
      isLocal: localPlayerId === i,
    });
  }
  return {
    gameName: game.name,
    seats,
    started: Boolean(claimed.startedAt),
  };
}

export function createMultiplayerLobby(opts: CreateMultiplayerLobbyOptions): void {
  const modal = openCenteredModal(document.body, "Multiplayer Lobby", 460);
  const content = document.createElement("div");
  content.style.fontFamily = menuTheme.font;
  content.style.fontSize = menuTheme.fontSize;
  content.style.color = menuTheme.panel.color;
  content.style.display = "flex";
  content.style.flexDirection = "column";
  content.style.gap = "10px";
  modal.setContent(content);

  let activeGameName: string | null = null;
  let activeLocalPlayerId: number | null = null;
  let pollTimer: number | null = null;

  const tabRow = document.createElement("div");
  Object.assign(tabRow.style, { display: "flex", gap: "8px" });
  content.appendChild(tabRow);

  const hostBtn = document.createElement("button");
  hostBtn.textContent = "Host";
  styleButton(hostBtn, true);
  const joinBtn = document.createElement("button");
  joinBtn.textContent = "Join";
  styleButton(joinBtn);
  tabRow.appendChild(hostBtn);
  tabRow.appendChild(joinBtn);

  const hostPanel = document.createElement("div");
  hostPanel.style.display = "flex";
  hostPanel.style.flexDirection = "column";
  hostPanel.style.gap = "8px";
  const joinPanel = document.createElement("div");
  joinPanel.style.display = "none";
  joinPanel.style.flexDirection = "column";
  joinPanel.style.gap = "8px";
  content.appendChild(hostPanel);
  content.appendChild(joinPanel);

  const lobbyView = document.createElement("div");
  lobbyView.style.display = "none";
  lobbyView.style.flexDirection = "column";
  lobbyView.style.gap = "8px";
  content.appendChild(lobbyView);

  const errorLine = document.createElement("div");
  Object.assign(errorLine.style, { color: "#f88", fontSize: "11px", minHeight: "14px" });
  content.appendChild(errorLine);

  function showError(msg: string): void {
    errorLine.textContent = msg;
  }

  function clearError(): void {
    errorLine.textContent = "";
  }

  function setActiveTab(tab: "host" | "join"): void {
    hostPanel.style.display = tab === "host" ? "flex" : "none";
    joinPanel.style.display = tab === "join" ? "flex" : "none";
    lobbyView.style.display = "none";
    styleButton(hostBtn, tab === "host");
    styleButton(joinBtn, tab === "join");
  }
  hostBtn.addEventListener("click", () => setActiveTab("host"));
  joinBtn.addEventListener("click", () => setActiveTab("join"));
  setActiveTab("host");

  function buildHostPanel(): void {
    hostPanel.replaceChildren();
    const intro = document.createElement("div");
    intro.textContent =
      "Pick a seat count and game name. Share the LAN URL with other players; they'll open this page and click Join.";
    intro.style.opacity = "0.7";
    intro.style.fontSize = "11px";
    hostPanel.appendChild(intro);

    const nameLabel = document.createElement("label");
    nameLabel.textContent = "Game name";
    nameLabel.style.opacity = "0.7";
    nameLabel.style.fontSize = "11px";
    hostPanel.appendChild(nameLabel);
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.value = defaultGameName();
    styleInput(nameInput);
    hostPanel.appendChild(nameInput);

    const seatsLabel = document.createElement("label");
    seatsLabel.textContent = "Number of players (humans + AIs)";
    seatsLabel.style.opacity = "0.7";
    seatsLabel.style.fontSize = "11px";
    hostPanel.appendChild(seatsLabel);
    const seatWrap = document.createElement("div");
    Object.assign(seatWrap.style, { display: "flex", gap: "6px" });
    let selectedSeats: 2 | 3 | 4 = 3;
    const seatBtns: Record<2 | 3 | 4, HTMLButtonElement> = {} as Record<2 | 3 | 4, HTMLButtonElement>;
    function refreshSeats(): void {
      for (const n of SEAT_COUNTS) {
        const b = seatBtns[n];
        const active = n === selectedSeats;
        b.style.background = active
          ? "linear-gradient(180deg, #c9a227 0%, #a6801a 100%)"
          : "rgba(20, 33, 69, 0.85)";
        b.style.color = active ? "#241a05" : "#f1e4c3";
      }
    }
    for (const n of SEAT_COUNTS) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = String(n);
      styleButton(b);
      b.addEventListener("click", () => {
        selectedSeats = n;
        refreshSeats();
      });
      seatBtns[n] = b;
      seatWrap.appendChild(b);
    }
    hostPanel.appendChild(seatWrap);
    refreshSeats();

    const humanLabel = document.createElement("label");
    humanLabel.textContent = "Number of human players";
    humanLabel.style.opacity = "0.7";
    humanLabel.style.fontSize = "11px";
    hostPanel.appendChild(humanLabel);
    const humanInput = document.createElement("input");
    humanInput.type = "number";
    humanInput.min = "1";
    humanInput.max = String(selectedSeats);
    humanInput.value = "2";
    styleInput(humanInput);
    hostPanel.appendChild(humanInput);
    seatWrap.querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", () => {
        humanInput.max = String(selectedSeats);
        const v = Number(humanInput.value);
        if (v > selectedSeats) humanInput.value = String(selectedSeats);
        if (v < 1) humanInput.value = "1";
      }),
    );

    const handleLabel = document.createElement("label");
    handleLabel.textContent = "Your handle (host = seat 0)";
    handleLabel.style.opacity = "0.7";
    handleLabel.style.fontSize = "11px";
    hostPanel.appendChild(handleLabel);
    const handleInput = document.createElement("input");
    handleInput.type = "text";
    handleInput.value = "Host";
    handleInput.maxLength = 32;
    styleInput(handleInput);
    hostPanel.appendChild(handleInput);

    const urlLine = document.createElement("div");
    Object.assign(urlLine.style, {
      fontSize: "11px",
      opacity: "0.8",
      padding: "6px 0",
      wordBreak: "break-all",
    });
    function refreshUrl(): void {
      urlLine.textContent = `LAN URL: ${window.location.origin}/  (joiners need the game name "${nameInput.value}")`;
    }
    refreshUrl();
    nameInput.addEventListener("input", refreshUrl);
    hostPanel.appendChild(urlLine);

    const row = document.createElement("div");
    Object.assign(row.style, { display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "8px" });
    const cancel = document.createElement("button");
    cancel.textContent = "Cancel";
    styleButton(cancel);
    cancel.addEventListener("click", () => modal.close());
    row.appendChild(cancel);
    const create = document.createElement("button");
    create.textContent = "Create Lobby";
    styleButton(create, true);
    row.appendChild(create);
    hostPanel.appendChild(row);

    create.addEventListener("click", async () => {
      clearError();
      const gameName = nameInput.value.trim();
      if (!gameName) {
        showError("Game name required.");
        return;
      }
      const humanSlots = Math.max(1, Math.min(selectedSeats, Number(humanInput.value) || 1));
      const handle = handleInput.value.trim() || "Host";
      create.disabled = true;
      try {
        const map = new (await import("../../map/gameMap")).GameMap(Math.floor(Math.random() * 0x7fffffff));
        const heroQ = map.width >> 1;
        const heroR = map.height >> 1;
        const created = await api.createGame(gameName, Math.floor(Math.random() * 0x7fffffff), heroQ, heroR, [], "small", humanSlots);
        const updated = await api.claimLobbySeat(created.name, 0, handle);
        activeGameName = updated.name;
        activeLocalPlayerId = 0;
        setInMemoryLocalPlayerId(updated.name, 0);
        setLocalPlayerId(updated.name, 0);
        await openLobby(updated);
      } catch (e) {
        showError(`Failed: ${e instanceof Error ? e.message : String(e)}`);
        create.disabled = false;
      }
    });
  }
  buildHostPanel();

  function buildJoinPanel(): void {
    joinPanel.replaceChildren();
    const intro = document.createElement("div");
    intro.textContent =
      "Enter the host's game name (the host will tell you what to type). Your handle is what other players see.";
    intro.style.opacity = "0.7";
    intro.style.fontSize = "11px";
    joinPanel.appendChild(intro);

    const nameLabel = document.createElement("label");
    nameLabel.textContent = "Game name";
    nameLabel.style.opacity = "0.7";
    nameLabel.style.fontSize = "11px";
    joinPanel.appendChild(nameLabel);
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.placeholder = "host's game name";
    styleInput(nameInput);
    joinPanel.appendChild(nameInput);

    const seatLabel = document.createElement("label");
    seatLabel.textContent = "Seat to claim";
    seatLabel.style.opacity = "0.7";
    seatLabel.style.fontSize = "11px";
    joinPanel.appendChild(seatLabel);
    const seatInput = document.createElement("input");
    seatInput.type = "number";
    seatInput.min = "0";
    seatInput.value = "1";
    styleInput(seatInput);
    joinPanel.appendChild(seatInput);

    const handleLabel = document.createElement("label");
    handleLabel.textContent = "Your handle";
    handleLabel.style.opacity = "0.7";
    handleLabel.style.fontSize = "11px";
    joinPanel.appendChild(handleLabel);
    const handleInput = document.createElement("input");
    handleInput.type = "text";
    handleInput.placeholder = "Player";
    handleInput.maxLength = 32;
    styleInput(handleInput);
    joinPanel.appendChild(handleInput);

    const row = document.createElement("div");
    Object.assign(row.style, { display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "8px" });
    const cancel = document.createElement("button");
    cancel.textContent = "Cancel";
    styleButton(cancel);
    cancel.addEventListener("click", () => modal.close());
    row.appendChild(cancel);
    const join = document.createElement("button");
    join.textContent = "Claim Seat";
    styleButton(join, true);
    row.appendChild(join);
    joinPanel.appendChild(row);

    join.addEventListener("click", async () => {
      clearError();
      const gameName = nameInput.value.trim();
      if (!gameName) {
        showError("Game name required.");
        return;
      }
      const seat = Math.max(0, Math.floor(Number(seatInput.value) || 0));
      const handle = handleInput.value.trim() || "Player";
      join.disabled = true;
      try {
        const updated = await api.claimLobbySeat(gameName, seat, handle);
        activeGameName = updated.name;
        activeLocalPlayerId = seat;
        setInMemoryLocalPlayerId(updated.name, seat);
        setLocalPlayerId(updated.name, seat);
        await openLobby(updated);
      } catch (e) {
        showError(`Failed: ${e instanceof Error ? e.message : String(e)}`);
        join.disabled = false;
      }
    });
  }
  buildJoinPanel();

  async function openLobby(game: Game): Promise<void> {
    hostPanel.style.display = "none";
    joinPanel.style.display = "none";
    tabRow.style.display = "none";
    lobbyView.style.display = "flex";
    await renderLobby(game);
    startPolling();
  }

  async function renderLobby(game: Game): Promise<void> {
    lobbyView.replaceChildren();
    const snap = snapshotFromGame(game, activeLocalPlayerId);
    const heading = document.createElement("div");
    heading.style.fontSize = "13px";
    heading.style.opacity = "0.85";
    heading.textContent = `Lobby for "${snap.gameName}" — ${snap.started ? "started" : "waiting for players"}`;
    lobbyView.appendChild(heading);

    const grid = document.createElement("div");
    Object.assign(grid.style, { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" });
    for (const seat of snap.seats) {
      grid.appendChild(renderSeat(seat));
    }
    lobbyView.appendChild(grid);

    const actions = document.createElement("div");
    Object.assign(actions.style, { display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "8px" });
    const close = document.createElement("button");
    close.textContent = "Close";
    styleButton(close);
    close.addEventListener("click", () => {
      stopPolling();
      modal.close();
    });
    actions.appendChild(close);

    if (activeLocalPlayerId === 0 && !snap.started) {
      const allClaimed = snap.seats.length > 0 && snap.seats.every((s) => Boolean(s.handle));
      const start = document.createElement("button");
      start.textContent = "Start Game";
      styleButton(start, true);
      start.disabled = !allClaimed;
      if (!allClaimed) start.title = "All seats must be claimed first";
      start.addEventListener("click", async () => {
        clearError();
        start.disabled = true;
        try {
          const updated = await api.startLobby(snap.gameName);
          await enterGame(updated);
        } catch (e) {
          showError(`Failed: ${e instanceof Error ? e.message : String(e)}`);
          start.disabled = false;
        }
      });
      actions.appendChild(start);
    } else if (snap.started && activeGameName) {
      const enter = document.createElement("button");
      enter.textContent = "Enter Game";
      styleButton(enter, true);
      enter.addEventListener("click", () => enterGame(game));
      actions.appendChild(enter);
    }
    lobbyView.appendChild(actions);
  }

  function renderSeat(seat: LobbySeat): HTMLDivElement {
    const row = document.createElement("div");
    Object.assign(row.style, {
      padding: "8px 10px",
      border: "1px solid rgba(255,255,255,0.1)",
      borderRadius: "3px",
      background: "rgba(20, 33, 69, 0.6)",
      display: "flex",
      alignItems: "center",
      gap: "8px",
    });
    const swatch = document.createElement("div");
    Object.assign(swatch.style, {
      width: "14px",
      height: "14px",
      borderRadius: "2px",
      background: PLAYER_COLORS[seat.id] ?? "#cccccc",
      border: "1px solid rgba(0,0,0,0.4)",
    });
    row.appendChild(swatch);
    const label = document.createElement("div");
    label.style.fontSize = "12px";
    label.textContent = seat.handle
      ? `${seat.handle}${seat.isLocal ? " (you)" : ""}`
      : `Seat ${seat.id} — open`;
    if (!seat.handle) label.style.opacity = "0.6";
    row.appendChild(label);
    return row;
  }

  function startPolling(): void {
    stopPolling();
    pollTimer = window.setInterval(async () => {
      if (!activeGameName || !opts.isBackendOk()) return;
      try {
        const game = await api.getGame(activeGameName);
        const snap = snapshotFromGame(game, activeLocalPlayerId);
        if (snap.started) {
          stopPolling();
          await renderLobby(game);
          await enterGame(game);
        } else {
          await renderLobby(game);
        }
      } catch (e) {
        console.warn("lobby poll failed:", e);
      }
    }, 2000);
  }

  function stopPolling(): void {
    if (pollTimer !== null) {
      window.clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  async function enterGame(game: Game): Promise<void> {
    stopPolling();
    modal.close();
    try {
      await opts.onJoinGame(game);
    } catch (e) {
      showError(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  modal.setOnClose(() => stopPolling());
}
