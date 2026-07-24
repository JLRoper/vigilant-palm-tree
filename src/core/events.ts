import type { Axial } from "./hex";
import type { HeroId, SettlementId } from "../state/gameState";

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
  | { type: "calc:heroSpeed"; heroId: HeroId; baseSpeed: number; speed: number };
