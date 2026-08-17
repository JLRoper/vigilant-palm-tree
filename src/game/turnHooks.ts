import { api } from "../io/api";
import {
  endTurn,
  spendMovement,
  resolveBattle,
  transferGold,
  tradeResources,
  recruitHero,
  upgradeTownHall,
  setAutoTrade,
  reorderStack,
  captureSettlement,
} from "../io/commands";
import type { EndTurnResult } from "../io/commands";
import type { GameState, HeroId, SettlementId, TransferDirection, WarehouseResource } from "@heroes/contracts";
import type { TurnControllerHooks } from "../state/turnController";
import type { BattleResult } from "@heroes/engine";
import { pickAiMove as pickAiMoveBrain } from "../ai/aiBrain";
import type { GameMap } from "../map/gameMap";
import type { Axial } from "../core/hex";
import { getMultiplayerSync } from "../io/multiplayerSync";
import { settings, type HorseVariant } from "../state/settings";

export interface BuildTurnHooksOptions {
  gameName: () => string | null;
  gameMap: () => GameMap;
  rng: () => number;
  logToConsole?: boolean;
}

let lastBattle: { attackerId: HeroId; defenderId: HeroId } | null = null;

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
        const merged = mergeFromEndTurn(state, result);
        sync.start(name);
        return merged;
      } catch (e) {
        console.warn("[turnHooks] endTurn failed:", e);
        sync.start(name);
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
          actor: hero.ownerId,
          heroId,
          fromTile: { q: hero.previousQ ?? hero.q, r: hero.previousR ?? hero.r },
          toTile,
          cost: previousCost > 0 ? previousCost : 1,
        });
      } catch (e) {
        console.warn("[turnHooks] spendMovement failed:", e);
      }
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
        console.warn("[turnHooks] onHumanMove/spendMovement failed:", e);
      }
    },
    onBattleResolved: async (
      state: GameState,
    ): Promise<{ state: GameState; battle: BattleResult | null }> => {
      const cached = lastBattle;
      lastBattle = null;
      const name = opts.gameName();
      if (!name || !cached) return { state, battle: null };
      const attackerHeroBefore = state.heroes[cached.attackerId];
      if (!attackerHeroBefore) return { state, battle: null };
      try {
        // No longer sends the client's GameState at all (Phase 3 Track A
        // Week 3+) -- the server loads its own row and its own unit_types
        // catalog (see server/app/commandHandler.ts's ResolveBattle case),
        // so this only needs to carry who's attacking whom and on whose
        // behalf.
        const result = await resolveBattle(name, {
          actor: attackerHeroBefore.ownerId,
          attackerId: cached.attackerId,
          defenderId: cached.defenderId,
        });
        return {
          state: {
            ...state,
            heroes: {
              ...state.heroes,
              [cached.attackerId]: result.attackerHero,
              [cached.defenderId]: result.defenderHero,
            },
          },
          battle: result.battle,
        };
      } catch (e) {
        console.warn("[turnHooks] resolveBattle failed:", e);
        return { state, battle: null };
      }
    },
    onTradeResources: async (
      actor: number,
      fromSettlementId: SettlementId,
      toSettlementId: SettlementId,
      resource: WarehouseResource,
      amount: number,
    ): Promise<void> => {
      const name = opts.gameName();
      if (!name || resource === "food") return;
      try {
        await tradeResources(name, { actor, fromSettlementId, toSettlementId, resource, amount });
      } catch (e) {
        console.warn("[turnHooks] tradeResources failed:", e);
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
        console.warn("[turnHooks] recruitHero failed:", e);
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
        console.warn("[turnHooks] upgradeTownHall failed:", e);
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
        console.warn("[turnHooks] setAutoTrade failed:", e);
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
        console.warn("[turnHooks] reorderStack failed:", e);
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
        console.warn("[turnHooks] captureSettlement failed:", e);
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
        console.warn("[turnHooks] transferGold failed:", e);
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
    getMap: () => opts.gameMap(),
    rng: opts.rng,
  };
}

function mergeFromEndTurn(state: GameState, result: EndTurnResult): GameState {
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
  return {
    ...state,
    round: result.round,
    day: result.day,
    activePlayerId: result.activePlayerId,
    players: result.players,
    heroes: result.heroes,
    settlements: result.settlements,
    phase,
    selectedHeroId: null,
    selectedSettlementId: null,
    dirty: true,
  };
}
