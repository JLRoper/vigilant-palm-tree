import type { GameState, HeroId, SettlementId, TransferDirection, WarehouseResource } from "./gameState";
import {
  selectHero as selectHeroReducer,
  selectSettlement as selectSettlementReducer,
  clearSelection as clearSelectionReducer,
  clearSettlementSelection as clearSettlementSelectionReducer,
  startMove as startMoveReducer,
  cancelMove as cancelMoveReducer,
  captureSettlement as captureSettlementReducer,
  startBattle as startBattleReducer,
  resolveBattle as resolveBattleReducer,
  endTurn as endTurnReducer,
  applyEndOfTurn as applyEndOfTurnReducer,
  advanceRound as advanceRoundReducer,
  detectAdjacentEnemy as detectAdjacentEnemyFn,
  transferGold as transferGoldReducer,
  tradeResources as tradeResourcesReducer,
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

  selectSettlement(settlementId: SettlementId): void {
    this.state = selectSettlementReducer(this.state, settlementId);
  }

  clearSettlementSelection(): void {
    this.state = clearSettlementSelectionReducer(this.state);
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
    this.tryCaptureAt(heroId, toTile.q, toTile.r);
    const defenderId = detectAdjacentEnemyFn(this.state, heroId);
    if (defenderId) {
      this.enterBattle(heroId, defenderId);
    }
    return true;
  }

  private tryCaptureAt(heroId: HeroId, q: number, r: number): void {
    for (const [sid, s] of Object.entries(this.state.settlements)) {
      if (s.q === q && s.r === r && s.ownerId !== this.state.heroes[heroId]?.ownerId) {
        this.captureSettlement(heroId, sid);
        return;
      }
    }
  }

  cancelMove(heroId: HeroId): void {
    this.state = cancelMoveReducer(this.state, heroId);
  }

  captureSettlement(heroId: HeroId, settlementId: SettlementId): boolean {
    const result = captureSettlementReducer(this.state, heroId, settlementId);
    if (!result.captured) return false;
    this.state = result.state;
    this.hooks.logEvent({
      type: "settlement_captured",
      payload: {
        heroId,
        settlementId,
        newOwnerId: this.state.heroes[heroId]?.ownerId,
        previousOwnerId: result.previousOwnerId,
      },
    });
    return true;
  }

  enterBattle(attackerId: HeroId, defenderId: HeroId): void {
    this.state = startBattleReducer(this.state, attackerId, defenderId);
    this.hooks.logEvent({
      type: "battle_started",
      payload: { attackerId, defenderId },
    });
  }

  transferGold(
    heroId: HeroId,
    settlementId: SettlementId,
    direction: TransferDirection,
  ): { ok: boolean; reason: string } {
    const result = transferGoldReducer(this.state, heroId, settlementId, direction);
    if (!result.ok) return { ok: false, reason: result.reason };
    const amount =
      direction === "deposit"
        ? this.state.heroes[heroId]?.gold ?? 0
        : this.state.settlements[settlementId]?.gold ?? 0;
    this.state = result.state;
    this.hooks.logEvent({
      type: "transfer_gold",
      payload: { heroId, settlementId, direction, amount },
    });
    return { ok: true, reason: "" };
  }

  tradeResources(
    fromId: SettlementId,
    toId: SettlementId,
    resource: WarehouseResource,
    amount: number,
  ): { ok: boolean; reason: string } {
    const result = tradeResourcesReducer(this.state, fromId, toId, resource, amount);
    if (!result.ok) return { ok: false, reason: result.reason };
    this.state = result.state;
    this.hooks.logEvent({
      type: "resources_traded",
      payload: { fromId, toId, resource, amount },
    });
    return { ok: true, reason: "" };
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
      this.tryCaptureAt(heroId, move.toTile.q, move.toTile.r);
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
