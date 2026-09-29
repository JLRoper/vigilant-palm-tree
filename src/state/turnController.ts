import type { GameState, HeroId, SettlementId, TransferDirection, WarehouseResource, RecruitHeroResult, StartCharterPayload } from "./gameState";
import type { BuildingDef, BuildingKind, HeroBattleVerdict, Platoon } from "@heroes/contracts";
import { platoonsHaveTroops, platoonTroopTotal, settlementStacks, normalizePlatoons } from "./units";
import type { GameMap } from "../map/gameMap";
import {
  applySettlementBattleResult,
  computeSettlementRates,
  generateCitySpots,
  cityViewSizeFor,
  resolveBattle,
  rollbackCaptureSettlement,
} from "@heroes/engine";
import { settings, type HorseVariant } from "./settings";
import type { BattleResult, SettlementBattleOutcome, UnitType } from "@heroes/engine";
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
  applyPlaceBuildings as applyPlaceBuildingsReducer,
  transferResources as transferResourcesReducer,
  assignWagons as assignWagonsReducer,
  buyWagons as buyWagonsReducer,
  createTradeRoute as createTradeRouteReducer,
  updateTradeRoute as updateTradeRouteReducer,
  recruitUnits as recruitUnitsReducer,
  transferUnits as transferUnitsReducer,
  startSettlementBattle as startSettlementBattleReducer,
  type BuildingUpgradeRequest,
} from "./gameState";
import { findPath } from "../map/pathfinding";
import { hexDistance } from "../core/hex";
import { bus } from "../core/eventBus";

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
  // #152 (R5 remainder): fired once per hex-step from advanceAutoTravel()'s
  // loop, same fire-and-forget shape as onHumanMove -- the local
  // stepTravelCharterReducer() call already ran and this.state already
  // reflects it by the time this resolves or rejects.
  onAdvanceCharterTravel(
    actor: number,
    heroId: HeroId,
    fromTile: { q: number; r: number },
    toTile: { q: number; r: number },
    cost: number,
  ): Promise<void>;
  // plan/2026-08-17-issue-88-remaining-command-ports.md Tracks 1/2: same
  // fire-and-forget shape as the rest of this block.
  onUpgradeBuilding(actor: number, settlementId: SettlementId, requests: BuildingUpgradeRequest[]): Promise<void>;
  onUpgradeSettlement(actor: number, settlementId: SettlementId, upgradePopulationGate: number): Promise<void>;
  // F4 closer: fired on every city-view placement/destroy change with the
  // full working cart. Tracked like the rest so End Turn drains it first --
  // the server's EndTurn pipeline is what ticks BuildingDef.construction,
  // so a raced PlaceBuildings means frozen construction stages.
  onPlaceBuildings(actor: number, settlementId: SettlementId, buildings: BuildingDef[], initialLayout?: boolean): Promise<void>;
  onTransferResources(
    actor: number,
    heroId: HeroId,
    settlementId: SettlementId,
    direction: "load" | "unload",
    amounts: Partial<Record<WarehouseResource, number>>,
  ): Promise<void>;
  onAssignWagons(actor: number, heroId: HeroId, delta: number): Promise<void>;
  onBuyWagons(actor: number, settlementId: SettlementId, count: number): Promise<void>;
  onCreateTradeRoute(
    actor: number,
    fromSettlementId: SettlementId,
    toSettlementId: SettlementId,
    resource: WarehouseResource,
    wagons: number,
  ): Promise<void>;
  onUpdateTradeRoute(
    actor: number,
    routeId: string,
    change: { resource?: WarehouseResource; wagonsDelta?: number; remove?: boolean },
  ): Promise<void>;
  // Unit recruitment / garrison transfers / settlement-garrison battle result
  // (plan/1790560842471-unit-recruitment-garrison-plan.md §8): same
  // fire-and-forget shape as the rest of this block.
  onRecruitUnits(
    actor: number,
    settlementId: SettlementId,
    buildingKind: BuildingKind,
    gx: number,
    gy: number,
    unitTypeId: string,
    count: number,
  ): Promise<void>;
  onTransferUnits(
    actor: number,
    heroId: HeroId,
    settlementId: SettlementId,
    direction: "toHero" | "toGarrison",
    unitTypeId: string,
    count: number,
    toSlot?: number,
  ): Promise<void>;
  // Fire-and-forget POST of an auto-resolved settlement-garrison battle
  // result (AI-attacker path). The local engine reducer has already applied
  // the outcome by the time this is called -- same client-trusts-local-
  // computation philosophy as the rest of this block.
  onSettlementBattleSubmitted(payload: {
    actor: number;
    attackerId: HeroId;
    settlementId: SettlementId;
    outcome: SettlementBattleOutcome;
    attackerStacks: Platoon[];
    defenderStacks: Platoon[];
    surrenderedGold?: number;
    rounds: number;
    obstacleSeed: number;
  }): Promise<void>;
}

