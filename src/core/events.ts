import type {
  Axial,
  EngineEvent,
  GameState,
  HeroId,
  NetworkTopologySnapshot,
  SettlementId,
} from "@heroes/contracts";

export type GameEvent =
  | { type: "state:committed" }
  | { type: "turn:ended"; playerId: number }
  | { type: "phase:changed"; oldPhase: string; newPhase: string }
  | { type: "round:changed"; round: number }
  | { type: "day:changed"; day: number }
  | { type: "hero:moved"; heroId: HeroId; from: Axial; to: Axial; playerId: number }
  | { type: "settlement:captured"; heroId: HeroId; settlementId: SettlementId }
  | { type: "battle:resolved"; attackerId: HeroId; defenderId: HeroId; attackerSurvived: boolean }
  | { type: "economy:goldChanged"; entityId: string; entityType: "hero" | "settlement"; amount: number }
  | { type: "economy:warehouseChanged"; settlementId: SettlementId; resource: string; amount: number }
  | { type: "economy:moraleChanged"; settlementId: SettlementId; morale: number }
  | { type: "calc:controlRange"; settlementId: SettlementId; level: number; range: number }
  | { type: "calc:visionRange"; settlementId: SettlementId; level: number; range: number }
  | { type: "calc:heroSpeed"; heroId: HeroId; baseSpeed: number; speed: number }
  // #100: emitted by src/game/turnHooks.ts when a fire-and-forget command
  // (onRecruitHero/onHumanMove/etc. -- see src/state/turnController.ts's
  // TurnControllerHooks) rejects. `action` is a short human label for what
  // was attempted ("Move hero", "Recruit hero", ...); `reason` is the
  // server's own error code/message where available (see src/io/commands.ts's
  // CommandError), otherwise the raw failure text. Consumed by
  // src/screens/shared/toast.ts to give the player a visible notification
  // instead of the previous console.warn-only silence.
  | { type: "command:rejected"; action: string; reason: string }
  | MpStateChangedEvent
  | MpTurnStartedEvent
  | MpTopologyUpdatedEvent
  | MpEventsAppliedEvent
  | MpResyncedEvent
  | MpPresenceUpdatedEvent
  | MpLogRowEvent
  | MpBattleOutcomeEvent;

export type ResyncReason = "initial" | "event_not_derivable" | "cursor_gap";

/** One seat's server-side presence, from the games row's lobby.presence (drop policy, shipped 2026-09-27). */
export type MpSeatPresence = {
  /** Server-side last-heartbeat time, ISO-8601. */
  lastSeenAt: string;
  connected: boolean;
};

/**
 * Emitted whenever the poller learns a fresh seat-presence view: the
 * per-poll telemetry POST response carries it, and a full resync carries it
 * on the row's lobby.presence. Consumers render "(disconnected)" seat state
 * (multiplayerLobby seat list, the in-game "waiting for seat N" hint).
 */
export type MpPresenceUpdatedEvent = {
  type: "mp:presenceUpdated";
  gameName: string;
  presence: Record<string, MpSeatPresence>;
};

/** Emitted once per poll cycle with the server's current view of the network topology (issue #51). */
export type MpTopologyUpdatedEvent = {
  type: "mp:topologyUpdated";
  gameName: string;
  snapshot: NetworkTopologySnapshot;
};

/** The delta events a poll actually applied, in log order (#146). */
export type MpEventsAppliedEvent = {
  type: "mp:eventsApplied";
  gameName: string;
  events: EngineEvent[];
  cursor: number;
};

/** Emitted whenever the poller fell back to a full-state refetch (#146). */
export type MpResyncedEvent = {
  type: "mp:resynced";
  gameName: string;
  state: GameState;
  cursor: number;
  reason: ResyncReason;
};

export type MpStateChangedEvent = {
  type: "mp:stateChanged";
  gameName: string;
  prev: GameState | null;
  next: GameState;
  serverActivePlayerId: number;
};

export type MpTurnStartedEvent = {
  type: "mp:turnStarted";
  gameName: string;
  activePlayerId: number;
};

/**
 * One game_events row, as fanned out to the Log Message Panel (plan
 * 2026-09-28-sse-event-push.md, use case 1). Structurally mirrors
 * src/io/api.ts's GameEventRow -- declared separately because core/ is
 * leaf-only (dependency-cruiser) and must not import from io/, the same
 * reasoning as api.ts's client-side lobby types. `payload` is the persisted
 * EngineEvent for the engine kinds and a bespoke audit blob for the legacy
 * kinds, so it stays unknown and is narrowed at the point of use.
 */
export type MpLogRow = {
  id: string;
  kind: string;
  payload: unknown;
  actor_seat: number | null;
  created_at: string;
};

/**
 * Emitted by MultiplayerSync.applyRows at the top of its row loop -- for
 * EVERY row it sees, engine or legacy audit kind, any seat including this
 * client's own -- before any state filtering/skipping. The SSE and poll
 * paths both funnel through applyRows, so this is exactly-once per row:
 * SSE-delivered rows advance the cursor, so the poll backstop's
 * `after=cursor` never re-delivers them.
 */
export type MpLogRowEvent = {
  type: "mp:logRow";
  gameName: string;
  row: MpLogRow;
};

/**
 * Which battle family a `mp:battleOutcome` payload belongs to -- the two
 * server producers of battle verdicts (server/app/commandHandler.ts's
 * ResolveBattle and SubmitSettlementBattleResult cases, driven directly by
 * the AI driver on flagged games).
 */
export type BattleOutcomeKind = "heroBattle" | "settlementBattle";

/** The persisted EngineEvent payloads carried by a `mp:battleOutcome`. */
export type BattleOutcomeEventPayload =
  | Extract<EngineEvent, { type: "BattleResolved" }>
  | Extract<EngineEvent, { type: "SettlementBattleResolved" }>;

/**
 * One resolved battle, fanned out by MultiplayerSync.applyRows at the same
 * exactly-once-per-row point as `mp:logRow` -- before the self/seat skips,
 * so every seat (including the driver-resolved battles no client ever saw a
 * direct response for) receives it; the consumer gates. This is the D5
 * parity path (server-side AI actor plan Phase 2): on a server-driven game
 * the battle verdict reaches every browser as an event, and the event-
 * derived card/toast layer words it.
 */
export type MpBattleOutcomeEvent = {
  type: "mp:battleOutcome";
  gameName: string;
  /** The game_events row id -- the cross-transport dedupe key. */
  id: string;
  kind: BattleOutcomeKind;
  payload: BattleOutcomeEventPayload;
  /** The acting (attacking) seat, or null when the row carried none. */
  actorSeat: number | null;
};
