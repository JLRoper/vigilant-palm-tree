import type { Axial } from "../geometry";
import type { HeroId, PlayerSeat, SettlementId } from "../ids";
import type { TransferDirection } from "../gameState";

// Named EngineEvent, not GameEvent -- src/core/events.ts already has an
// unrelated GameEvent (the client-side UI-event-bus payload union). See
// plan/2026-08-16-phase-3-parallel-dev-plan.md's naming-collision note.
export type EngineEvent =
  | { type: "HeroMoved"; actor: PlayerSeat; heroId: HeroId; to: Axial }
  | {
      type: "GoldTransferred";
      actor: PlayerSeat;
      heroId: HeroId;
      settlementId: SettlementId;
      direction: TransferDirection;
    };
