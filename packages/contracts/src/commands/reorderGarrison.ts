import type { PlayerSeat, SettlementId } from "../ids";

// Swaps two of a settlement garrison's army-stack slots. The garrison's 8 slots
// are fixed battlefield positions (mirroring a hero's army), so reordering is a
// swap, not an insert. Same shape as ReorderStackCommand, which owns the hero
// side of the same rule.
export interface ReorderGarrisonCommand {
  kind: "ReorderGarrison";
  gameName: string;
  actor: PlayerSeat;
  settlementId: SettlementId;
  fromIdx: number;
  toIdx: number;
}
