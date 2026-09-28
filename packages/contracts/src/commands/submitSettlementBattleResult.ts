import type { HeroId, PlayerSeat, SettlementId } from "../ids";
import type { Platoon } from "../units";

// Settlement-garrison battle result submission, mirroring SubmitBattleResult
// command-for-command (plan/1790560842471-unit-recruitment-garrison-plan.md §1):
// the attacker hero played the garrison out in the manual arena, and the
// played-out outcome is sent here for server application (attackerWon →
// capture with the garrison emptied; every other outcome bounces the
// attacker's move with garrison survivors persisting). Same v1 trust model
// as SubmitBattleResult — see that file's header for the full rationale.
export type SubmittedSettlementBattleOutcome =
  | "attackerWon"
  | "defenderWon"
  | "draw"
  | "retreat"
  | "surrender";

export interface SubmitSettlementBattleResultCommand {
  kind: "SubmitSettlementBattleResult";
  gameName: string;
  actor: PlayerSeat;
  attackerId: HeroId;
  settlementId: SettlementId;
  outcome: SubmittedSettlementBattleOutcome;
  attackerStacks: Platoon[];
  defenderStacks: Platoon[];
  surrenderedGold?: number;
  rounds: number;
  obstacleSeed: number;
}
