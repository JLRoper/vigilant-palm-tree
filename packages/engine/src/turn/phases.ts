import type { GamePhase, GameState, HeroId } from "@heroes/contracts";

export function startBattle(state: GameState, attackerId: HeroId, defenderId: HeroId): GameState {
  if (state.phase.kind === "BATTLE") return state;
  return {
    ...state,
    phase: { kind: "BATTLE", attackerId, defenderId },
    selectedHeroId: null,
    selectedSettlementId: null,
  };
}

// The actual combat resolution (stat comparison, counters, retreat) is
// server-authoritative — see POST /games/:name/commands (kind: "ResolveBattle")
// and packages/engine/src/combat/resolveBattle.ts — because it needs the
// DB-backed unit-type catalog. This just closes out the local BATTLE phase
// once the caller has the server's result in hand; heroes/players are
// merged in separately.
export function endBattlePhase(state: GameState): GameState {
  if (state.phase.kind !== "BATTLE") return state;
  return {
    ...state,
    phase: { kind: "PLAYER_TURN", playerId: state.activePlayerId },
    dirty: true,
  };
}

export function endTurn(state: GameState): GameState {
  const currentIdx = state.players.findIndex((p) => p.id === state.activePlayerId);
  if (currentIdx < 0) return state;
  const isLast = currentIdx === state.players.length - 1;
  if (isLast) {
    return {
      ...state,
      phase: { kind: "ROUND_END", nextRound: state.round + 1 },
      selectedHeroId: null,
      selectedSettlementId: null,
    };
  }
  const nextPlayer = state.players[currentIdx + 1];
  const newPhase: GamePhase =
    nextPlayer.faction === "ai"
      ? { kind: "AI_TURN", playerId: nextPlayer.id }
      : { kind: "PLAYER_TURN", playerId: nextPlayer.id };
  return {
    ...state,
    activePlayerId: nextPlayer.id,
    phase: newPhase,
    selectedHeroId: null,
    selectedSettlementId: null,
  };
}

export function canEndTurn(state: GameState): boolean {
  if (state.phase.kind !== "PLAYER_TURN") return false;
  const phase = state.phase;
  const p = state.players.find((pl) => pl.id === phase.playerId);
  return p?.faction === "player";
}