export interface TurnControllerOptions {
  isPrimaryActor?: () => boolean;
}

export interface SettlementBattleResolution {
  attackerId: HeroId;
  settlementId: SettlementId;
  attackerOwnerId: number;
  settlementOwnerId: number | null;
  outcome: SettlementBattleOutcome;
  captured: boolean;
  attackerVerdict: HeroBattleVerdict;
  battle: BattleResult;
}

export class TurnController {
  private state: GameState;
  private readonly hooks: TurnControllerHooks;
  private readonly opts: TurnControllerOptions;
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
  // The most recent move persist (onHumanMove/onAiMove), kept so a walk-in
  // capture triggered by that same move can serialize its CaptureSettlement
  // POST behind it: tryCaptureAt runs inside the same synchronous block that
  // dispatches the persist, so this field is the triggering move's promise at
  // capture time. Without this ordering the capture POST can win the race,
  // 409 hero_not_at_settlement server-side, and the optimistic capture
  // becomes a phantom until reload.
  private lastMovePersist: Promise<void> | null = null;

  constructor(initial: GameState, hooks: TurnControllerHooks, opts: TurnControllerOptions = {}) {
    this.state = initial;
    this.hooks = hooks;
    this.opts = opts;
  }

  getState(): GameState {
    return this.state;
  }

  private trackCommand(promise: Promise<void>, label: string): Promise<void> {
    const tracked = promise.catch((e) => {
      console.warn(`[turnController] ${label} failed:`, e);
    });
    this.pendingCommands.add(tracked);
    void tracked.finally(() => this.pendingCommands.delete(tracked));
    return tracked;
  }

  private async drainPendingCommands(): Promise<void> {
    // Loop, not a one-shot Promise.all: commands registered while an earlier
    // drain is awaiting (e.g. a persist fired between ticks) must also
    // settle before the barrier releases. Every tracked promise self-removes
    // on settle, so the loop terminates. do-while keeps the one guaranteed
    // await tick the old single-shot form had even when the set is empty
    // (the drain must never run the next stage synchronously).
    do {
      await Promise.all([...this.pendingCommands]);
    } while (this.pendingCommands.size > 0);
  }

  /** Public entry point for callers outside the class (manual save) to wait
   * for in-flight command mutations to settle, without duplicating
   * pendingCommands internals. */
  async flushPendingCommands(): Promise<void> {
    await this.drainPendingCommands();
  }

  private commit(
    next: GameState,
    opts: {
      log?: { type: string; payload: Record<string, unknown> };
      events?: Parameters<typeof bus.emit>[0][];
      hook?: () => Promise<void>;
      hookLabel?: string;
    },
  ): void {
    this.state = next;
    if (opts.log) this.hooks.logEvent(opts.log);
    for (const event of opts.events ?? []) bus.emit(event);
    if (opts.hook) {
      this.trackCommand(opts.hook(), opts.hookLabel ?? opts.log?.type ?? "commit");
    }
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
    // Dispatch (and track) the move persist BEFORE tryCaptureAt so a walk-in
    // capture can chain its own POST behind this exact promise -- the
    // CaptureSettlement precondition (hero standing on the settlement) only
    // holds server-side once this MoveHero/SpendMovement has landed.
    this.lastMovePersist = this.trackCommand(
      this.hooks.onHumanMove(this.state, heroId, toTile, cost),
      "onHumanMove",
    );
    this.tryCaptureAt(heroId, toTile.q, toTile.r);
    // A SETTLEMENT_BATTLE opened by this move owns the phase until it
    // resolves (resolveSettlementBattle closes it). Entering a hero BATTLE
    // here would clobber it -- startBattle overwrites the phase wholesale --
    // so the adjacency check is skipped for this move and re-fires on the
    // next one.
    if (this.state.phase.kind === "PLAYER_TURN") {
      const defenderId = detectAdjacentEnemyFn(this.state, heroId);
      // Same 0-troop guard as the AI tick: a wiped enemy hero standing
      // adjacent must not open a pointless battle.
      if (defenderId && platoonTroopTotal(this.state.heroes[defenderId]?.stacks ?? []) > 0) {
        this.enterBattle(heroId, defenderId);
      }
    }
    return true;
  }

