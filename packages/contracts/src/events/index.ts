// EngineEvent -- server-authoritative game events appended to game_events
// after a command commits. Named EngineEvent (not GameEvent) to avoid
// colliding with src/core/events.ts's unrelated client-side UI-event-bus
// GameEvent union.
import type { HeroId, SettlementId } from "../ids";
import type { TransferDirection } from "../gameState";

export interface MoveCompletedEvent {
  kind: "move_completed";
  heroId: HeroId;
  fromTile: { q: number; r: number };
  toTile: { q: number; r: number };
  cost: number;
}

export interface TransferGoldEvent {
  kind: "transfer_gold";
  heroId: HeroId;
  settlementId: SettlementId;
  direction: TransferDirection;
  amount: number;
}

export type EngineEvent = MoveCompletedEvent | TransferGoldEvent;
