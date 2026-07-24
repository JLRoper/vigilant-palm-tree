import type { GameState, HeroId, SettlementId, TransferDirection, WarehouseResource, RecruitHeroResult, StartCharterPayload } from "./gameState";
import { bus } from "../core/eventBus";
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
  reorderStack as reorderStackReducer,
  detectAdjacentEnemy as detectAdjacentEnemyFn,
  transferGold as transferGoldReducer,
  tradeResources as tradeResourcesReducer,
  setAutoTrade as setAutoTradeReducer,
  recruitHero as recruitHeroReducer,
  startCharter as startCharterReducer,
  stepTravelCharter as stepTravelCharterReducer,
  cleanupDefeatedHeroCharters as cleanupDefeatedHeroChartersReducer,
} from "./gameState";
import { findPath } from "../map/pathfinding";
import { hexDistance } from "../core/hex";
import type { GameMap } from "../map/gameMap";
import { computeSettlementRates } from "../economy/settlementRates";
import { generateCitySpots } from "../core/citySpots";
import { cityViewSizeFor } from "../core/cityGrid";

export interface TurnControllerHooks {
  onHumanTurnEnd(state: GameState): Promise<GameState>;
  onAiMove(state: GameState, heroId: HeroId, toTile: { q: number; r: number }): Promise<void>;
  onBattleResolved(state: GameState): Promise<GameState>;
  pickAiMove(
    state: GameState,
    heroId: HeroId,
  ): { toTile: { q: number; r: number }; cost: number } | null;
  logEvent(event: { type: string; payload: Record<string, unknown> }): void;
  getMap(): GameMap;
  rng(): number;
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
    const hero = this.state.heroes[heroId];
    if (hero?.isChartering) return;
    this.state = selectHeroReducer(this.state, heroId);
    const updatedHero = this.state.heroes[heroId];
    if (updatedHero) {
      this.tryCaptureAt(heroId, updatedHero.q, updatedHero.r);
    }
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
    trailExtension?: { q: number; r: number }[],
  ): boolean {
    const result = startMoveReducer(this.state, heroId, toTile, cost, trailExtension);
    this.state = result.state;
    if (!result.ok) return false;
    const hero = this.state.heroes[heroId];
    bus.emit({ type: "hero:moved", heroId, from: { q: hero?.previousQ ?? hero?.q ?? 0, r: hero?.previousR ?? hero?.r ?? 0 }, to: toTile, playerId: hero?.ownerId ?? 0 });
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
    bus.emit({ type: "settlement:captured", heroId, settlementId });
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
    bus.emit({ type: "economy:goldChanged", entityId: heroId, entityType: "hero", amount: this.state.heroes[heroId]?.gold ?? 0 });
    bus.emit({ type: "economy:goldChanged", entityId: settlementId, entityType: "settlement", amount: this.state.settlements[settlementId]?.gold ?? 0 });
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
    bus.emit({ type: "economy:warehouseChanged", settlementId: fromId, resource, amount: this.state.settlements[fromId]?.warehouse?.[resource] ?? 0 });
    bus.emit({ type: "economy:warehouseChanged", settlementId: toId, resource, amount: this.state.settlements[toId]?.warehouse?.[resource] ?? 0 });
    this.hooks.logEvent({
      type: "resources_traded",
      payload: { fromId, toId, resource, amount },
    });
    return { ok: true, reason: "" };
  }

  reorderStack(
    heroId: HeroId,
    fromIdx: number,
    toIdx: number,
  ): { ok: boolean; reason: string } {
    const result = reorderStackReducer(this.state, heroId, fromIdx, toIdx);
    if (!result.ok) return { ok: false, reason: result.reason };
    this.state = result.state;
    this.hooks.logEvent({
      type: "stack_reordered",
      payload: { heroId, fromIdx, toIdx },
    });
    return { ok: true, reason: "" };
  }

  setAutoTrade(settlementId: SettlementId, autoTrade: boolean): boolean {
    const before = this.state.settlements[settlementId];
    if (!before) return false;
    if (before.ownerId !== this.state.activePlayerId) return false;
    const next = setAutoTradeReducer(this.state, settlementId, autoTrade);
    if (next === this.state) return false;
    this.state = next;
    this.hooks.logEvent({
      type: "auto_trade_toggled",
      payload: { settlementId, autoTrade },
    });
    return true;
  }

  recruitHero(heroName: string, settlementId: SettlementId): RecruitHeroResult {
    const result = recruitHeroReducer(this.state, this.state.activePlayerId, heroName, settlementId);
    if (result.hero) {
    this.state = result.state;
    this.hooks.logEvent({
        type: "hero_recruited",
        payload: { heroId: result.hero.id, name: heroName, playerId: this.state.activePlayerId },
      });
    }
    return result;
  }

  // =========================================================================
  // CHARTER SETTLEMENTS
  // =========================================================================

  startCharter(targetQ: number, targetR: number, settlementName: string): { ok: boolean; reason?: string } {
    const map = this.hooks.getMap();
    const rng = this.hooks.rng();
    const heroId = this.state.selectedHeroId;
    if (!heroId) return { ok: false, reason: "no_hero_selected" };
    const hero = this.state.heroes[heroId];
    if (!hero) return { ok: false, reason: "no_hero" };

    if (!map.isPassable(targetQ, targetR)) {
      return { ok: false, reason: "impassable_terrain" };
    }

    for (const s of Object.values(this.state.settlements)) {
      const dist = hexDistance({ q: targetQ, r: targetR }, { q: s.q, r: s.r });
      if (dist < 4) {
        return { ok: false, reason: "too_close_to_settlement" };
      }
    }

    const computed = computeSettlementRates(map, targetQ, targetR, 1);
    const size = cityViewSizeFor(1);
    const { spots } = generateCitySpots(size, () => rng);

    const payload: StartCharterPayload = {
      heroId,
      targetQ,
      targetR,
      settlementName,
      settlementId: `s${this.state.nextSettlementId}`,
      charterId: `ch${this.state.nextCharterId}`,
      resourceRates: computed.rates,
      foundedOnResource: computed.foundedOn,
      citySpots: spots,
    };

    const result = startCharterReducer(this.state, payload);
    this.state = result.state;
    if (!result.ok) return { ok: false, reason: result.reason };

    this.hooks.logEvent({
      type: "charter_started",
      payload: { heroId, targetQ, targetR, settlementName, charterId: payload.charterId },
    });

    this.advanceAutoTravel();
    return { ok: true };
  }

  advanceAutoTravel(): void {
    if (this.state.phase.kind !== "PLAYER_TURN") return;
    const playerId = this.state.activePlayerId;
    const map = this.hooks.getMap();
    let changed = true;

    while (changed) {
      changed = false;
      const charters = this.state.activeCharters.filter(
        (c) => c.ownerId === playerId && c.phase === "traveling",
      );
      for (const charter of charters) {
        const hero = this.state.heroes[charter.heroId];
        if (!hero || hero.movementRemaining <= 0) continue;

        if (hero.q === charter.targetQ && hero.r === charter.targetR) {
          const arrivedCharters = this.state.activeCharters.map((c) =>
            c.id === charter.id ? { ...c, phase: "constructing" as const } : c,
          );
          const arrivedHero = { ...hero, movementRemaining: 0 };
          this.state = {
            ...this.state,
            heroes: { ...this.state.heroes, [hero.id]: arrivedHero },
            activeCharters: arrivedCharters,
            dirty: true,
          };
          this.hooks.logEvent({
            type: "charter_arrived",
            payload: { heroId: hero.id, charterId: charter.id, targetQ: charter.targetQ, targetR: charter.targetR },
          });
          changed = true;
          continue;
        }

        const occupiedHexes = new Set<string>();
        for (const [id, other] of Object.entries(this.state.heroes)) {
          if (id !== hero.id) {
            occupiedHexes.add(`${other.q},${other.r}`);
          }
        }

        const path = findPath(map, { q: hero.q, r: hero.r }, { q: charter.targetQ, r: charter.targetR }, occupiedHexes);
        if (path.length === 0) continue;

        const nextStep = path[0];
        const cost = map.cost(nextStep.q, nextStep.r);
        if (!Number.isFinite(cost) || cost < 0) continue;

        const result = stepTravelCharterReducer(this.state, hero.id, nextStep.q, nextStep.r, cost);
        if (!result.ok) {
          this.hooks.logEvent({
            type: "charter_travel_blocked",
            payload: { heroId: hero.id, reason: result.reason },
          });
          continue;
        }
        this.state = result.state;
        bus.emit({ type: "hero:moved", heroId: hero.id, from: { q: hero.q, r: hero.r }, to: { q: nextStep.q, r: nextStep.r }, playerId: hero.ownerId });

        const updatedHero = this.state.heroes[hero.id];
        if (updatedHero) {
          const defenderId = detectAdjacentEnemyFn(this.state, hero.id);
          if (defenderId) {
            this.enterBattle(hero.id, defenderId);
            break;
          }
        }

        changed = true;
      }
    }
  }

  async resolveCurrentBattle(): Promise<void> {
    if (this.state.phase.kind !== "BATTLE") return;
    const { defenderId } = this.state.phase;
    const defender = this.state.heroes[defenderId];
    this.state = resolveBattleReducer(this.state);
    bus.emit({ type: "battle:resolved", attackerId: this.state.phase.kind === "BATTLE" ? this.state.phase.attackerId : "", defenderId, attackerSurvived: true });
    if (defender?.isChartering) {
      this.state = cleanupDefeatedHeroChartersReducer(this.state, defenderId);
    }
    const resolved = await this.hooks.onBattleResolved(this.state);
    this.state = resolved;
    this.hooks.logEvent({
      type: "battle_resolved",
      payload: {},
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
      bus.emit({ type: "turn:ended", playerId: endedPlayerId });
      const oldPhase = this.state.phase.kind;
      this.state = applyEndOfTurnReducer(this.state);
      this.state = endTurnReducer(this.state);
      const newPhase = this.state.phase.kind;
      if (oldPhase !== newPhase) {
        bus.emit({ type: "phase:changed", oldPhase, newPhase });
      }
      this.state = await this.hooks.onHumanTurnEnd(this.state);

      if (this.state.phase.kind === "PLAYER_TURN") {
        this.advanceAutoTravel();
      } else if (this.state.phase.kind === "AI_TURN") {
        bus.emit({ type: "phase:changed", oldPhase: "PLAYER_TURN", newPhase: "AI_TURN" });
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
        bus.emit({ type: "round:changed", round: this.state.round });
        bus.emit({ type: "day:changed", day: this.state.day });
        this.hooks.logEvent({
          type: "round_started",
          payload: { round: this.state.round },
        });
        this.advanceAutoTravel();
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
      if (hero.isChartering) continue;
      const move = this.hooks.pickAiMove(this.state, heroId);
      if (!move) continue;
      const map = this.hooks.getMap();
      const path = findPath(map, { q: hero.q, r: hero.r }, move.toTile);
      const result = startMoveReducer(this.state, heroId, move.toTile, move.cost, path);
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