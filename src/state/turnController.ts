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
  endBattlePhase as endBattlePhaseReducer,
  reorderStack as reorderStackReducer,
  detectAdjacentEnemy as detectAdjacentEnemyFn,
  transferGold as transferGoldReducer,
  tradeResources as tradeResourcesReducer,
  setAutoTrade as setAutoTradeReducer,
  recruitHero as recruitHeroReducer,
  startCharter as startCharterReducer,
  stepTravelCharter as stepTravelCharterReducer,
  cleanupDefeatedHeroCharters as cleanupDefeatedHeroChartersReducer,
  startTownHallUpgrade as startTownHallUpgradeReducer,
  startSettlementUpgrade as startSettlementUpgradeReducer,
  startBuildingUpgrade as startBuildingUpgradeReducer,
  type BuildingUpgradeRequest,
} from "./gameState";
import { findPath } from "../map/pathfinding";
import { hexDistance } from "../core/hex";
import { platoonsHaveTroops } from "./units";
import type { GameMap } from "../map/gameMap";
import { computeSettlementRates, generateCitySpots, cityViewSizeFor } from "@heroes/engine";
import { settings, type HorseVariant } from "./settings";
import type { BattleResult } from "@heroes/engine";

export interface TurnControllerHooks {
  onHumanTurnEnd(state: GameState): Promise<GameState>;
  onAiMove(state: GameState, heroId: HeroId, toTile: { q: number; r: number }): Promise<void>;
  onHumanMove(
    state: GameState,
    heroId: HeroId,
    toTile: { q: number; r: number },
    cost: number,
  ): Promise<void>;
  onBattleResolved(state: GameState): Promise<{ state: GameState; battle: BattleResult | null }>;
  pickAiMove(
    state: GameState,
    heroId: HeroId,
  ): { toTile: { q: number; r: number }; cost: number } | null;
  logEvent(event: { type: string; payload: Record<string, unknown> }): void;
  getMap(): GameMap;
  rng(): number;
  // Week 3+ ports (plan/2026-08-16-phase-3-parallel-dev-plan.md): unlike
  // onHumanTurnEnd/onBattleResolved (awaited -- the server's response IS
  // the new state), these six are fired-and-forgotten the same way
  // onAiMove already is. The local @heroes/engine reducer call already
  // ran and this.state is already updated by the time these are called;
  // they exist purely so the mutation also persists server-side (closing
  // exactly the gap this port's PR description documents: any of these
  // actions performed between commands were previously invisible to
  // EndTurn's authoritative pipeline and got silently reverted by the
  // next mergeFromEndTurn). Callers don't await the returned promise or
  // use its resolved value -- same "client trusts its own local
  // computation, eventual consistency via sync" philosophy as onAiMove.
  onTradeResources(
    actor: number,
    fromSettlementId: SettlementId,
    toSettlementId: SettlementId,
    resource: WarehouseResource,
    amount: number,
  ): Promise<void>;
  onRecruitHero(
    actor: number,
    heroName: string,
    settlementId: SettlementId,
    horseVariant: HorseVariant,
  ): Promise<void>;
  onUpgradeTownHall(actor: number, settlementId: SettlementId, targetLevel: 2 | 3): Promise<void>;
  onSetAutoTrade(actor: number, settlementId: SettlementId, autoTrade: boolean): Promise<void>;
  onReorderStack(actor: number, heroId: HeroId, fromIdx: number, toIdx: number): Promise<void>;
  onCaptureSettlement(actor: number, heroId: HeroId, settlementId: SettlementId): Promise<void>;
  onTransferGold(
    actor: number,
    heroId: HeroId,
    settlementId: SettlementId,
    direction: TransferDirection,
  ): Promise<void>;
  onStartCharter(
    actor: number,
    heroId: HeroId,
    targetQ: number,
    targetR: number,
    settlementName: string,
  ): Promise<void>;
  // plan/2026-08-17-issue-88-remaining-command-ports.md Tracks 1/2: same
  // fire-and-forget shape as the rest of this block.
  onUpgradeBuilding(actor: number, settlementId: SettlementId, requests: BuildingUpgradeRequest[]): Promise<void>;
  onUpgradeSettlement(actor: number, settlementId: SettlementId, upgradePopulationGate: number): Promise<void>;
}

export class TurnController {
  private state: GameState;
  private readonly hooks: TurnControllerHooks;
  private aiAwaitingPersist = false;
  private aiEnding = false;
  // #114 / plan/2026-08-17-issue-88-remaining-command-ports.md §"Race-avoidance
  // requirement": the fire-and-forget hook calls below (onRecruitHero,
  // onUpgradeTownHall, etc.) have no barrier against End Turn racing ahead of
  // them -- act, then immediately end turn, and the server can hydrate
  // EndTurn's response from a row that doesn't yet reflect the still-in-flight
  // mutation, silently discarding it. trackCommand registers each hook
  // promise here; endCurrentTurn() drains this set before calling
  // onHumanTurnEnd so a command already in flight is guaranteed to land
  // server-side first.
  private readonly pendingCommands = new Set<Promise<void>>();

