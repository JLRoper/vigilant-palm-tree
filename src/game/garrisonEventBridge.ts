import type { EngineEvent, GamePhase, GameState } from "@heroes/contracts";
import { applyEngineEvent } from "@heroes/engine";
import { bus } from "../core/eventBus";
import type { MpEventsAppliedEvent, MpResyncedEvent } from "../core/events";
import type { TurnController } from "../state/turnController";

export interface GarrisonEventBridgeDeps {
  getController(): TurnController | null;
  replaceState(next: GameState): void;
  isPrimaryActor(): boolean;
  localSeat(): number | null;
}

// The slice of the engine event stream this bridge carries into the local
// TurnController: garrison writes (UnitsRecruited/UnitsTransferred arrive as
// applied deltas) and settlement-garrison battle outcomes
// (SettlementBattleResolved is not derivable from its payload, so it reaches
// the controller as the full-refetch snapshot behind mp:resynced). Other
// engine kinds keep their existing transport (mergeFromEndTurn / game load).
function isGarrisonDelta(event: EngineEvent): boolean {
  return event.type === "UnitsRecruited" || event.type === "UnitsTransferred";
}

function blockedPhase(phase: GamePhase): boolean {
  return phase.kind === "BATTLE" || phase.kind === "SETTLEMENT_BATTLE" || phase.kind === "ROUND_END";
}

// Replays the deltas through the engine's own event reducer -- the same path
// MultiplayerSync.applyRows ran on its private state copy -- so the
// controller's state converges without the bridge reaching into the sync's
// internals. A delta that no longer replays (state drifted between poll and
// merge) is skipped; the next resync boundary reconciles.
function applyDeltas(start: GameState, events: EngineEvent[]): GameState | null {
  let state = start;
  for (const event of events) {
    const result = applyEngineEvent(state, event);
    if (result.outcome === "applied") state = result.state;
  }
  return state === start ? null : state;
}

// The resynced state is a full server hydrate and is taken wholesale (the
// mergeFromEndTurn shape), except that selections are client-local UI state:
// they survive only while the selected entity still exists -- and a hero
// selection only while it belongs to the local viewer's seat, so a foreign
// selection can never re-enter shared state and light up a fog-hidden
// hero's path/trail. Unknown seat keeps the legacy existence-only rule.
function mergeResynced(current: GameState, resynced: GameState, localSeat: number | null): GameState {
  const selectedHero =
    current.selectedHeroId != null ? resynced.heroes[current.selectedHeroId] : undefined;
  const selectedHeroId =
    selectedHero && (localSeat == null || selectedHero.ownerId === localSeat) ? current.selectedHeroId : null;
  const selectedSettlementId =
    current.selectedSettlementId != null && resynced.settlements[current.selectedSettlementId]
      ? current.selectedSettlementId
      : null;
  return { ...resynced, selectedHeroId, selectedSettlementId, dirty: true };
}

export function attachGarrisonEventBridge(deps: GarrisonEventBridgeDeps): () => void {
  // Deltas that landed while merging was unsafe (mid-battle, or the local
  // client driving an AI turn) queue here instead of dropping: they are
  // never re-delivered, so losing one desyncs garrison totals until the next
  // full resync. Retried on state:committed and on every new batch.
  let deferredDeltas: EngineEvent[] = [];
  let merging = false;

  const safeForDeltas = (): boolean => {
    const tc = deps.getController();
    if (!tc) return false;
    const phase = tc.getState().phase;
    if (blockedPhase(phase)) return false;
    if (phase.kind === "AI_TURN" && deps.isPrimaryActor()) return false;
    return true;
  };

  // A wholesale snapshot must additionally not land during the local seat's
  // own turn: it was fetched from the server before this turn's in-flight
  // optimistic commands may have persisted, and applying it would rewind
  // them. Turn boundaries reconcile instead.
  const safeForResync = (): boolean => {
    if (!safeForDeltas()) return false;
    const tc = deps.getController();
    if (!tc) return false;
    const seat = deps.localSeat();
    const state = tc.getState();
    if (seat !== null && state.phase.kind === "PLAYER_TURN" && state.activePlayerId === seat) {
      return false;
    }
    return true;
  };

  const runDeferredDeltas = async (): Promise<void> => {
    if (merging) return;
    merging = true;
    try {
      while (deferredDeltas.length > 0 && safeForDeltas()) {
        const batch = deferredDeltas;
        deferredDeltas = [];
        const tc = deps.getController();
        if (!tc) break;
        // Settle this client's own in-flight commands first, then re-check:
        // their optimistic results are already in the state the batch is
        // about to merge onto.
        await tc.flushPendingCommands();
        if (!safeForDeltas()) {
          deferredDeltas = [...batch, ...deferredDeltas];
          break;
        }
        const current = deps.getController();
        if (!current) break;
        const next = applyDeltas(current.getState(), batch);
        if (next) deps.replaceState(next);
      }
    } finally {
      merging = false;
    }
  };

  const onEventsApplied = (ev: MpEventsAppliedEvent): void => {
    const batch = ev.events.filter(isGarrisonDelta);
    if (batch.length === 0) return;
    deferredDeltas.push(...batch);
    void runDeferredDeltas();
  };

  const onCommitted = (): void => {
    void runDeferredDeltas();
  };

  // Resync snapshots are self-contained server truths, so only safety gates
  // apply -- a snapshot that lands while unsafe is dropped outright, never
  // queued: queueing would apply a stale fetch over newer local state later.
  const onResynced = (ev: MpResyncedEvent): void => {
    if (ev.reason !== "event_not_derivable") return;
    if (merging) return;
    if (!safeForResync()) return;
    void (async () => {
      merging = true;
      try {
        const tc = deps.getController();
        if (!tc) return;
        await tc.flushPendingCommands();
        if (!safeForResync()) return;
        const current = deps.getController();
        if (!current) return;
        deps.replaceState(mergeResynced(current.getState(), ev.state, deps.localSeat()));
      } finally {
        merging = false;
      }
    })();
  };

  bus.on("mp:eventsApplied", onEventsApplied);
  bus.on("mp:resynced", onResynced);
  bus.on("state:committed", onCommitted);
  return () => {
    bus.off("mp:eventsApplied", onEventsApplied);
    bus.off("mp:resynced", onResynced);
    bus.off("state:committed", onCommitted);
  };
}
