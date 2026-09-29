import type { Axial } from "../geometry";
import type { CharterId, HeroId, HorseVariantId, PlayerSeat, SettlementId } from "../ids";
import type { TransferDirection } from "../gameState";
import type { WarehouseResource } from "../resources";

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
    }
  | {
      type: "TurnEnded";
      actor: PlayerSeat;
      round: number;
      day: number;
      activePlayerId: number;
      wrapped: boolean;
    }
  | {
      type: "ResourcesTraded";
      actor: PlayerSeat;
      fromSettlementId: SettlementId;
      toSettlementId: SettlementId;
      resource: WarehouseResource;
      amount: number;
    }
  | {
      type: "BattleResolved";
      actor: PlayerSeat;
      attackerId: HeroId;
      defenderId: HeroId;
      winner: "attacker" | "defender" | "draw";
      // @heroes/engine's CombatantOutcome (packages/engine/src/combat/types.ts)
      // inlined as its own literal union rather than imported -- contracts
      // is a zero-dependency leaf and cannot import from @heroes/engine (see
      // this file's own header comment / packages/contracts/src/index.ts).
      attackerOutcome: "won" | "lost_all_troops" | "retreated_self" | "retreated_hero" | "survived";
      defenderOutcome: "won" | "lost_all_troops" | "retreated_self" | "retreated_hero" | "survived";
      rewardGold: number;
      rounds: number;
      // Persisted here so a battle can be replayed later -- the old
      // /resolve-battle route computed this per-call but never persisted
      // it anywhere (plan/2026-08-16-phase-3-parallel-dev-plan.md's own
      // "replaying this battle later would not reproduce the same
      // obstacle layout" callout).
      obstacleSeed: number;
    }
  | {
      type: "HeroRecruited";
      actor: PlayerSeat;
      heroId: HeroId;
      name: string;
      settlementId: SettlementId;
      horseVariant: HorseVariantId;
    }
  | {
      type: "TownHallUpgradeStarted";
      actor: PlayerSeat;
      settlementId: SettlementId;
      targetLevel: 2 | 3;
    }
  | {
      type: "AutoTradeToggled";
      actor: PlayerSeat;
      settlementId: SettlementId;
      autoTrade: boolean;
    }
  | {
      type: "StackReordered";
      actor: PlayerSeat;
      heroId: HeroId;
      fromIdx: number;
      toIdx: number;
    }
  | {
      type: "SettlementCaptured";
      actor: PlayerSeat;
      heroId: HeroId;
      settlementId: SettlementId;
      previousOwnerId: number | null;
    }
  | {
      type: "CharterStarted";
      actor: PlayerSeat;
      heroId: HeroId;
      charterId: CharterId;
      settlementId: SettlementId;
      targetQ: number;
      targetR: number;
    }
  | {
      type: "BuildingUpgradeStarted";
      actor: PlayerSeat;
      settlementId: SettlementId;
    }
  | {
      type: "SettlementUpgradeStarted";
      actor: PlayerSeat;
      settlementId: SettlementId;
      targetLevel: 2 | 3;
    }
    | {
        // #152: one hex-step of a charter's auto-travel, mirroring HeroMoved's
        // shape exactly (same `to`-only payload, same reasoning: movement
        // cost/whether-arrived isn't carried here, TurnEnded remains the
        // resync boundary that re-syncs anything this event's replay drifts).
        type: "CharterTravelAdvanced";
        actor: PlayerSeat;
        heroId: HeroId;
        charterId: CharterId;
        to: Axial;
      }
    | {
        // The city view's PlaceBuildings command committing its working
        // cart (palette placements + destroy-mode removals). Payload is
        // intentionally minimal: remote seats re-sync the full buildings
        // array via the same TurnEnded/poll resync boundary everything
        // else uses -- entityMirror's handler for this is a documented
        // no-op until the event carries per-building data worth applying.
        type: "BuildingsPlaced";
        actor: PlayerSeat;
        settlementId: SettlementId;
      }
    | {
        // Hero cargo load/unload at a same-hex owned settlement. Amounts
        // ride the TurnEnded resync boundary, like BuildingsPlaced.
        type: "ResourcesTransferred";
        actor: PlayerSeat;
        heroId: HeroId;
        settlementId: SettlementId;
        direction: "load" | "unload";
      }
    | {
        type: "WagonsAssigned";
        actor: PlayerSeat;
        heroId: HeroId;
        delta: number;
      }
    | {
        type: "WagonsBought";
        actor: PlayerSeat;
        settlementId: SettlementId;
        count: number;
      }
    | {
        type: "TradeRouteCreated";
        actor: PlayerSeat;
        routeId: string;
        fromSettlementId: SettlementId;
        toSettlementId: SettlementId;
        resource: WarehouseResource;
        wagons: number;
      }
    | {
        type: "TradeRouteUpdated";
        actor: PlayerSeat;
        routeId: string;
      }
    | {
        type: "TradeRouteRemoved";
        actor: PlayerSeat;
        routeId: string;
      }
    | {
        type: "UnitsRecruited";
        actor: PlayerSeat;
        settlementId: SettlementId;
        unitTypeId: string;
        count: number;
      }
    | {
        type: "UnitsTransferred";
        actor: PlayerSeat;
        heroId: HeroId;
        settlementId: SettlementId;
        direction: "toHero" | "toGarrison";
        unitTypeId: string;
        count: number;
      }
    | {
        type: "SettlementBattleResolved";
        actor: PlayerSeat;
        attackerId: HeroId;
        settlementId: SettlementId;
        winner: "attacker" | "defender";
        captured: boolean;
      };
