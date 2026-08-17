import type { PlayerSeat, SettlementId } from "../ids";

// Discriminated-union command for toggling a settlement's auto-trade flag
// (plan/2026-08-16-phase-3-parallel-dev-plan.md, Track 3.A Week 3+ --
// "the simplest of all... functions" per this port's own audit).
// @heroes/engine's setAutoTrade() never checks ownership itself; that
// currently lives only in src/state/turnController.ts's client-side
// caller, not the engine or any server route -- commandHandler.ts's new
// case re-adds it explicitly, the same way it does for every other
// command whose engine function doesn't check actor ownership on its own.
export interface SetAutoTradeCommand {
  kind: "SetAutoTrade";
  gameName: string;
  actor: PlayerSeat;
  settlementId: SettlementId;
  autoTrade: boolean;
}
