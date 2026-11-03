import { bus } from "../../core/eventBus";
import type { MpBattleOutcomeEvent } from "../../core/events";

// The reader's card, half two. When the server force-resolves a battle this
// client is still fighting -- the fight went idle past
// AI_DEFENDER_WAIT_TIMEOUT_MS (server/app/aiDriver.ts) -- the client must
// notice, stop treating its own played-out fight as submittable, adopt the
// server's world and say so plainly. Before this module the client played on
// and POSTed SubmitBattleResult into the server's refusal
// (battle_not_pending), which surfaced as "Couldn't record this battle".
//
// The signal is the same one every other server-resolved battle arrives on:
// the BattleResolved row multiplayerSync fans out as `mp:battleOutcome` --
// emitted BEFORE the self/seat skips, so it reaches the very client whose
// fight it settles. Detection is deliberately narrow: same game, same pair,
// a hero battle, and an actor that is NOT this client's own seat (a row this
// client itself caused is its own result coming back, not a void).

export type HeroBattleResolvedPayload = Extract<MpBattleOutcomeEvent["payload"], { type: "BattleResolved" }>;

export interface WatchedBattle {
  gameName: string | null;
  attackerId: string;
  defenderId: string;
  /** The seat this client plays, or null when unknown (unclaimed seat). */
  localSeat: number | null;
}

/**
 * Did this event settle the very battle this client is fighting? Pure, so the
 * narrow rule above is testable without a bus or a DOM.
 */
export function isServerVoidOfWatchedBattle(
  ev: Pick<MpBattleOutcomeEvent, "gameName" | "kind" | "payload" | "actorSeat">,
  watched: WatchedBattle,
): boolean {
  if (watched.gameName === null || ev.gameName !== watched.gameName) return false;
  if (ev.kind !== "heroBattle") return false;
  const payload = ev.payload;
  if (payload.type !== "BattleResolved") return false;
  if (payload.attackerId !== watched.attackerId || payload.defenderId !== watched.defenderId) return false;
  // This client's own submission already landed: that event is the echo of a
  // battle that DID count, never a void.
  if (watched.localSeat !== null && ev.actorSeat === watched.localSeat) return false;
  return true;
}

export interface ServerVoidWatch {
  /** Already settled under this client, if it has happened. */
  voided(): boolean;
  /** The settling event's payload (the server's own outcome), once known. */
  payload(): HeroBattleResolvedPayload | null;
  /** The game_events row id that carried the void (null until it fires). */
  rowId(): string | null;
  /**
   * Resolves the moment the pair is settled server-side, so a caller racing
   * the arena's own outcome can stop waiting for a fight that can no longer
   * land. Never rejects; resolves exactly once.
   */
  whenVoided(): Promise<HeroBattleResolvedPayload>;
  /** Stop listening (the arena closed, or the battle ended normally). */
  detach(): void;
}

type Subscribe = (onEvent: (ev: MpBattleOutcomeEvent) => void) => () => void;

const defaultSubscribe: Subscribe = (onEvent) => {
  bus.on("mp:battleOutcome", onEvent);
  return () => bus.off("mp:battleOutcome", onEvent);
};

/**
 * Watches the battle-outcome stream for the server settling `watched`'s pair.
 * `subscribe` is a test seam; production uses the app bus.
 */
export function watchServerBattleVoid(
  watched: WatchedBattle,
  subscribe: Subscribe = defaultSubscribe,
): ServerVoidWatch {
  let settled: HeroBattleResolvedPayload | null = null;
  let settledRowId: string | null = null;
  let resolveWhenVoided: (payload: HeroBattleResolvedPayload) => void = () => {};
  const whenVoided = new Promise<HeroBattleResolvedPayload>((resolve) => {
    resolveWhenVoided = resolve;
  });

  const detach = subscribe((ev) => {
    if (settled !== null) return;
    if (!isServerVoidOfWatchedBattle(ev, watched)) return;
    settled = ev.payload as HeroBattleResolvedPayload;
    settledRowId = ev.id;
    resolveWhenVoided(settled);
  });

  return {
    voided: () => settled !== null,
    payload: () => settled,
    rowId: () => settledRowId,
    whenVoided: () => whenVoided,
    detach,
  };
}

// ---------------------------------------------------------------------------
// What the player is told. Kept here (not in the DOM module) so the wording a
// reader checks -- "plainly that the fight was voided" -- is unit-testable.

export const BATTLE_VOIDED_TITLE = "This fight was voided";

export function battleVoidedMessage(): string {
  return (
    "The server resolved this battle before your result arrived, so the fight you played was not " +
    "recorded — a battle that goes quiet for longer than the wait deadline is settled by the server " +
    "instead of waiting forever.\n\n" +
    "The map shows the server's outcome, not the one you played."
  );
}

/** The server's own verdict lines, in the shared wording. */
export async function battleVoidedOutcomeLines(
  payload: HeroBattleResolvedPayload | null | undefined,
  attackerLabel: string,
  defenderLabel: string,
): Promise<string[]> {
  if (!payload) return [];
  const { battleVerdictCardLine } = await import("./battleResultText");
  const lines: string[] = [];
  const attacker = battleVerdictCardLine(attackerLabel, payload.attackerVerdict);
  if (attacker) lines.push(`Server's result — ${attacker}`);
  const defender = battleVerdictCardLine(defenderLabel, payload.defenderVerdict);
  if (defender) lines.push(`Server's result — ${defender}`);
  return lines;
}
