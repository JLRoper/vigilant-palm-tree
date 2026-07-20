import { api, endTurn, spendMovement, resolveBattle } from "../io/api";
import type { GameState, HeroId } from "../state/gameState";
import type { TurnControllerHooks } from "../state/turnController";
import { pickAiMove as pickAiMoveBrain } from "../ai/aiBrain";
import type { GameMap } from "../map/gameMap";
import type { Axial } from "../core/hex";

export interface BuildTurnHooksOptions {
  gameName: () => string | null;
  gameMap: () => GameMap;
  rng: () => number;
  logToConsole?: boolean;
}

let lastBattle: { attackerId: HeroId; defenderId: HeroId } | null = null;

export function buildTurnHooks(opts: BuildTurnHooksOptions): TurnControllerHooks {
  return {
    onHumanTurnEnd: async (state: GameState): Promise<GameState> => {
      const name = opts.gameName();
      if (!name) return state;
      try {
        const endingPlayerId = computeEndingPlayerId(state);
        const payload: GameState = { ...state, activePlayerId: endingPlayerId };
        const result = await endTurn(name, payload);
        return mergeFromEndTurn(state, result);
      } catch (e) {
        console.warn("[turnHooks] endTurn failed:", e);
        return state;
      }
    },
    onAiMove: async (state: GameState, heroId: HeroId, toTile: Axial): Promise<void> => {
      const name = opts.gameName();
      if (!name) return;
      const hero = state.heroes[heroId];
      if (!hero) return;
      try {
        const previousCost = (hero.previousMovementRemaining ?? hero.movementRemaining) - hero.movementRemaining;
        await spendMovement(name, {
          heroId,
          fromTile: { q: hero.q, r: hero.r },
          toTile,
          cost: previousCost > 0 ? previousCost : 1,
          settlements: state.settlements,
        });
      } catch (e) {
        console.warn("[turnHooks] spendMovement failed:", e);
      }
    },
    onBattleResolved: async (state: GameState): Promise<GameState> => {
      const cached = lastBattle;
      lastBattle = null;
      const name = opts.gameName();
      if (!name || !cached) return state;
      try {
        const result = await resolveBattle(name, {
          attackerId: cached.attackerId,
          defenderId: cached.defenderId,
          state,
        });
        return {
          ...state,
          players: result.players,
          heroes: result.heroes,
        };
      } catch (e) {
        console.warn("[turnHooks] resolveBattle failed:", e);
        return state;
      }
    },
    pickAiMove: (state: GameState, heroId: HeroId) => {
      return pickAiMoveBrain(state, heroId, opts.gameMap(), opts.rng);
    },
    logEvent: (event: { type: string; payload: Record<string, unknown> }) => {
      const name = opts.gameName();
      if (opts.logToConsole ?? true) {
        console.log(`[game] ${event.type}`, event.payload);
      }
      if (event.type === "battle_started") {
        const payload = event.payload as { attackerId?: HeroId; defenderId?: HeroId };
        if (payload.attackerId && payload.defenderId) {
          lastBattle = { attackerId: payload.attackerId, defenderId: payload.defenderId };
        }
      }
      if (!name) return;
      void api.logEvent(name, event.type, event.payload).catch(() => {});
    },
  };
}

function mergeFromEndTurn(
  state: GameState,
  result: { round: number; activePlayerId: number; players: GameState["players"] }
): GameState {
  const advanced = result.round > state.round;
  const nextPhase: GameState["phase"] = advanced
    ? { kind: "PLAYER_TURN", playerId: result.activePlayerId }
    : state.phase;
  return {
    ...state,
    round: result.round,
    activePlayerId: result.activePlayerId,
    players: result.players,
    phase: nextPhase,
  };
}

function computeEndingPlayerId(state: GameState): number {
  if (state.phase.kind === "ROUND_END") {
    return state.activePlayerId;
  }
  const ids = state.players.map((p) => p.id);
  const idx = ids.indexOf(state.activePlayerId);
  if (idx < 0) return state.activePlayerId;
  const prevIdx = (idx - 1 + ids.length) % ids.length;
  return ids[prevIdx];
}
