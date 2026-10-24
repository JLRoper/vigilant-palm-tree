import type { PlayerSeat, SettlementId } from "../ids";

// Sends one Construction Worker of the origin settlement's own founding
// faction walking alone toward another settlement (faction-construction
// plan, section 6). The "merged into a hero's platoon" transport mode
// needs no new command -- it already works through TransferUnits.
export interface StartWorkerTransitCommand {
  kind: "StartWorkerTransit";
  gameName: string;
  actor: PlayerSeat;
  originSettlementId: SettlementId;
  destinationSettlementId: SettlementId;
  /** "Build roads along the way" (section 7): costs gold per tile and halves movement speed while active. */
  buildRoads?: boolean;
}
