import { api, type Game, type GameEventRow } from "./api";
import { applyEngineEvent, hydrateGameState } from "@heroes/engine";
import type { EngineEvent, GameState, NetworkTopologySnapshot } from "@heroes/contracts";
import { bus } from "../core/eventBus";
import { EntityMirror } from "../render/scene/entityMirror";
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

/** The delta events a poll actually applied, in log order (#146). */
export interface MpEventsAppliedEvent {
  type: "mp:eventsApplied";
  gameName: string;
  events: EngineEvent[];
  cursor: number;
}

/** Emitted whenever the poller fell back to a full-state refetch (#146). */
export interface MpResyncedEvent {
  type: "mp:resynced";
  gameName: string;
  state: GameState;
  cursor: number;
  reason: ResyncReason;
}

export type ResyncReason = "initial" | "event_not_derivable" | "cursor_gap";

type LobbyClaims = Record<string, { handle: string }>;

function readClaims(game: Game): LobbyClaims {
  return (game as unknown as { lobby?: { claimed?: LobbyClaims } }).lobby?.claimed ?? {};
}

// The 13 variants packages/contracts/src/events/engineEvent.ts actually
// declares. game_events also carries four legacy audit kinds
// (turn_ended/round_ended/round_started/ai_turn_started, appended alongside
// TurnEnded by server/app/commandHandler.ts) whose payloads are not
// EngineEvents -- this set is what separates the two. StructureBuilt is
// deliberately absent: it is plan-doc prose, not a declared variant.
const ENGINE_EVENT_KINDS = new Set<EngineEvent["type"]>([
  "HeroMoved",
  "GoldTransferred",
  "TurnEnded",
  "ResourcesTraded",
  "BattleResolved",
  "HeroRecruited",
  "TownHallUpgradeStarted",
  "AutoTradeToggled",
  "StackReordered",
  "SettlementCaptured",
  "CharterStarted",
  "BuildingUpgradeStarted",
  "SettlementUpgradeStarted",
]);

export function isEngineEventRow(row: GameEventRow): boolean {
  return (
    ENGINE_EVENT_KINDS.has(row.kind as EngineEvent["type"]) &&
    !!row.payload &&
    typeof row.payload === "object" &&
    (row.payload as { type?: unknown }).type === row.kind
  );
}

export class MultiplayerSync {
  private timer: number | null = null;
  private gameName: string | null = null;
  private lastSeen: GameState | null = null;
  private lastActivePlayerId: number | null = null;
  private intervalMs = 2000;
  // null means "not seeded yet" -- the next poll does a full hydrate and
  // takes its cursor from the same response (Game.last_event_id).
  private cursor: number | null = null;
  private claims: LobbyClaims = {};
  private selfEventIds = new Set<number>();
  private mirror = new EntityMirror();

  start(
    gameName: string,
    opts: { intervalMs?: number; cursor?: number; state?: GameState } = {},
  ): void {
    if (this.timer !== null) {
      this.stop();
    }
    this.gameName = gameName;
    this.lastSeen = opts.state ?? null;
    this.lastActivePlayerId = opts.state?.activePlayerId ?? null;
    this.intervalMs = opts.intervalMs ?? 2000;
    this.cursor =
      typeof opts.cursor === "number" && Number.isFinite(opts.cursor) && opts.cursor >= 0
        ? Math.floor(opts.cursor)
        : null;
    if (opts.state) this.mirror.bootstrap(opts.state);
    void this.pollOnce();
    this.timer = window.setInterval(() => void this.pollOnce(), this.intervalMs);
  }

  stop(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    this.gameName = null;
    this.lastSeen = null;
    this.lastActivePlayerId = null;
    this.cursor = null;
    this.claims = {};
    this.selfEventIds.clear();
  }

  isRunning(): boolean {
    return this.timer !== null;
  }

  /** Current poll cursor (game_events.id), or null while unseeded. */
  getCursor(): number | null {
    return this.cursor;
  }

  getState(): GameState | null {
    return this.lastSeen;
  }

  /**
   * The live Hero/Castle tween cache this poller feeds: bootstrapped on every
   * full resync, advanced per delta event in between. Wired here because this
   * is the only place the event stream exists; the renderer cutover that
   * reads from it is #148.
   */
  getMirror(): EntityMirror {
    return this.mirror;
  }

  /**
   * Record a game_events.id this client's own command caused, from the
   * `lastEventId` POST /commands returns. Those mutations were already
   * applied locally, so re-applying them off the poll would double-count.
   *
   * Recorded as ids rather than jumping the cursor to them: another player's
   * events may sit unpolled *below* that id, and skipping to it would drop
   * them. The actor_seat filter in applyRows() covers the same ground
   * whenever this client's seat is known; this set is what protects the
   * unclaimed-seat case (a starter game nobody claimed a lobby seat in),
   * where actor_seat cannot identify self.
   */
  noteSelfEventId(id: number): void {
    if (!Number.isFinite(id) || id <= 0) return;
    this.selfEventIds.add(Math.floor(id));
  }

