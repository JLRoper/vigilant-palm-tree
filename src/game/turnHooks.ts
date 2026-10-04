import { api } from "../io/api";
import {
  endTurn,
  spendMovement,
  resolveBattle,
  transferGold,
  recruitHero,
  upgradeTownHall,
  setAutoTrade,
  reorderStack,
  captureSettlement,
  CommandError,
  startCharter,
  upgradeBuilding,
  upgradeSettlement,
  placeBuildings as placeBuildingsCommand,
  transferResources as transferResourcesCommand,
  assignWagons as assignWagonsCommand,
  buyWagons as buyWagonsCommand,
  createTradeRoute as createTradeRouteCommand,
  updateTradeRoute as updateTradeRouteCommand,
  advanceCharterTravel,
  recruitUnits as recruitUnitsCommand,
  transferUnits as transferUnitsCommand,
  bankGold as bankGoldCommand,
  submitSettlementBattleResult,
} from "../io/commands";
import type { EndTurnResult } from "../io/commands";
import type {
  BuildingDef,
  BuildingKind,
  BuildingUpgradeRequest,
  GameState,
  HeroBattleVerdict,
  HeroId,
  HeroState,
  PlayerId,
  SettlementId,
  TradeRouteEndpoint,
  TradeRoutePayload,
  TransferDirection,
  WarehouseResource,
} from "@heroes/contracts";
import type { TurnController, TurnControllerHooks } from "../state/turnController";
import type { BattleResult } from "@heroes/engine";
import { deriveNextTradeRouteId } from "@heroes/engine";
import { pickAiMove as pickAiMoveBrain, pickGarrisonRecruitment } from "../ai/aiBrain";
import { cachedUnitTypes } from "../data/unitCatalog";
import type { GameMap } from "../map/gameMap";
import type { Axial } from "../core/hex";
import { getMultiplayerSync } from "../io/multiplayerSync";
import { settings, type HorseVariant } from "../state/settings";
import { bus } from "../core/eventBus";
import { getInMemoryLocalPlayerId } from "../players/localPlayer";
import { takeLastAppliedBuildDelta } from "./buildCommitLedger";
import type { NetCost } from "../screens/settlements/cityView/netCost";

// #100: src/state/turnController.ts calls each of the eight
// TurnControllerHooks methods below fire-and-forget (`void this.hooks.onXxx(
// ...).catch(...)`) -- the local @heroes/engine reducer call has already run
// and the player already sees the result rendered by the time any of these
// resolve or reject. Previously a rejection only reached a console.warn here
// (see this function's own header comment on turnController.ts:52-63), so a
// server-side rollback "un-happened" on screen several seconds later, on the
// next multiplayerSync poll, with no explanation. reportCommandFailure keeps
// the console.warn (still useful in devtools) and additionally emits a
// bus event so src/screens/shared/toast.ts can show the player something.
function reportCommandFailure(action: string, e: unknown): void {
  console.warn(`[turnHooks] ${action} failed:`, e);
  const reason = e instanceof CommandError ? e.reason : e instanceof Error ? e.message : String(e);
  bus.emit({ type: "command:rejected", action, reason });
}

// Server's EndTurn command path (server/app/commandHandler.ts) appends the authoritative copies of these audit kinds itself; the client posts were byte-identical duplicates (actor_seat NULL on top).
const SERVER_APPENDED_AUDIT_KINDS: ReadonlySet<string> = new Set([
  "turn_ended",
  "round_ended",
  "round_started",
  "ai_turn_started",
]);

export interface BuildTurnHooksOptions {
  gameName: () => string | null;
  gameMap: () => GameMap;
  rng: () => number;
  logToConsole?: boolean;
  onPlaceBuildingsRejected?: (settlementId: SettlementId, appliedDelta: NetCost) => void;
  // Local viewer's seat, used by mergeFromEndTurn to keep a hero selection
  // only when it belongs to this browser. Null/unknown seat falls back to the
  // legacy existence-only preservation.
  localSeat?: () => PlayerId | null;
  // S1 (logistics-interface-fixes plan §5.8): the four logistics hooks hand
  // their command results to the live controller's mergeCommandResult through
  // this getter, so the optimistic route id / wagon pools reconcile with the
  // server's instead of diverging until a resync. Resolved lazily at result
  // time (the controller does not exist when hooks are built).
  getController?: () => TurnController | null;
}

