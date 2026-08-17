import type { Axial, HeroId, SettlementId } from "@heroes/contracts";

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
  // (onTradeResources/onHumanMove/etc. -- see src/state/turnController.ts's
  // TurnControllerHooks) rejects. `action` is a short human label for what
  // was attempted ("Move hero", "Trade resources", ...); `reason` is the
  // server's own error code/message where available (see src/io/commands.ts's
  // CommandError), otherwise the raw failure text. Consumed by
  // src/screens/shared/toast.ts to give the player a visible notification
  // instead of the previous console.warn-only silence.
  | { type: "command:rejected"; action: string; reason: string };
