import type { PlayerSeat, SettlementId } from "../ids";

// One command for both directions of the bank pot interaction (the designer
// asked for a single pot interaction, not two commands). Bare interface, like
// every other member of the Command union: there is no validate function in
// contracts -- server/http/routes/commands.ts's parseCommand is the wire-shape
// gate and @heroes/engine's depositIntoBank/requestBankWithdrawal own the
// semantics. `direction: "deposit"` moves settlement treasury -> pot;
// `"withdraw"` starts the 7-day countdown out of the pot (the money leaves the
// pot immediately and matures into the treasury on state.day + 7).
export interface BankGoldCommand {
  kind: "BankGold";
  gameName: string;
  actor: PlayerSeat;
  settlementId: SettlementId;
  gx: number;
  gy: number;
  amount: number;
  direction: "deposit" | "withdraw";
}