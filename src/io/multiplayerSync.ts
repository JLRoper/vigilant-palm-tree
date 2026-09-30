import { api, eventStreamUrl, type Game, type GameEventRow } from "./api";
import { applyEngineEvent, ENGINE_EVENT_SYNC_CLASS, hydrateGameState } from "@heroes/engine";
import type { EngineEvent, GameState } from "@heroes/contracts";
import { bus } from "../core/eventBus";
import type { ResyncReason } from "../core/events";
import { EntityMirror } from "../render/scene/entityMirror";
import {
  getInMemoryLocalPlayerId,
  setInMemoryLocalPlayerId,
} from "../players/localPlayer";

type LobbyClaims = Record<string, { handle: string }>;

// The slice of the browser's EventSource this class actually uses, declared
// locally so the implementation and the node-test fake agree on the surface
// without dragging DOM lib typing through casts. node tests stub window with
// no EventSource at all, so the lookup below must tolerate its absence.
type EventStreamFrame = { data: string; lastEventId: string };
type EventStreamSource = {
  addEventListener(type: string, listener: (ev: EventStreamFrame) => void): void;
  onerror: ((ev: unknown) => void) | null;
  close(): void;
};
type EventSourceCtor = new (url: string) => EventStreamSource;

function readClaims(game: Game): LobbyClaims {
  return game.lobby?.claimed ?? {};
}

// The 17 admitted of the 24 EngineEvent variants declared in
// packages/contracts/src/events/engineEvent.ts, derived from
// ENGINE_EVENT_SYNC_CLASS (packages/engine/src/events/applyEvent.ts): the 10
// "apply" kinds replay through the reducer below, and the 7 "resync" kinds
// are admitted knowing applyEngineEvent answers them with "resync" (a full
// refetch) rather than a guess. The 7 "ignore" boundary kinds
// (BuildingsPlaced, ResourcesTransferred, WagonsAssigned, WagonsBought,
// TradeRouteCreated, TradeRouteUpdated, TradeRouteRemoved) are skipped here:
// their state effects are not payload-derivable, so they arrive via the
// TurnEnded/poll resync boundary instead. game_events also carries four
// legacy audit kinds (turn_ended/round_ended/round_started/ai_turn_started,
// appended alongside TurnEnded by server/app/commandHandler.ts) whose
// payloads are not EngineEvents -- the payload.type===kind check in
// isEngineEventRow is what separates the two. StructureBuilt is plan-doc
// prose, not a declared variant. SettlementBattleResolved is admitted
// knowing applyEngineEvent answers it with "resync": its payload
// (winner/captured only) cannot re-derive the resulting stacks/gold/hero
// outcomes, so it flows through the full-refetch path below instead of
// being dropped as an unknown kind.
const ENGINE_EVENT_KINDS: ReadonlySet<EngineEvent["type"]> = new Set(
  Object.entries(ENGINE_EVENT_SYNC_CLASS)
    .filter(([, cls]) => cls !== "ignore")
    .map(([kind]) => kind as EngineEvent["type"]),
);

export function isEngineEventRow(row: GameEventRow): boolean {
  return (
    ENGINE_EVENT_KINDS.has(row.kind as EngineEvent["type"]) &&
    !!row.payload &&
    typeof row.payload === "object" &&
    (row.payload as { type?: unknown }).type === row.kind
  );
}

const NO_SEATS: ReadonlySet<number> = new Set();

