import { api, type Game } from "./api";
import { hydrateGameState } from "../game/initState";
import type { GameState } from "@heroes/contracts";
import { bus } from "../core/eventBus";
import {
  getInMemoryLocalPlayerId,
  setInMemoryLocalPlayerId,
} from "../players/localPlayer";

export interface MpStateChangedEvent {
  type: "mp:stateChanged";
  gameName: string;
  prev: GameState | null;
  next: GameState;
  serverActivePlayerId: number;
}

export interface MpTurnStartedEvent {
  type: "mp:turnStarted";
  gameName: string;
  activePlayerId: number;
}

export class MultiplayerSync {
  private timer: number | null = null;
  private gameName: string | null = null;
  private lastSeen: GameState | null = null;
  private lastActivePlayerId: number | null = null;

  start(gameName: string, intervalMs = 2000): void {
    if (this.timer !== null) {
      this.stop();
    }
    this.gameName = gameName;
    this.lastSeen = null;
    this.lastActivePlayerId = null;
    void this.pollOnce();
    this.timer = window.setInterval(() => void this.pollOnce(), intervalMs);
  }

  stop(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    this.gameName = null;
    this.lastSeen = null;
    this.lastActivePlayerId = null;
  }

  isRunning(): boolean {
    return this.timer !== null;
  }

  async pollOnce(): Promise<void> {
    const gameName = this.gameName;
    if (!gameName) return;
    let game: Game;
    try {
      game = await api.getGame(gameName);
    } catch (e) {
      console.warn("[mp] poll failed:", e);
      return;
    }
    const hydrated = hydrateGameState(game);
    const localId = getInMemoryLocalPlayerId(gameName);
    const claimed = (game as unknown as { lobby?: { claimed?: Record<string, { handle: string }> } }).lobby?.claimed ?? {};
    if (localId === null && claimed[String(0)] && game.players[0]) {
      setInMemoryLocalPlayerId(gameName, 0);
    }

    const prev = this.lastSeen;
    const prevActive = this.lastActivePlayerId;
    this.lastSeen = hydrated;
    this.lastActivePlayerId = hydrated.activePlayerId;

    bus.emit({
      type: "mp:stateChanged",
      gameName,
      prev,
      next: hydrated,
      serverActivePlayerId: hydrated.activePlayerId,
    });

    if (prevActive !== null && prevActive !== hydrated.activePlayerId) {
      bus.emit({
        type: "mp:turnStarted",
        gameName,
        activePlayerId: hydrated.activePlayerId,
      });
    }
  }
}

let instance: MultiplayerSync | null = null;
export function getMultiplayerSync(): MultiplayerSync {
  if (!instance) instance = new MultiplayerSync();
  return instance;
}