let lastBattle: { attackerId: HeroId; defenderId: HeroId } | null = null;

export interface ResolveBattleVerdicts {
  attackerVerdict?: HeroBattleVerdict;
  defenderVerdict?: HeroBattleVerdict;
}

// Verdicts from the most recent successful resolveBattle round-trip, consumed
// by GameActions after resolveCurrentBattle() for the result card / AI toast
// wording. Cleared at every onBattleResolved entry so a failed resolve never
// surfaces a previous battle's verdicts.
let lastResolveVerdicts: ResolveBattleVerdicts | null = null;

export function consumeResolveBattleVerdicts(): ResolveBattleVerdicts {
  const v = lastResolveVerdicts;
  lastResolveVerdicts = null;
  return v ?? {};
}

export function buildTurnHooks(opts: BuildTurnHooksOptions): TurnControllerHooks {
  return {
    // Called with state.activePlayerId still the player who is ending
    // their turn (src/state/turnController.ts's endCurrentTurn() no longer
    // runs applyEndOfTurnReducer/endTurnReducer locally before this --
    // the server is now fully authoritative for the whole end-turn
    // pipeline, see server/app/turnService.ts).
    onHumanTurnEnd: async (state: GameState): Promise<GameState> => {
      const name = opts.gameName();
      if (!name) return state;
      const sync = getMultiplayerSync();
      sync.stop();
      try {
        const result = await endTurn(name, state.activePlayerId, settings().populationGrowthRate);
        const merged = mergeFromEndTurn(state, result, opts.localSeat?.() ?? null);
        sync.start(name);
        return merged;
      } catch (e) {
        // The state comes back unchanged, so without this the click is
        // invisible: the EndTurn POST failed (403 forbidden_not_your_turn /
        // actor_mismatch / ai_seat_command_forbidden, a 5xx, or the 10s
        // TimeoutError) and the player is left with a toolbar that looks live
        // but does nothing. Every other hook here reports its failure, so this
        // one must too.
        reportCommandFailure("End turn", e);
        sync.start(name);
        return state;
      }
    },
    onAiMove: async (state: GameState, heroId: HeroId, toTile: Axial): Promise<void> => {
      const name = opts.gameName();
      if (!name) return;
      const hero = state.heroes[heroId];
      if (!hero) return;
      // Deliberately NO catch here: the AI tick's serialization owns this
      // promise and must know when the persist failed -- a silently-swallowed
      // rejection leaves the client's optimistic move un-landed server-side
      // and every later command in the turn 409s against the stale server
      // position (turnController.recoverFailedAiMovePersist).
      const previousCost = (hero.previousMovementRemaining ?? hero.movementRemaining) - hero.movementRemaining;
      await spendMovement(name, {
        actor: hero.ownerId,
        heroId,
        fromTile: { q: hero.previousQ ?? hero.q, r: hero.previousR ?? hero.r },
        toTile,
        cost: previousCost > 0 ? previousCost : 1,
      });
    },
    onHumanMove: async (
      state: GameState,
      heroId: HeroId,
      toTile: Axial,
      cost: number,
    ): Promise<void> => {
      const name = opts.gameName();
      if (!name) return;
      const hero = state.heroes[heroId];
      if (!hero) return;
      try {
        await spendMovement(name, {
          actor: hero.ownerId,
          heroId,
          fromTile: { q: hero.previousQ ?? hero.q, r: hero.previousR ?? hero.r },
          toTile,
          cost,
        });
      } catch (e) {
        reportCommandFailure("Move", e);
      }
    },
    onBattleResolved: async (
      state: GameState,
    ): Promise<{ state: GameState; battle: BattleResult | null }> => {
      const cached = lastBattle;
      lastBattle = null;
      lastResolveVerdicts = null;
      const name = opts.gameName();
      if (!name || !cached) return { state, battle: null };
      const attackerHeroBefore = state.heroes[cached.attackerId];
      if (!attackerHeroBefore) return { state, battle: null };
      // On server-driven games the attacker's owner is often an AI seat and
      // the command route rejects AI-seat actors (ai_seat_command_forbidden):
      // act as the local seat whenever it owns either combatant.
      const local = getInMemoryLocalPlayerId(name) ?? 0;
      const ownsAttacker = attackerHeroBefore.ownerId === local;
      const defenderHeroBefore = state.heroes[cached.defenderId];
      const ownsDefender = defenderHeroBefore?.ownerId === local;
      const actor = ownsAttacker || ownsDefender ? local : attackerHeroBefore.ownerId;
      try {
        // No longer sends the client's GameState at all (Phase 3 Track A
        // Week 3+) -- the server loads its own row and its own unit_types
        // catalog (see server/app/commandHandler.ts's ResolveBattle case),
        // so this only needs to carry who's attacking whom and on whose
        // behalf.
        const result = await resolveBattle(name, {
          actor,
          attackerId: cached.attackerId,
          defenderId: cached.defenderId,
        });
        lastResolveVerdicts = {
          attackerVerdict: result.attackerVerdict,
          defenderVerdict: result.defenderVerdict,
        };
        return {
          state: mergeBattleOutcomeHeroes(state, cached.attackerId, cached.defenderId, result),
          battle: result.battle,
        };
      } catch (e) {
        console.warn("[turnHooks] resolveBattle failed:", e);
        return { state, battle: null };
      }
    },
    onRecruitHero: async (
      actor: number,
      heroName: string,
      settlementId: SettlementId,
      horseVariant: HorseVariant,
    ): Promise<void> => {
      const name = opts.gameName();
      if (!name) return;
      try {
        await recruitHero(name, { actor, heroName, settlementId, horseVariant });
      } catch (e) {
        reportCommandFailure("Recruit hero", e);
      }
    },
    onUpgradeTownHall: async (
      actor: number,
      settlementId: SettlementId,
      targetLevel: 2 | 3,
    ): Promise<void> => {
      const name = opts.gameName();
      if (!name) return;
      try {
        await upgradeTownHall(name, { actor, settlementId, targetLevel });
      } catch (e) {
        reportCommandFailure("Upgrade Town Hall", e);
      }
    },
    onSetAutoTrade: async (
      actor: number,
      settlementId: SettlementId,
      autoTrade: boolean,
    ): Promise<void> => {
      const name = opts.gameName();
      if (!name) return;
      try {
        await setAutoTrade(name, { actor, settlementId, autoTrade });
      } catch (e) {
        reportCommandFailure("Set auto-trade", e);
      }
    },
    onReorderStack: async (
      actor: number,
      heroId: HeroId,
      fromIdx: number,
      toIdx: number,
    ): Promise<void> => {
      const name = opts.gameName();
      if (!name) return;
      try {
        await reorderStack(name, { actor, heroId, fromIdx, toIdx });
      } catch (e) {
        reportCommandFailure("Reorder stack", e);
      }
    },
    onCaptureSettlement: async (
      actor: number,
      heroId: HeroId,
      settlementId: SettlementId,
    ): Promise<void> => {
      const name = opts.gameName();
      if (!name) return;
      try {
        await captureSettlement(name, { actor, heroId, settlementId });
      } catch (e) {
        // Benign: the server already has this capture -- most commonly
        // because it captured inline with a post-battle persist or the
        // settlement-battle result before this serialized POST landed. The
        // local optimistic capture already matches server state, so there is
        // nothing to roll back and no error to surface to the player.
        if (e instanceof CommandError && e.reason === "already_owned") {
          console.warn("[turnHooks] capture already owned server-side; keeping local capture");
          return;
        }
        reportCommandFailure("Capture settlement", e);
        // Rethrow so TurnController.captureSettlement's serialized dispatch
        // rolls the optimistic capture back (owner/roster/gold) -- the same
        // record-then-undo-on-rejection shape as the build-commit ledger.
        throw e;
      }
    },
    onTransferGold: async (
      actor: number,
      heroId: HeroId,
      settlementId: SettlementId,
      direction: TransferDirection,
    ): Promise<void> => {
      const name = opts.gameName();
      if (!name) return;
      try {
        await transferGold(name, { actor, heroId, settlementId, direction });
      } catch (e) {
        reportCommandFailure("Transfer gold", e);
      }
    },
    onStartCharter: async (
      actor: number,
      heroId: HeroId,
      targetQ: number,
      targetR: number,
      settlementName: string,
    ): Promise<void> => {
      const name = opts.gameName();
      if (!name) return;
      try {
        await startCharter(name, { actor, heroId, targetQ, targetR, settlementName });
      } catch (e) {
        reportCommandFailure("Start charter", e);
      }
    },
    onAdvanceCharterTravel: async (
      actor: number,
      heroId: HeroId,
      fromTile: Axial,
      toTile: Axial,
      cost: number,
    ): Promise<void> => {
      const name = opts.gameName();
      if (!name) return;
      try {
        await advanceCharterTravel(name, { actor, heroId, fromTile, toTile, cost });
      } catch (e) {
        reportCommandFailure("Advance charter travel", e);
      }
    },
  onUpgradeBuilding: async (
    actor: number,
    settlementId: SettlementId,
    requests: BuildingUpgradeRequest[],
  ): Promise<void> => {
    const name = opts.gameName();
    if (!name) return;
    try {
      await upgradeBuilding(name, { actor, settlementId, requests });
    } catch (e) {
      reportCommandFailure("Upgrade building", e);
    }
  },
  onTransferResources: async (
    actor: number,
    heroId: HeroId,
    settlementId: SettlementId,
    direction: "load" | "unload",
    amounts: Partial<Record<WarehouseResource, number>>,
  ): Promise<void> => {
    const name = opts.gameName();
    if (!name) return;
    try {
      await transferResourcesCommand(name, { actor, heroId, settlementId, direction, amounts });
    } catch (e) {
      reportCommandFailure("Transfer resources", e);
    }
  },
  onAssignWagons: async (actor: number, heroId: HeroId, delta: number, slot?: "cargo" | "treasury"): Promise<void> => {
    const name = opts.gameName();
    if (!name) return;
    try {
      const result = await assignWagonsCommand(name, { actor, heroId, delta, slot });
      opts.getController?.()?.mergeCommandResult(result);
    } catch (e) {
      reportCommandFailure("Assign wagons", e);
    }
  },
  onBuyWagons: async (actor: number, settlementId: SettlementId, count: number, slot?: "cargo" | "treasury"): Promise<void> => {
    const name = opts.gameName();
    if (!name) return;
    try {
      const result = await buyWagonsCommand(name, { actor, settlementId, count, slot });
      opts.getController?.()?.mergeCommandResult(result);
    } catch (e) {
      reportCommandFailure("Buy wagons", e);
    }
  },
  onCreateTradeRoute: async (
    actor: number,
    from: TradeRouteEndpoint,
    to: TradeRouteEndpoint,
    payload: TradeRoutePayload,
    wagons: number,
  ): Promise<void> => {
    const name = opts.gameName();
    if (!name) return;
    try {
      const result = await createTradeRouteCommand(name, { actor, from, to, payload, wagons });
      opts.getController?.()?.mergeCommandResult(result);
    } catch (e) {
      reportCommandFailure("Create trade route", e);
    }
  },
  onUpdateTradeRoute: async (
    actor: number,
    routeId: string,
    change: { resource?: WarehouseResource; wagonsDelta?: number; remove?: boolean },
  ): Promise<void> => {
    const name = opts.gameName();
    if (!name) return;
    try {
      const result = await updateTradeRouteCommand(name, { actor, routeId, ...change });
      opts.getController?.()?.mergeCommandResult(result);
    } catch (e) {
      reportCommandFailure("Update trade route", e);
    }
  },
    onUpgradeSettlement: async (
      actor: number,
      settlementId: SettlementId,
    ): Promise<void> => {
      const name = opts.gameName();
      if (!name) return;
      try {
        await upgradeSettlement(name, { actor, settlementId });
      } catch (e) {
        reportCommandFailure("Upgrade settlement", e);
      }
    },
    onRecruitUnits: async (
      actor: number,
      settlementId: SettlementId,
      buildingKind: BuildingKind,
      gx: number,
      gy: number,
      unitTypeId: string,
      count: number,
    ): Promise<void> => {
      const name = opts.gameName();
      if (!name) return;
      try {
        await recruitUnitsCommand(name, { actor, settlementId, buildingKind, gx, gy, unitTypeId, count });
      } catch (e) {
        reportCommandFailure("Recruit units", e);
      }
    },
    onTransferUnits: async (
      actor: number,
      heroId: HeroId,
      settlementId: SettlementId,
      direction: "toHero" | "toGarrison",
      unitTypeId: string,
      count: number,
      toSlot?: number,
    ): Promise<void> => {
      const name = opts.gameName();
      if (!name) return;
      try {
        await transferUnitsCommand(name, { actor, heroId, settlementId, direction, unitTypeId, count, toSlot });
      } catch (e) {
        reportCommandFailure("Transfer units", e);
      }
    },
    onBankGold: async (
      actor: number,
      settlementId: SettlementId,
      gx: number,
      gy: number,
      amount: number,
      direction: "deposit" | "withdraw",
    ): Promise<void> => {
      const name = opts.gameName();
      if (!name) return;
      try {
        await bankGoldCommand(name, { actor, settlementId, gx, gy, amount, direction });
      } catch (e) {
        reportCommandFailure(direction === "deposit" ? "Bank deposit" : "Bank withdrawal", e);
      }
    },
    onSettlementBattleSubmitted: async (payload): Promise<void> => {
      const name = opts.gameName();
      if (!name) return;
      try {
        await submitSettlementBattleResult(name, payload);
      } catch (e) {
        reportCommandFailure("Settlement battle result", e);
      }
    },
    onPlaceBuildings: async (
      actor: number,
      settlementId: SettlementId,
      buildings: BuildingDef[],
      initialLayout?: boolean,
    ): Promise<void> => {
      const name = opts.gameName();
      if (!name) return;
      try {
        await placeBuildingsCommand(name, { actor, settlementId, buildings, initialLayout });
      } catch (e) {
        const applied = takeLastAppliedBuildDelta(settlementId);
        if (applied) opts.onPlaceBuildingsRejected?.(settlementId, applied);
        reportCommandFailure("Place buildings", e);
      }
    },
    pickAiMove: (state: GameState, heroId: HeroId, excludedSettlementIds?: ReadonlySet<string>) => {
      return pickAiMoveBrain(state, heroId, opts.gameMap(), opts.rng, cachedUnitTypes(), excludedSettlementIds);
    },
    pickGarrisonRecruitment: (state: GameState, seat: number) => {
      return pickGarrisonRecruitment(state, seat, cachedUnitTypes());
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
      if (SERVER_APPENDED_AUDIT_KINDS.has(event.type)) return;
      void api.logEvent(name, event.type, event.payload).catch(() => {});
    },
    getMap: () => opts.gameMap(),
    rng: opts.rng,
  };
}