  constructor(initial: GameState, hooks: TurnControllerHooks) {
    this.state = initial;
    this.hooks = hooks;
  }

  getState(): GameState {
    return this.state;
  }

  private trackCommand(promise: Promise<void>, label: string): void {
    const tracked = promise.catch((e) => {
      console.warn(`[turnController] ${label} failed:`, e);
    });
    this.pendingCommands.add(tracked);
    void tracked.finally(() => this.pendingCommands.delete(tracked));
  }

  private async drainPendingCommands(): Promise<void> {
    await Promise.all(this.pendingCommands);
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
    this.trackCommand(this.hooks.onHumanMove(this.state, heroId, toTile, cost), "onHumanMove");
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
    const actor = this.state.heroes[heroId]?.ownerId ?? this.state.activePlayerId;
    this.trackCommand(this.hooks.onCaptureSettlement(actor, heroId, settlementId), "onCaptureSettlement");
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
    const actor = this.state.heroes[heroId]?.ownerId ?? this.state.activePlayerId;
    this.trackCommand(this.hooks.onTransferGold(actor, heroId, settlementId, direction), "onTransferGold");
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
    this.trackCommand(
      this.hooks.onTradeResources(this.state.activePlayerId, fromId, toId, resource, amount),
      "onTradeResources",
    );
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
    const actor = this.state.heroes[heroId]?.ownerId ?? this.state.activePlayerId;
    this.trackCommand(this.hooks.onReorderStack(actor, heroId, fromIdx, toIdx), "onReorderStack");
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
    this.trackCommand(
      this.hooks.onSetAutoTrade(this.state.activePlayerId, settlementId, autoTrade),
      "onSetAutoTrade",
    );
    return true;
  }