  private tryCaptureAt(heroId: HeroId, q: number, r: number): void {
    for (const [sid, s] of Object.entries(this.state.settlements)) {
      if (s.q === q && s.r === r && s.ownerId !== this.state.heroes[heroId]?.ownerId) {
        const moverOwner = this.state.heroes[heroId]?.ownerId;
        // plan/1790560842471-unit-recruitment-garrison-plan.md §8 gate, in
        // order: (a) a defending hero holds the tile -- defer entirely to
        // the adjacent-enemy battle check that runs right after this in
        // requestMove (post-battle capture re-checks via
        // captureAfterBattleIfNeeded); (b) a garrison with troops fights
        // the manual settlement battle instead of a walk-in capture;
        // (c) otherwise capture as before.
        for (const [otherId, other] of Object.entries(this.state.heroes)) {
          if (otherId !== heroId && other.q === q && other.r === r && other.ownerId !== moverOwner) {
            return;
          }
        }
        if (platoonsHaveTroops(settlementStacks(s))) {
          if (this.enterSettlementBattle(heroId, sid)) return;
          // enterSettlementBattle failed (state moved under us between the
          // troop check above and the reducer's own gates). Do not silently
          // abandon: re-read the garrison NOW and fall back to a walk-in
          // capture only if it is actually empty; otherwise surface a
          // diagnostic so the walk-in is not a silent no-op.
          const live = this.state.settlements[sid];
          if (live && !platoonsHaveTroops(settlementStacks(live))) {
            this.captureSettlement(heroId, sid);
          } else {
            bus.emit({ type: "command:rejected", action: "Settlement battle", reason: "could_not_start_settlement_battle" });
          }
          return;
        }
        this.captureSettlement(heroId, sid);
        return;
      }
    }
  }

  captureAfterBattleIfNeeded(heroId: HeroId): void {
    const hero = this.state.heroes[heroId];
    if (!hero) return;
    this.tryCaptureAt(heroId, hero.q, hero.r);
  }

  cancelMove(heroId: HeroId): void {
    this.state = cancelMoveReducer(this.state, heroId);
  }

  captureSettlement(heroId: HeroId, settlementId: SettlementId): boolean {
    const result = captureSettlementReducer(this.state, heroId, settlementId);
    if (!result.captured) return false;
    const previousOwnerId = result.previousOwnerId;
    const afterMove = this.lastMovePersist;
    this.commit(result.state, {
      events: [{ type: "settlement:captured", heroId, settlementId }],
      log: {
        type: "settlement_captured",
        payload: {
          heroId,
          settlementId,
          newOwnerId: result.state.heroes[heroId]?.ownerId,
          previousOwnerId,
        },
      },
      hook: async () => {
        // Serialize the CaptureSettlement POST behind the triggering move's
        // persist (see lastMovePersist): the optimistic capture above is
        // applied immediately, but the server only accepts the command once
        // the hero's move has landed. On rejection the optimistic capture is
        // rolled back (rollbackCapture); already_owned never reaches this
        // catch because turnHooks' onCaptureSettlement treats it as benign.
        if (afterMove) await afterMove;
        const actor = this.state.heroes[heroId]?.ownerId ?? this.state.activePlayerId;
        try {
          await this.hooks.onCaptureSettlement(actor, heroId, settlementId);
        } catch {
          this.rollbackCapture(heroId, settlementId, previousOwnerId);
        }
      },
      hookLabel: "onCaptureSettlement",
    });
    return true;
  }