// Single-hero half of mergeBattleOutcomeHeroes, shared with the settlement
// battle flow (GameActions.startSettlementBattleFlow) where there is no
// defender hero to name: absent means delete (row + owner heroIds + selection
// clear), present merges as today. Reference-stable no-op when nothing
// changed.
export function mergeBattleOutcomeHero(
  state: GameState,
  heroId: HeroId,
  hero: HeroState | undefined,
): GameState {
  let heroes = { ...state.heroes };
  let players = state.players;
  let changed = false;
  if (hero) {
    if (heroes[heroId] !== hero) {
      heroes[heroId] = hero;
      changed = true;
    }
  } else {
    const before = state.heroes[heroId];
    if (before) {
      delete heroes[heroId];
      if (players.some((p) => p.id === before.ownerId && p.heroIds.includes(heroId))) {
        players = players.map((p) =>
          p.id === before.ownerId ? { ...p, heroIds: p.heroIds.filter((h) => h !== heroId) } : p,
        );
      }
      changed = true;
    }
  }
  if (!changed) return state;
  const selectedHeroId =
    state.selectedHeroId != null && heroes[state.selectedHeroId] ? state.selectedHeroId : null;
  return { ...state, heroes, players, selectedHeroId };
}

export function mergeBattleOutcomeHeroes(
  state: GameState,
  attackerId: HeroId,
  defenderId: HeroId,
  result: { attackerHero?: HeroState; defenderHero?: HeroState },
): GameState {
  // Hero-outcomes plan W2b: the server omits a hero that died in the battle
  // (defeat → removed server-side). Absent here means delete: drop the local
  // hero row, prune its owner's heroIds, and clear a selection pointing at it
  // (existence-checked like mergeFromEndTurn). Present heroes merge as today.
  let next = mergeBattleOutcomeHero(state, attackerId, result.attackerHero);
  next = mergeBattleOutcomeHero(next, defenderId, result.defenderHero);
  return next;
}

