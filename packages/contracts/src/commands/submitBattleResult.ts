import type { HeroBattleVerdict } from "../events/engineEvent";
import type { HeroId, PlayerSeat } from "../ids";
import type { HeroState } from "../gameState";
import type { Platoon } from "../units";

// Manual-battle result submission (plan/2026-09-27-manual-battle-wiring.md,
// work item 4 — the 15th command kind). When a real hero collision is fought
// out in the manual arena instead of auto-resolved, the played-out outcome is
// sent here and the server applies it with the same post-battle rules the
// auto-resolver uses (defender death → gold capture + charter cleanup;
// survivor stacks restored; retreat/surrender cancel the attacker's move).
//
// Trust model (decision 4, locked 2026-09-27): v1 TRUSTS this client-computed
// result — LAN trust, cheat-able by a modified client and accepted. The
// server still validates everything it can cheaply (phase-equivalent
// adjacency, survivor shape against the unit catalog, surrender gold ≤ purse)
// and every arena action is streamed to the battle_actions table as it
// happens (work item 4b) so the future async legality-check consumer has the
// full record it needs to re-simulate and flag violations retroactively.
//
// `outcome` is the arena-level result, not the engine's per-side outcome
// pair — the server derives the BattleResolved event's winner/outcomes from
// it. "draw" (the arena's max-rounds stalemate) is deliberately included even
// though the plan's payload list named only four values: the arena can end
// without either side winning, and silently folding a stalemate into
// "attackerWon"/"defenderWon" would record a false victory (and loot gold on
// the wrong side). Same semantics as the auto-resolver's own stalemate
// branch: survivors kept, no loot, no move cancellation.
export type SubmittedBattleOutcome =
  | "attackerWon"
  | "defenderWon"
  | "retreat"
  | "surrender"
  | "draw";

export interface SubmitBattleResultCommand {
  kind: "SubmitBattleResult";
  gameName: string;
  // The seat whose client played the battle out — owns exactly one of the
  // two heroes (the arena only opens for that seat). The server resolves
  // "who conceded" on retreat/surrender from this, and the generic
  // active-player guard in commandHandler applies as for every command.
  actor: PlayerSeat;
  attackerId: HeroId;
  defenderId: HeroId;
  outcome: SubmittedBattleOutcome;
  // Survivor platoons per side, in the engine's attacker/defender role
  // space (the arena's finalizeManualBattle output). Retreat's 15% loss and
  // the surrender Leave-Behind strip are already applied to these by the
  // arena before submission.
  attackerStacks: Platoon[];
  defenderStacks: Platoon[];
  // Gold the human paid to surrender (0 when they used the Leave-Behind
  // path instead, absent on every other outcome). Server validates it
  // against the conceding hero's purse before deducting.
  surrenderedGold?: number;
  // Carried so the BattleResolved event can be emitted with real values on
  // every path — the event's payload requires both fields, and the plan's
  // determinism requirement ("record everything the future re-simulation
  // needs") wants the seed the arena actually used, not a zeroed placeholder.
  // obstacleSeed mirrors the battle_actions seed row (work item 4b seq 0).
  rounds: number;
  obstacleSeed: number;
}

// Post-battle hero pair for the manual-arena path (hero-outcomes plan W1).
// Both heroes are OPTIONAL: a defeated side's hero row is deleted (no
// respawn/teleport), and only surviving heroes come back. Verdicts carry the
// retreat/surrender discrimination the arena knows from `outcome` but the
// engine's retreated_hero outcome does not.
export interface SubmitBattleResultResult {
  attackerHero?: HeroState;
  defenderHero?: HeroState;
  attackerVerdict?: HeroBattleVerdict;
  defenderVerdict?: HeroBattleVerdict;
}