  private rollbackCapture(heroId: HeroId, settlementId: SettlementId, previousOwnerId: number | null): void {
    const next = rollbackCaptureSettlement(this.state, heroId, settlementId, previousOwnerId);
    if (!next) return;
    this.state = next;
    this.hooks.logEvent({
      type: "capture_rolled_back",
      payload: { heroId, settlementId, previousOwnerId },
    });
    bus.emit({ type: "economy:goldChanged", entityId: heroId, entityType: "hero", amount: next.heroes[heroId]?.gold ?? 0 });
  }

  enterBattle(attackerId: HeroId, defenderId: HeroId): void {
    this.state = startBattleReducer(this.state, attackerId, defenderId);
    this.hooks.logEvent({
      type: "battle_started",
      payload: { attackerId, defenderId },
    });
  }

  enterSettlementBattle(attackerId: HeroId, settlementId: SettlementId): boolean {
    const result = startSettlementBattleReducer(this.state, attackerId, settlementId);
    if (!result.ok) return false;
    this.state = result.state;
    this.hooks.logEvent({
      type: "settlement_battle_started",
      payload: { attackerId, settlementId },
    });
    return true;
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
    this.commit(result.state, {
      events: [
        { type: "economy:goldChanged", entityId: heroId, entityType: "hero", amount: result.state.heroes[heroId]?.gold ?? 0 },
        { type: "economy:goldChanged", entityId: settlementId, entityType: "settlement", amount: result.state.settlements[settlementId]?.gold ?? 0 },
      ],
      log: {
        type: "transfer_gold",
        payload: { heroId, settlementId, direction, amount },
      },
      hook: () => {
        const actor = result.state.heroes[heroId]?.ownerId ?? result.state.activePlayerId;
        return this.hooks.onTransferGold(actor, heroId, settlementId, direction);
      },
      hookLabel: "onTransferGold",
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
    this.commit(result.state, {
      events: [
        { type: "economy:warehouseChanged", settlementId: fromId, resource, amount: result.state.settlements[fromId]?.warehouse?.[resource] ?? 0 },
        { type: "economy:warehouseChanged", settlementId: toId, resource, amount: result.state.settlements[toId]?.warehouse?.[resource] ?? 0 },
      ],
      log: {
        type: "resources_traded",
        payload: { fromId, toId, resource, amount },
      },
      hook: () => this.hooks.onTradeResources(result.state.activePlayerId, fromId, toId, resource, amount),
      hookLabel: "onTradeResources",
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
    this.commit(result.state, {
      log: {
        type: "stack_reordered",
        payload: { heroId, fromIdx, toIdx },
      },
      hook: () => {
        const actor = result.state.heroes[heroId]?.ownerId ?? result.state.activePlayerId;
        return this.hooks.onReorderStack(actor, heroId, fromIdx, toIdx);
      },
      hookLabel: "onReorderStack",
    });
    return { ok: true, reason: "" };
  }

  setAutoTrade(settlementId: SettlementId, autoTrade: boolean): boolean {
    const before = this.state.settlements[settlementId];
    if (!before) return false;
    if (before.ownerId !== this.state.activePlayerId) return false;
    const next = setAutoTradeReducer(this.state, settlementId, autoTrade);
    if (next === this.state) return false;
    this.commit(next, {
      log: {
        type: "auto_trade_toggled",
        payload: { settlementId, autoTrade },
      },
      hook: () => this.hooks.onSetAutoTrade(next.activePlayerId, settlementId, autoTrade),
      hookLabel: "onSetAutoTrade",
    });
    return true;
  }

  recruitHero(heroName: string, settlementId: SettlementId, horseVariant: HorseVariant): RecruitHeroResult {
    const result = recruitHeroReducer(this.state, this.state.activePlayerId, heroName, settlementId, horseVariant);
    if (!result.hero) return result;
    this.commit(result.state, {
      log: {
        type: "hero_recruited",
        payload: { heroId: result.hero.id, name: heroName, playerId: result.state.activePlayerId },
      },
      hook: () => this.hooks.onRecruitHero(result.state.activePlayerId, heroName, settlementId, horseVariant),
      hookLabel: "onRecruitHero",
    });
    return result;
  }

  recruitUnits(
    settlementId: SettlementId,
    buildingKind: BuildingKind,
    gx: number,
    gy: number,
    unitTypeId: string,
    count: number,
  ): boolean {
    const result = recruitUnitsReducer(this.state, { settlementId, buildingKind, gx, gy, unitTypeId, count });
    if (!result.ok) return false;
    this.commit(result.state, {
      log: {
        type: "units_recruited",
        payload: { settlementId, unitTypeId, count },
      },
      hook: () =>
        this.hooks.onRecruitUnits(result.state.activePlayerId, settlementId, buildingKind, gx, gy, unitTypeId, count),
      hookLabel: "onRecruitUnits",
    });
    return true;
  }

  transferUnits(
    heroId: HeroId,
    settlementId: SettlementId,
    direction: "toHero" | "toGarrison",
    unitTypeId: string,
    count: number,
    toSlot?: number,
  ): boolean {
    const result = transferUnitsReducer(this.state, { heroId, settlementId, direction, unitTypeId, count, toSlot });
    if (!result.ok) return false;
    this.commit(result.state, {
      log: {
        type: "units_transferred",
        payload: { heroId, settlementId, direction, unitTypeId, count },
      },
      hook: () => {
        const actor = result.state.heroes[heroId]?.ownerId ?? result.state.activePlayerId;
        return this.hooks.onTransferUnits(actor, heroId, settlementId, direction, unitTypeId, count, toSlot);
      },
      hookLabel: "onTransferUnits",
    });
    return true;
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
        const fromTile = { q: hero.q, r: hero.r };
        this.state = result.state;
        bus.emit({ type: "hero:moved", heroId: hero.id, from: fromTile, to: { q: nextStep.q, r: nextStep.r }, playerId: hero.ownerId });
        // #152: wrapped in trackCommand for the same reason every other
        // fire-and-forget hook is (this class's own pendingCommands
        // comment, above) -- without it, ending the turn right after the
        // last step of a charter's route could race ahead of this POST and
        // have EndTurn's response silently revert it.
        this.trackCommand(
          this.hooks.onAdvanceCharterTravel(hero.ownerId, hero.id, fromTile, { q: nextStep.q, r: nextStep.r }, cost),
          "onAdvanceCharterTravel",
        );

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
    // Serialize AFTER the move persist: drain every in-flight command (the
    // AI tick's onAiMove, a human onHumanMove, captures...) before asking
    // the server to resolve, so the server's adjacency check sees the
    // mover's final position. Without this, the quick-resolve fired by the
    // frame loop could beat SpendMovement server-side, 409 not_adjacent,
    // and the catch below would clear the phase with no casualties -- the
    // same two heroes re-fighting every round. This is the same
    // pendingCommands barrier endCurrentTurn() drains.
    await this.drainPendingCommands();
    // The battle can evaporate while draining (a sync replaceState, or the
    // phase already closed): re-check before dispatching.
    if (this.state.phase.kind !== "BATTLE") return null;
    // The server is authoritative for combat resolution (it owns the
    // unit-type/counter catalog), so fetch its result before closing out the
    // BATTLE phase locally.
    const { state: resolved, battle } = await this.hooks.onBattleResolved(this.state);
    // endBattlePhase() unconditionally reopens PLAYER_TURN for
    // state.activePlayerId. When the battle was entered from tick() during
    // AI_TURN (an AI attacker), that leaves an AI seat holding a human
    // phase: tick() gates on AI_TURN and canEndTurn() rejects AI factions,
    // so neither side could ever end the turn. Re-map it so the AI turn
    // resumes; human seats keep the exact PLAYER_TURN endBattlePhase gives.
    let closed = endBattlePhaseReducer(resolved);
    if (closed.phase.kind === "PLAYER_TURN") {
      const active = closed.players.find((p) => p.id === closed.activePlayerId);
      if (active?.faction === "ai") {
        closed = { ...closed, phase: { kind: "AI_TURN", playerId: closed.activePlayerId } };
      }
    }
    this.state = closed;
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

  // Settlement-garrison twin of resolveCurrentBattle(): resolves the
  // client-local SETTLEMENT_BATTLE phase with the engine auto-resolver (the
  // same resolveBattle() call the server's ResolveBattle command runs, with
  // no retreat policies, so a conceded verdict never occurs), applies it via
  // applySettlementBattleResult (capture on a win, bounced attacker with the
  // submitted garrison otherwise, full hero outcomes), POSTs the result
  // fire-and-forget for server persistence, and re-maps the phase back to
  // AI_TURN so the tick resumes. unitTypes is the /api/units catalog the
  // caller holds (the controller stays network-free); null means the
  // catalog is unavailable and no casualty report can be computed -- the
  // attacker is bounced (flee semantics) and the phase cleared instead of
  // inventing a result.
  async resolveSettlementBattle(
    unitTypes: Record<string, UnitType> | null,
  ): Promise<SettlementBattleResolution | null> {
    if (this.state.phase.kind !== "SETTLEMENT_BATTLE") return null;
    const { attackerId, settlementId } = this.state.phase;
    // Same move-then-resolve barrier as resolveCurrentBattle: the server's
    // hero_not_at_settlement gate only holds once the triggering move
    // persist has landed.
    await this.drainPendingCommands();
    if (this.state.phase.kind !== "SETTLEMENT_BATTLE") return null;
    const phase = this.state.phase;
    if (phase.kind !== "SETTLEMENT_BATTLE" || phase.attackerId !== attackerId || phase.settlementId !== settlementId) {
      return null;
    }
    const pre = this.state;
    const attacker = pre.heroes[attackerId];
    const settlement = pre.settlements[settlementId];
    if (!attacker || !settlement) {
      this.clearSettlementBattlePhase();
      return null;
    }
    if (!unitTypes || Object.keys(unitTypes).length === 0) {
      this.state = cancelMoveReducer(pre, attackerId);
      this.clearSettlementBattlePhase();
      this.hooks.logEvent({
        type: "settlement_battle_unresolved",
        payload: { attackerId, settlementId, reason: "unit_catalog_unavailable" },
      });
      return null;
    }
    const battle = resolveBattle(normalizePlatoons(attacker.stacks), normalizePlatoons(settlementStacks(settlement)), {
      unitTypes,
      obstacleSeed: Math.floor(this.hooks.rng() * 0x1_0000_0000) >>> 0,
    });
    const outcome: SettlementBattleOutcome =
      battle.winner === "attacker" ? "attackerWon" : battle.winner === "defender" ? "defenderWon" : "draw";
    const applied = applySettlementBattleResult(pre, {
      attackerId,
      settlementId,
      outcome,
      attackerStacks: battle.attackerPlatoons,
      defenderStacks: battle.defenderPlatoons,
    });
    let next = applied.state;
    // Hero-outcomes parity with the server-response merge in
    // GameActions.startSettlementBattleFlow: a removed attacker clears a
    // selection pointing at it (the engine reducer prunes heroIds but never
    // touches client-local selection state).
    if (applied.removedHeroIds.includes(attackerId) && next.selectedHeroId === attackerId) {
      next = { ...next, selectedHeroId: null };
    }
    // applySettlementBattleResult closed the phase via endBattlePhase; an
    // AI-seat active player needs the same re-map as resolveCurrentBattle
    // or neither tick() nor canEndTurn() could ever advance the turn.
    if (next.phase.kind === "PLAYER_TURN") {
      const active = next.players.find((p) => p.id === next.activePlayerId);
      if (active?.faction === "ai") {
        next = { ...next, phase: { kind: "AI_TURN", playerId: next.activePlayerId } };
      }
    }
    this.state = next;
    this.trackCommand(
      this.hooks.onSettlementBattleSubmitted({
        actor: attacker.ownerId,
        attackerId,
        settlementId,
        outcome,
        attackerStacks: battle.attackerPlatoons,
        defenderStacks: battle.defenderPlatoons,
        rounds: battle.rounds,
        obstacleSeed: battle.obstacleSeed,
      }),
      "onSettlementBattleSubmitted",
    );
    bus.emit({
      type: "battle:resolved",
      attackerId,
      defenderId: settlementId,
      attackerSurvived: platoonsHaveTroops(next.heroes[attackerId]?.stacks ?? []),
    });
    this.hooks.logEvent({
      type: "settlement_battle_resolved",
      payload: { attackerId, settlementId, outcome, captured: applied.captured },
    });
    return {
      attackerId,
      settlementId,
      attackerOwnerId: attacker.ownerId,
      settlementOwnerId: settlement.ownerId,
      outcome,
      captured: applied.captured,
      attackerVerdict: applied.attackerVerdict,
      battle,
    };
  }

  private clearSettlementBattlePhase(): void {
    let closed = endBattlePhaseReducer(this.state);
    if (closed.phase.kind === "PLAYER_TURN") {
      const active = closed.players.find((p) => p.id === closed.activePlayerId);
      if (active?.faction === "ai") {
        closed = { ...closed, phase: { kind: "AI_TURN", playerId: closed.activePlayerId } };
      }
    }
    this.state = closed;
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
    this.commit(result.state, {
      log: {
        type: "town_hall_upgrade_started",
        payload: { settlementId, targetLevel },
      },
      hook: () => this.hooks.onUpgradeTownHall(result.state.activePlayerId, settlementId, targetLevel),
      hookLabel: "onUpgradeTownHall",
    });
    return { ok: true, reason: "" };
  }

  placeBuildings(settlementId: string, buildings: BuildingDef[], initialLayout = false): { ok: boolean; reason: string } {
    const result = applyPlaceBuildingsReducer(this.state, settlementId, this.state.activePlayerId, buildings, initialLayout);
    if (!result.ok) return { ok: false, reason: result.reason };
    this.commit(result.state, {
      log: {
        type: "buildings_placed",
        payload: { settlementId },
      },
      hook: () => this.hooks.onPlaceBuildings(result.state.activePlayerId, settlementId, buildings, initialLayout),
      hookLabel: "onPlaceBuildings",
    });
    return { ok: true, reason: "" };
  }

  transferResources(
    heroId: string,
    settlementId: string,
    direction: "load" | "unload",
    amounts: Partial<Record<WarehouseResource, number>>,
  ): { ok: boolean; reason: string } {
    const result = transferResourcesReducer(this.state, this.state.activePlayerId, heroId, settlementId, direction, amounts);
    if (!result.ok) return { ok: false, reason: result.reason };
    this.commit(result.state, {
      log: {
        type: "resources_transferred",
        payload: { heroId, settlementId, direction },
      },
      hook: () => this.hooks.onTransferResources(result.state.activePlayerId, heroId, settlementId, direction, amounts),
      hookLabel: "onTransferResources",
    });
    return { ok: true, reason: "" };
  }

  assignWagons(heroId: string, delta: number): { ok: boolean; reason: string } {
    const result = assignWagonsReducer(this.state, this.state.activePlayerId, heroId, delta);
    if (!result.ok) return { ok: false, reason: result.reason };
    this.commit(result.state, {
      log: {
        type: "wagons_assigned",
        payload: { heroId, delta },
      },
      hook: () => this.hooks.onAssignWagons(result.state.activePlayerId, heroId, delta),
      hookLabel: "onAssignWagons",
    });
    return { ok: true, reason: "" };
  }

  buyWagons(settlementId: string, count: number): { ok: boolean; reason: string } {
    const result = buyWagonsReducer(this.state, this.state.activePlayerId, settlementId, count);
    if (!result.ok) return { ok: false, reason: result.reason };
    this.commit(result.state, {
      log: {
        type: "wagons_bought",
        payload: { settlementId, count },
      },
      hook: () => this.hooks.onBuyWagons(result.state.activePlayerId, settlementId, count),
      hookLabel: "onBuyWagons",
    });
    return { ok: true, reason: "" };
  }

  createTradeRoute(
    fromSettlementId: string,
    toSettlementId: string,
    resource: WarehouseResource,
    wagons: number,
  ): { ok: boolean; reason: string } {
    const result = createTradeRouteReducer(
      this.state,
      this.state.activePlayerId,
      fromSettlementId,
      toSettlementId,
      resource,
      wagons,
    );
    if (!result.ok) return { ok: false, reason: result.reason };
    this.commit(result.state, {
      log: {
        type: "trade_route_created",
        payload: { routeId: result.route?.id, fromSettlementId, toSettlementId, resource, wagons },
      },
      hook: () =>
        this.hooks.onCreateTradeRoute(
          result.state.activePlayerId,
          fromSettlementId,
          toSettlementId,
          resource,
          wagons,
        ),
      hookLabel: "onCreateTradeRoute",
    });
    return { ok: true, reason: "" };
  }

  updateTradeRoute(
    routeId: string,
    change: { resource?: WarehouseResource; wagonsDelta?: number; remove?: boolean },
  ): { ok: boolean; reason: string } {
    const result = updateTradeRouteReducer(this.state, this.state.activePlayerId, routeId, change);
    if (!result.ok) return { ok: false, reason: result.reason };
    this.commit(result.state, {
      log: {
        type: "trade_route_updated",
        payload: { routeId, ...change },
      },
      hook: () => this.hooks.onUpdateTradeRoute(result.state.activePlayerId, routeId, change),
      hookLabel: "onUpdateTradeRoute",
    });
    return { ok: true, reason: "" };
  }

  startBuildingUpgrade(settlementId: string, requests: BuildingUpgradeRequest[]): { ok: boolean; reason: string } {
    const result = startBuildingUpgradeReducer(this.state, settlementId, requests);
    if (!result.ok) return { ok: false, reason: result.reason };
    this.commit(result.state, {
      log: {
        type: "building_upgrade_started",
        payload: { settlementId, requests },
      },
      hook: () => this.hooks.onUpgradeBuilding(result.state.activePlayerId, settlementId, requests),
      hookLabel: "onUpgradeBuilding",
    });
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
    this.commit(result.state, {
      log: {
        type: "settlement_upgrade_started",
        payload: { settlementId, targetLevel },
      },
      hook: () =>
        this.hooks.onUpgradeSettlement(result.state.activePlayerId, settlementId, settings().upgradePopulationGate),
      hookLabel: "onUpgradeSettlement",
    });
    return { ok: true, reason: "" };
  }

  tick(_dtMs: number): void {
    if (this.state.phase.kind !== "AI_TURN") return;
    if (this.opts.isPrimaryActor && !this.opts.isPrimaryActor()) return;
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
      // startMove's not_selected gate guards a client-UI concept the AI tick
      // doesn't have; satisfy it the same way the server does for every
      // MoveHero command (commandHandler.ts): name the mover as selected.
      const result = startMoveReducer({ ...this.state, selectedHeroId: heroId }, heroId, move.toTile, move.cost, path);
      if (!result.ok) continue;
      this.state = result.state;
      moved = true;
      this.hooks.logEvent({
        type: "move_completed",
        payload: { heroId, to: move.toTile, cost: move.cost },
      });
      this.aiAwaitingPersist = true;
      // Tracked in pendingCommands (same barrier End Turn drains) so
      // resolveCurrentBattle can hold ResolveBattle until the move POST has
      // landed -- the server validates battle adjacency from positions, so a
      // resolve that outruns the persist 409s not_adjacent and the fight
      // just re-fires next round with no casualties. Recorded as
      // lastMovePersist so a walk-in capture chains behind it too.
      this.lastMovePersist = this.trackCommand(
        this.hooks.onAiMove(this.state, heroId, move.toTile).catch((e: unknown) => {
          console.warn("[turnController] onAiMove failed:", e);
        }),
        "onAiMove",
      );
      void this.lastMovePersist.finally(() => {
        this.aiAwaitingPersist = false;
      });
      this.tryCaptureAt(heroId, move.toTile.q, move.toTile.r);
      // Battles only ever start here after a successful move (same rule as
      // requestMove/advanceAutoTravel). Resolution is deliberately NOT done
      // inline: once phase is BATTLE the phase guard stops this tick, the
      // frame loop's maybeAutoResolveBattle quick-resolves an AI attack, and
      // resolveCurrentBattle re-maps the phase back to AI_TURN so the next
      // tick resumes (or ends) the turn. A SETTLEMENT_BATTLE opened by
      // tryCaptureAt owns the phase the same way -- entering a hero BATTLE
      // here would clobber it (startBattle overwrites the phase), so the
      // adjacency check is skipped for this move and the persist/
      // aiAwaitingPersist bookkeeping above still runs; the settlement
      // battle resolves via resolveSettlementBattle and re-maps to AI_TURN.
      if (this.state.phase.kind !== "AI_TURN") {
        break;
      }
      const defenderId = detectAdjacentEnemyFn(this.state, heroId);
      if (defenderId && platoonTroopTotal(this.state.heroes[defenderId]?.stacks ?? []) > 0) {
        this.enterBattle(heroId, defenderId);
      }
      break;
    }

    if (!moved) {
      void this.endCurrentTurn();
    }
  }
}