export function mergeFromEndTurn(state: GameState, result: EndTurnResult, localSeat?: PlayerId | null): GameState {
  // The server now runs the whole end-turn pipeline authoritatively
  // (simple next-player advance, or a full round wrap -- see
  // server/app/turnService.ts), so result.activePlayerId/players are
  // always "whoever's turn it is now," not just a round-wrap correction
  // like the old client-authoritative flow needed. Phase kind follows
  // directly from that player's faction, the same rule
  // @heroes/engine's endTurn() (packages/engine/src/turn/phases.ts) uses.
  const nextPlayer = result.players.find((p) => p.id === result.activePlayerId);
  const phase: GameState["phase"] =
    nextPlayer?.faction === "ai"
      ? { kind: "AI_TURN", playerId: result.activePlayerId }
      : { kind: "PLAYER_TURN", playerId: result.activePlayerId };
  // A selection is client-local UI state: keep it while the entity still
  // exists, across every ending player's merge (the AI hand-offs flow
  // through this same hook), so panels survive End Turn and the AI phase.
  // With a known local seat, only the viewer's OWN hero stays selected: a
  // foreign selection leaked into shared state would otherwise render a
  // movement path/trail from a fog-hidden hero's tile. Unknown seat (tests,
  // headless embeds) keeps the legacy existence-only rule.
  const selectedHero = state.selectedHeroId != null ? result.heroes[state.selectedHeroId] : undefined;
  const selectedHeroId =
    selectedHero && (localSeat == null || selectedHero.ownerId === localSeat) ? state.selectedHeroId : null;
  const selectedSettlement = state.selectedSettlementId != null ? result.settlements[state.selectedSettlementId] : undefined;
  const selectedSettlementId = selectedSettlement ? state.selectedSettlementId : null;
  // S2 (logistics-interface-fixes plan §5.8): the routes replace wholesale, so
  // the id counter must re-derive the same way hydration does -- otherwise it
  // can regress below the max persisted id after a missed/self-skipped
  // TradeRouteCreated event and the next create collides.
  const tradeRoutes = result.tradeRoutes ?? state.tradeRoutes;
  const merged: GameState = {
    ...state,
    round: result.round,
    day: result.day,
    activePlayerId: result.activePlayerId,
    players: result.players,
    heroes: result.heroes,
    settlements: result.settlements,
    // Caravans moved server-side this wrap -- the merged routes replace the
    // client's wholesale, same as heroes/settlements.
    tradeRoutes,
    phase,
    selectedHeroId,
    selectedSettlementId,
    dirty: true,
  };
  if (tradeRoutes) merged.nextTradeRouteId = deriveNextTradeRouteId(tradeRoutes);
  return merged;
}
