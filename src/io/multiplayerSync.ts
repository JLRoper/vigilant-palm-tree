import { api, type Game } from "./api";
import { hydrateGameState } from "@heroes/engine";
import type { GameState, NetworkTopologySnapshot } from "@heroes/contracts";
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

/** Emitted once per poll cycle with the server's current view of the network topology (issue #51). */
export interface MpTopologyUpdatedEvent {
  type: "mp:topologyUpdated";
  gameName: string;
  snapshot: NetworkTopologySnapshot;
}

type LobbyClaims = Record<string, { handle: string }>;

function readClaims(game: Game): LobbyClaims {
  return (game as unknown as { lobby?: { claimed?: LobbyClaims } }).lobby?.claimed ?? {};
}

export class MultiplayerSync {
  private timer: number | null = null;
  private gameName: string | null = null;
  private lastSeen: GameState | null = null;
  private lastActivePlayerId: number | null = null;
  private intervalMs = 2000;

  start(gameName: string, intervalMs = 2000): void {
    if (this.timer !== null) {
      this.stop();
    }
    this.gameName = gameName;
    this.lastSeen = null;
    this.lastActivePlayerId = null;
    this.intervalMs = intervalMs;
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
    // Real RTT: wall clock around the poll fetch itself. Measured on both the
    // success and failure paths so a failing link still reports how long it
    // took to fail rather than dropping out of the map entirely.
    const startedAt = performance.now();
    try {
      game = await api.getGame(gameName);
    } catch (e) {
      console.warn("[mp] poll failed:", e);
      this.reportTelemetry(gameName, performance.now() - startedAt, 0, false, null);
      return;
    }
    const rttMs = performance.now() - startedAt;
    const hydrated = hydrateGameState(game);
    const localId = getInMemoryLocalPlayerId(gameName);
    const claimed = readClaims(game);
    if (localId === null && claimed[String(0)] && game.players[0]) {
      setInMemoryLocalPlayerId(gameName, 0);
    }

    // Response size proxy for the bandwidth metric. Content-Length isn't
    // reachable through api.getGame's parsed return value, and this is a
    // debug-only proxy metric -- see the plan's scope decision 5.
    //
    // TextEncoder, not String.length: the latter counts UTF-16 code units, so
    // any non-ASCII in a payload (a player handle with an accent, say) would
    // under-report its real byte size.
    let responseBytes = 0;
    try {
      responseBytes = new TextEncoder().encode(JSON.stringify(game)).length;
    } catch {
      responseBytes = 0;
    }
    this.reportTelemetry(gameName, rttMs, responseBytes, true, claimed);

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

  /**
   * Fire-and-forget telemetry for the dev Network Map, then pull the merged
   * topology back and put it on the bus. Both halves swallow their own errors:
   * this is best-effort debug data and must never delay or fail a poll cycle,
   * the same posture as the console.warn on a failed poll above.
   */
  private reportTelemetry(
    gameName: string,
    rttMs: number,
    responseBytes: number,
    ok: boolean,
    claimed: LobbyClaims | null,
  ): void {
    // A client with no claimed seat has no PlayerId, so it has no node on the
    // graph and reports nothing. Every path that actually joins a multiplayer
    // game sets this (lobby claim, session load, and the seat-0 fallback in
    // pollOnce above), so a real player is never silently missing from the map.
    const playerId = getInMemoryLocalPlayerId(gameName);
    if (playerId === null) return;
    const label = claimed?.[String(playerId)]?.handle ?? `Player ${playerId}`;

    void api
      .reportTelemetry(gameName, { playerId, label, rttMs, responseBytes, ok })
      .then(() => api.getTopology(gameName))
      .then((snapshot) => {
        // The poll loop keeps running across a game switch; drop a snapshot
        // that resolved after start() moved on to a different game.
        if (this.gameName !== gameName) return;
        bus.emit({ type: "mp:topologyUpdated", gameName, snapshot });
      })
      .catch(() => {});
  }

  /** Poll cadence in ms — the network map's bandwidth proxy is expressed per this interval. */
  getIntervalMs(): number {
    return this.intervalMs;
  }
}

let instance: MultiplayerSync | null = null;
export function getMultiplayerSync(): MultiplayerSync {
  if (!instance) instance = new MultiplayerSync();
  return instance;
}
