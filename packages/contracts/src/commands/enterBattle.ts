import type { HeroId, PlayerSeat } from "../ids";

// Server-offered battle (defender-chosen flow): an AI attacker has closed to
// a human defender and must NOT auto-resolve. Dispatched by the trusted
// in-process AI driver (never a browser client -- the command route rejects
// AI-seat actors on server-driven games), it records the pending pair in
// games.lobby.pendingBattle and appends BattleOffered so every client derives
// the BATTLE phase; the human defender then resolves via the existing
// ResolveBattle / SubmitBattleResult commands from their own seat.
export interface EnterBattleCommand {
  kind: "EnterBattle";
  gameName: string;
  actor: PlayerSeat;
  attackerId: HeroId;
  defenderId: HeroId;
}
