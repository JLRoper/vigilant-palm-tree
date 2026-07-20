import type { GameState, HeroId } from "./gameState";
import {
  selectHero as selectHeroReducer,
  clearSelection as clearSelectionReducer,
  startMove as startMoveReducer,
  cancelMove as cancelMoveReducer,
  startBattle as startBattleReducer,
  resolveBattle as resolveBattleReducer,
  endTurn as endTurnReducer,
  applyEndOfTurn as applyEndOfTurnReducer,
  advanceRound as advanceRoundReducer,
  detectAdjacentEnemy as detectAdjacentEnemyFn,
} from "./gameState";

export interface TurnControllerHooks {
  onHumanTurnEnd(state: GameState): Promise<GameState>;
  onAiMove(state: GameState, heroId: HeroId, toTile: { q: number; r: number }): Promise<void>;
  onBattleResolved(state: GameState): Promise<GameState>;
  pickAiMove(
    state: GameState,
    heroId: HeroId,
  ): { toTile: { q: number; r: number }; cost: number } | null;
  logEvent(event: { type: string; payload: Record<string, unknown> }): void;
}

export class TurnController {
  private state: GameState;
  private readonly hooks: TurnControllerHooks;
  private aiAwaitingPersist = false;
  private aiEnding = false;

  constructor(initial: GameState, hooks: TurnControllerHooks) {
    this.state = initial;
    this.hooks = hooks;
  }

  getState(): GameState {
    return this.state;
  }

  selectHero(heroId: HeroId): void {
    if (this.state.phase.kind !== "PLAYER_TURN") return;
    this.state = selectHeroReducer(this.state, heroId);
  }

  clearSelection(): void {
    this.state = clearSelectionReducer(this.state);
  }

  requestMove(
    heroId: HeroId,
    toTile: { q: number; r: number },
    cost: number,
  ): boolean {
    const result = startMoveReducer(this.state, heroId, toTile, cost);
    this.state = result.state;
    if (!result.ok) return false;
    this.hooks.logEvent({
      type: "move_completed",
      payload: { heroId, to: toTile, cost },
    });
    const defenderId = detectAdjacentEnemyFn(this.state, heroId);
    if (defenderId) {
      this.enterBattle(heroId, defenderId);
    }
    return true;
  }

  cancelMove(heroId: HeroId): void {
    this.state = cancelMoveReducer(this.state, heroId);
  }

  enterBattle(attackerId: HeroId, defenderId: HeroId): void {
    this.state = startBattleReducer(this.state, attackerId, defenderId);
    this.hooks.logEvent({
      type: "battle_started",
      payload: { attackerId, defenderId },
    });
  }

  async resolveCurrentBattle(): Promise<void> {
    if (this.state.phase.kind !== "BATTLE") return;
    this.state = resolveBattleReducer(this.state);
    const resolved = await this.hooks.onBattleResolved(this.state);
    this.state = resolved;
    this.hooks.logEvent({
      type: "battle_resolved",
      payload: { attackerId: this.state.phase.kind === "BATTLE" ? null : null },
    });
  }

  async endHumanTurn(): Promise<void> {
    await this.endCurrentTurn();
  }

  private async endCurrentTurn(): Promise<void> {
    if (this.aiEnding) return;
    this.aiEnding = true;
    try {
      const endedPlayerId = this.state.activePlayerId;
      this.hooks.logEvent({
        type: "turn_ended",
        payload: { playerId: endedPlayerId, round: this.state.round },
      });
      this.state = applyEndOfTurnReducer(this.state);
      this.state = endTurnReducer(this.state);
      this.state = await this.hooks.onHumanTurnEnd(this.state);

      if (this.state.phase.kind === "AI_TURN") {
        this.hooks.logEvent({
          type: "ai_turn_started",
          payload: { playerId: this.state.activePlayerId, round: this.state.round },
        });
      } else if (this.state.phase.kind === "ROUND_END") {
        const endedRound = this.state.round;
        this.hooks.logEvent({
          type: "round_ended",
          payload: { round: endedRound },
        });
        this.state = advanceRoundReducer(this.state);
        this.hooks.logEvent({
          type: "round_started",
          payload: { round: this.state.round },
        });
      }
    } finally {
      this.aiEnding = false;
    }
  }

  tick(_dtMs: number): void {
    if (this.state.phase.kind !== "AI_TURN") return;
    if (this.aiAwaitingPersist || this.aiEnding) return;

    const aiPlayerId = this.state.activePlayerId;
    const aiPlayer = this.state.players.find((p) => p.id === aiPlayerId);
    if (!aiPlayer) return;

    let moved = false;
    for (const heroId of aiPlayer.heroIds) {
      const hero = this.state.heroes[heroId];
      if (!hero || hero.movementRemaining <= 0) continue;
      const move = this.hooks.pickAiMove(this.state, heroId);
      if (!move) continue;
      const result = startMoveReducer(this.state, heroId, move.toTile, move.cost);
      if (!result.ok) continue;
      this.state = result.state;
      moved = true;
      this.hooks.logEvent({
        type: "move_completed",
        payload: { heroId, to: move.toTile, cost: move.cost },
      });
      this.aiAwaitingPersist = true;
      void this.hooks.onAiMove(this.state, heroId, move.toTile).finally(() => {
        this.aiAwaitingPersist = false;
      });
      break;
    }

    if (!moved) {
      void this.endCurrentTurn();
    }
  }
}