  async pollOnce(): Promise<void> {
    const gameName = this.gameName;
    if (!gameName) return;
    if (this.cursor === null) {
      await this.resync(gameName, "initial");
      return;
    }
    const startedAt = performance.now();
    let rows: GameEventRow[];
    try {
      rows = await api.getEvents(gameName, this.cursor);
    } catch (e) {
      console.warn("[mp] event poll failed:", e);
      this.reportTelemetry(gameName, performance.now() - startedAt, 0, false);
      return;
    }
    const rttMs = performance.now() - startedAt;
    this.reportTelemetry(gameName, rttMs, measureBytes(rows), true);
    if (this.gameName !== gameName) return;
    if (rows.length === 0) return;
    await this.applyRows(gameName, rows);
  }

  private async applyRows(gameName: string, rows: GameEventRow[]): Promise<void> {
    const localSeat = getInMemoryLocalPlayerId(gameName);
    const prev = this.lastSeen;
    let state = this.lastSeen;
    const applied: EngineEvent[] = [];
    let cursor = this.cursor ?? 0;

    for (const row of rows) {
      const id = Number(row.id);
      if (Number.isFinite(id) && id > cursor) cursor = id;
      if (this.selfEventIds.delete(id)) continue;
      if (localSeat !== null && row.actor_seat === localSeat) continue;
      if (!isEngineEventRow(row)) continue;
      if (!state) {
        await this.resync(gameName, "cursor_gap");
        return;
      }
      const event = row.payload as EngineEvent;
      const result = applyEngineEvent(state, event);
      if (result.outcome === "resync") {
        await this.resync(gameName, "event_not_derivable");
        return;
      }
      if (result.outcome === "applied") {
        state = result.state;
        applied.push(event);
        this.mirror.applyEvent(event);
      }
    }

    this.cursor = cursor;
    if (!state || applied.length === 0) return;
    this.lastSeen = state;
    bus.emit({ type: "mp:eventsApplied", gameName, events: applied, cursor });
    this.emitStateChanged(gameName, prev, state);
  }

  private async resync(gameName: string, reason: ResyncReason): Promise<void> {
    const startedAt = performance.now();
    let game: Game;
    try {
      game = await api.getGame(gameName);
    } catch (e) {
      console.warn("[mp] resync failed:", e);
      this.reportTelemetry(gameName, performance.now() - startedAt, 0, false);
      return;
    }
    const rttMs = performance.now() - startedAt;
    if (this.gameName !== gameName) return;
    this.claims = readClaims(game);
    if (getInMemoryLocalPlayerId(gameName) === null && this.claims[String(0)] && game.players[0]) {
      setInMemoryLocalPlayerId(gameName, 0);
    }
    this.reportTelemetry(gameName, rttMs, measureBytes(game), true);

    const hydrated = hydrateGameState(game);
    const seeded = Number(game.last_event_id ?? 0);
    this.cursor = Number.isFinite(seeded) && seeded >= 0 ? seeded : 0;
    this.selfEventIds.clear();
    const prev = this.lastSeen;
    this.lastSeen = hydrated;
    this.mirror.bootstrap(hydrated);
    bus.emit({ type: "mp:resynced", gameName, state: hydrated, cursor: this.cursor, reason });
    this.emitStateChanged(gameName, prev, hydrated);
  }

  private emitStateChanged(gameName: string, prev: GameState | null, next: GameState): void {
    const prevActive = this.lastActivePlayerId;
    this.lastActivePlayerId = next.activePlayerId;
    bus.emit({
      type: "mp:stateChanged",
      gameName,
      prev,
      next,
      serverActivePlayerId: next.activePlayerId,
    });
    if (prevActive !== null && prevActive !== next.activePlayerId) {
      bus.emit({ type: "mp:turnStarted", gameName, activePlayerId: next.activePlayerId });
    }
  }

  /**
   * Fire-and-forget telemetry for the dev Network Map, then pull the merged
   * topology back and put it on the bus. Both halves swallow their own errors:
   * this is best-effort debug data and must never delay or fail a poll cycle,
   * the same posture as the console.warn on a failed poll above.
   *
   * The bandwidth proxy now measures whatever the cycle actually fetched --
   * a delta page on a normal poll, a full row only on a resync. Shrinking
   * that number is the point of #146, so the map reads it unchanged.
   */
  private reportTelemetry(
    gameName: string,
    rttMs: number,
    responseBytes: number,
    ok: boolean,
  ): void {
    // A client with no claimed seat has no PlayerId, so it has no node on the
    // graph and reports nothing. Every path that actually joins a multiplayer
    // game sets this (lobby claim, session load, and the seat-0 fallback in
    // resync above), so a real player is never silently missing from the map.
    const playerId = getInMemoryLocalPlayerId(gameName);
    if (playerId === null) return;
    const label = this.claims[String(playerId)]?.handle ?? `Player ${playerId}`;

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

// TextEncoder, not String.length: the latter counts UTF-16 code units, so
// any non-ASCII in a payload (a player handle with an accent, say) would
// under-report its real byte size.
function measureBytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    return 0;
  }
}

let instance: MultiplayerSync | null = null;
export function getMultiplayerSync(): MultiplayerSync {
  if (!instance) instance = new MultiplayerSync();
  return instance;
}