// Driven AI seats (2026-09-29 garrison-divergence defect): the primary
// client (seat 0) runs the AI tick, so its command merges already applied
// every AI-seat mutation locally -- a server UnitsRecruited row whose actor
// is the AI seat must then be skipped exactly like an own-seat row, or the
// additive applied-reducers (applyUnitsRecruited etc.) deposit the same
// troops a second time (server 270 peasants, client 540+). Only a KNOWN
// seat 0 drives: a null localSeat (unclaimed seat, node tests) keeps
// applying, which is the non-primary client's only source of AI state.
function aiSeatsOf(state: GameState | null): ReadonlySet<number> {
  const seats = new Set<number>();
  if (!state) return seats;
  for (const player of state.players) {
    if (player.faction === "ai") seats.add(player.id);
  }
  return seats;
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
  private eventSource: EventStreamSource | null = null;

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
    this.openEventStream(gameName);
  }

  stop(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    this.closeEventSource();
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

  /**
   * SSE accelerator (plan 2026-09-28-sse-event-push.md): opens the event
   * stream alongside the poll. Frames land in applyRows like polled rows --
   * same cursor advance, same filtering, same bus emissions -- so the 2 s
   * poll stays as the pure backstop and nothing downstream can tell which
   * transport a row arrived on. Deliberately skipped where EventSource
   * doesn't exist (node tests): the poll alone is correct, SSE only makes it
   * faster. isRunning() stays timer-based; the stream is an accelerator, not
   * the run state.
   */
  private openEventStream(gameName: string): void {
    this.closeEventSource();
    if (typeof window === "undefined") return;
    const ctor = (window as unknown as { EventSource?: EventSourceCtor }).EventSource;
    if (typeof ctor !== "function") return;
    try {
      const source = new ctor(eventStreamUrl(gameName, this.cursor ?? 0));
      source.addEventListener("log", (frame) => {
        // A stale frame from a previous start() (or one landing after
        // stop()) must not touch the current game's pipeline.
        if (this.gameName !== gameName) return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(frame.data);
        } catch {
          return;
        }
        if (typeof parsed !== "object" || parsed === null) return;
        const candidate = parsed as Partial<GameEventRow>;
        if (typeof candidate.id !== "string" || typeof candidate.kind !== "string") return;
        const row: GameEventRow = {
          id: candidate.id,
          kind: candidate.kind,
          payload: candidate.payload,
          actor_seat: typeof candidate.actor_seat === "number" ? candidate.actor_seat : null,
          created_at: typeof candidate.created_at === "string" ? candidate.created_at : "",
        };
        void this.applyRows(gameName, [row]);
      });
      // The browser auto-reconnects with Last-Event-ID (== our cursor) and
      // the poll covers correctness while disconnected, so an error only
      // warrants a warn.
      source.onerror = () => {
        console.warn("[mp] event stream error; browser will reconnect, poll backstop covers the gap");
      };
      this.eventSource = source;
    } catch (e) {
      console.warn("[mp] event stream unavailable:", e);
    }
  }

  private closeEventSource(): void {
    if (this.eventSource === null) return;
    try {
      this.eventSource.close();
    } catch {
      // A close() on an already-dead source is a no-op in every browser;
      // nothing actionable if one disagrees.
    }
    this.eventSource = null;
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
    const drivenAiSeats = localSeat === 0 ? aiSeatsOf(this.lastSeen) : NO_SEATS;
    const prev = this.lastSeen;
    let state = this.lastSeen;
    const applied: EngineEvent[] = [];
    let cursor = this.cursor ?? 0;

    for (const row of rows) {
      // Log-panel fan-out (plan 2026-09-28-sse-event-push.md, use case 1):
      // every row, engine or legacy audit kind, any seat -- emitted before
      // all filtering below. Both transports funnel through here, and
      // SSE-delivered rows advance the cursor, so the poll's after=cursor
      // query never re-delivers them: exactly-once per row.
      bus.emit({ type: "mp:logRow", gameName, row });
      const id = Number(row.id);
      if (Number.isFinite(id) && id > cursor) cursor = id;
      if (this.selfEventIds.delete(id)) continue;
      if (localSeat !== null && row.actor_seat === localSeat) continue;
      if (row.actor_seat !== null && drivenAiSeats.has(row.actor_seat)) continue;
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
    // Drop-policy presence rides the row the resync just fetched (the
    // per-poll delta cycles get theirs from the telemetry POST response).
    const lobbyPresence = game.lobby?.presence;
    if (lobbyPresence) {
      bus.emit({ type: "mp:presenceUpdated", gameName, presence: lobbyPresence });
    }

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
   * The POST response now also carries the drop-policy seat-presence view
   * (2026-09-27), so this same call is the per-poll presence read: any
   * non-null presence goes on the bus as mp:presenceUpdated before the
   * topology fetch, exactly as best-effort.
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
      .then((presence) => {
        // The poll loop keeps running across a game switch; drop anything
        // that resolved after start() moved on to a different game.
        if (this.gameName !== gameName) return;
        if (presence) {
          bus.emit({ type: "mp:presenceUpdated", gameName, presence });
        }
        return api.getTopology(gameName);
      })
      .then((snapshot) => {
        if (!snapshot) return;
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

export function getEntityMirror(): EntityMirror {
  return getMultiplayerSync().getMirror();
}