  recruitHero(heroName: string, settlementId: SettlementId, horseVariant: HorseVariant): RecruitHeroResult {
    const result = recruitHeroReducer(this.state, this.state.activePlayerId, heroName, settlementId, horseVariant);
    if (result.hero) {
    this.state = result.state;
    this.hooks.logEvent({
        type: "hero_recruited",
        payload: { heroId: result.hero.id, name: heroName, playerId: this.state.activePlayerId },
      });
      this.trackCommand(
        this.hooks.onRecruitHero(this.state.activePlayerId, heroName, settlementId, horseVariant),
        "onRecruitHero",
      );
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

    this.trackCommand(
      this.hooks.onStartCharter(this.state.activePlayerId, heroId, targetQ, targetR, settlementName),
      "onStartCharter",
    );

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

  async resolveCurrentBattle(): Promise<BattleResult | null> {
    if (this.state.phase.kind !== "BATTLE") return null;
    const { attackerId, defenderId } = this.state.phase;
    // The server is authoritative for combat resolution (it owns the
    // unit-type/counter catalog), so fetch its result before closing out the
    // BATTLE phase locally.
    const { state: resolved, battle } = await this.hooks.onBattleResolved(this.state);
    this.state = endBattlePhaseReducer(resolved);
    const attackerAfter = this.state.heroes[attackerId];
    const defenderAfter = this.state.heroes[defenderId];
    const attackerSurvived = attackerAfter ? platoonsHaveTroops(attackerAfter.stacks) : false;
    bus.emit({ type: "battle:resolved", attackerId, defenderId, attackerSurvived });
    const defenderDefeated = defenderAfter ? !platoonsHaveTroops(defenderAfter.stacks) : true;
    if (defenderDefeated && defenderAfter?.isChartering) {
      this.state = cleanupDefeatedHeroChartersReducer(this.state, defenderId);
    }
    this.hooks.logEvent({
      type: "battle_resolved",
      payload: {},
    });
    return battle;
  }

  async endHumanTurn(): Promise<void> {
    await this.endCurrentTurn();
  }

  private async endCurrentTurn(): Promise<void> {
    if (this.aiEnding) return;
    this.aiEnding = true;
    try {
      const endedPlayerId = this.state.activePlayerId;
      const endedRound = this.state.round;
      const oldPhase = this.state.phase.kind;
      const stateBeforeEnd = this.state;

      // Drain any still-in-flight command promises (recruit, upgrades,
      // captures, etc.) before asking the server to end the turn -- closes
      // the race described on this.pendingCommands's own declaration
      // comment above. Commands rejected here already warned via
      // trackCommand's own .catch; this only waits for them to settle, it
      // doesn't re-surface their errors.
      await this.drainPendingCommands();

      // Server is now fully authoritative for the whole end-turn pipeline
      // (production/auto-trade/consumption, the next-player-or-round-wrap
      // phase transition, and -- when wrapping -- settlement upgrades and
      // weekly upkeep/population growth). No local
      // applyEndOfTurnReducer/endTurnReducer/advanceRoundReducer pass
      // beforehand: this.state going in is exactly what gets sent (just
      // activePlayerId, via the hook), and what comes back is the full
      // merged result -- see src/game/turnHooks.ts's onHumanTurnEnd.
      this.state = await this.hooks.onHumanTurnEnd(this.state);

      // turnHooks.ts's onHumanTurnEnd returns the exact same state
      // reference, untouched, when it has nothing to do (no game name) or
      // when the server request itself fails (it catches and
      // console.warns internally, then returns the state it was given).
      // Bail out before logging/emitting anything below in that case --
      // otherwise a failed end-turn request would still tell the event
      // log and event bus a turn transition happened (and could
      // re-trigger advanceAutoTravel()) when nothing actually changed
      // server-side.
      if (this.state === stateBeforeEnd) return;

      this.hooks.logEvent({
        type: "turn_ended",
        payload: { playerId: endedPlayerId, round: endedRound },
      });
      bus.emit({ type: "turn:ended", playerId: endedPlayerId });

      const newPhase = this.state.phase.kind;
      if (oldPhase !== newPhase) {
        bus.emit({ type: "phase:changed", oldPhase, newPhase });
      }

      const wrapped = this.state.round > endedRound;
      if (wrapped) {
        this.hooks.logEvent({ type: "round_ended", payload: { round: endedRound } });
        bus.emit({ type: "round:changed", round: this.state.round });
        bus.emit({ type: "day:changed", day: this.state.day });
        this.hooks.logEvent({ type: "round_started", payload: { round: this.state.round } });
      }

      if (this.state.phase.kind === "PLAYER_TURN") {
        this.advanceAutoTravel();
      } else if (this.state.phase.kind === "AI_TURN") {
        this.hooks.logEvent({
          type: "ai_turn_started",
          payload: { playerId: this.state.activePlayerId, round: this.state.round },
        });
      }
    } finally {
      this.aiEnding = false;
    }
  }

  startTownHallUpgrade(settlementId: string, targetLevel: 2 | 3): { ok: boolean; reason: string } {
    const result = startTownHallUpgradeReducer(this.state, settlementId, targetLevel);
    if (!result.ok) return { ok: false, reason: result.reason };
    this.state = result.state;
    this.hooks.logEvent({
      type: "town_hall_upgrade_started",
      payload: { settlementId, targetLevel },
    });
    this.trackCommand(
      this.hooks.onUpgradeTownHall(this.state.activePlayerId, settlementId, targetLevel),
      "onUpgradeTownHall",
    );
    return { ok: true, reason: "" };
  }

  startBuildingUpgrade(settlementId: string, requests: BuildingUpgradeRequest[]): { ok: boolean; reason: string } {
    const result = startBuildingUpgradeReducer(this.state, settlementId, requests);
    if (!result.ok) return { ok: false, reason: result.reason };
    this.state = result.state;
    this.hooks.logEvent({
      type: "building_upgrade_started",
      payload: { settlementId, requests },
    });
    this.trackCommand(
      this.hooks.onUpgradeBuilding(this.state.activePlayerId, settlementId, requests),
      "onUpgradeBuilding",
    );
    return { ok: true, reason: "" };
  }

  startSettlementUpgrade(settlementId: string): { ok: boolean; reason: string } {
    const s = this.state.settlements[settlementId];
    if (!s) return { ok: false, reason: "no_settlement" };
    const targetLevel = (s.level + 1) as 2 | 3;
    if (targetLevel > 3) return { ok: false, reason: "max_level" };

    const map = this.hooks.getMap();
    const computed = computeSettlementRates(map, s.q, s.r, targetLevel);
    const size = cityViewSizeFor(targetLevel);
    const rng = () => this.hooks.rng();
    const { spots } = generateCitySpots(size, rng);
    const newCitySpots = spots.filter(
      (spot) => !s.citySpots.some((cs) => cs.cell.x === spot.cell.x && cs.cell.y === spot.cell.y),
    );

    const result = startSettlementUpgradeReducer(
      this.state,
      settlementId,
      targetLevel,
      computed.rates,
      newCitySpots,
      settings().upgradePopulationGate,
    );
    if (!result.ok) return { ok: false, reason: result.reason };
    this.state = result.state;
    this.hooks.logEvent({
      type: "settlement_upgrade_started",
      payload: { settlementId, targetLevel },
    });
    this.trackCommand(
      this.hooks.onUpgradeSettlement(this.state.activePlayerId, settlementId, settings().upgradePopulationGate),
      "onUpgradeSettlement",
    );
    return { ok: true, reason: "" };
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