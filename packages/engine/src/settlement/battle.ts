import type { GameState, HeroId, Platoon, SettlementId } from "@heroes/contracts";
import { cancelMove } from "../hero/move";
import { endBattlePhase } from "../turn/phases";
import { normalizePlatoons, platoonsHaveTroops, settlementStacks } from "../units";
import { captureSettlement } from "./capture";

export function startSettlementBattle(
  state: GameState,
  attackerId: HeroId,
  settlementId: SettlementId,
): { state: GameState; ok: boolean; reason: string } {
  const hero = state.heroes[attackerId];
  const settlement = state.settlements[settlementId];
  if (!hero) return { state, ok: false, reason: "no_hero" };
  if (!settlement) return { state, ok: false, reason: "no_settlement" };
  if (settlement.ownerId === null) return { state, ok: false, reason: "unowned_settlement" };
  if (settlement.ownerId === hero.ownerId) {
    return { state, ok: false, reason: "not_enemy_settlement" };
  }
  if (hero.q !== settlement.q || hero.r !== settlement.r) {
    return { state, ok: false, reason: "hero_not_at_settlement" };
  }
  if (!platoonsHaveTroops(settlementStacks(settlement))) {
    return { state, ok: false, reason: "garrison_empty" };
  }
  return {
    state: {
      ...state,
      phase: { kind: "SETTLEMENT_BATTLE", attackerId, settlementId },
      dirty: true,
    },
    ok: true,
    reason: "",
  };
}

export type SettlementBattleOutcome = "attackerWon" | "defenderWon" | "draw" | "retreat" | "surrender";

export interface SettlementBattleResultOptions {
  attackerId: HeroId;
  settlementId: SettlementId;
  outcome: SettlementBattleOutcome;
  attackerStacks: Platoon[];
  defenderStacks: Platoon[];
  surrenderedGold?: number;
}

export function applySettlementBattleResult(
  state: GameState,
  opts: SettlementBattleResultOptions,
): { state: GameState; captured: boolean } {
  const hero = state.heroes[opts.attackerId];
  const settlement = state.settlements[opts.settlementId];
  if (!hero || !settlement) return { state, captured: false };

  let next: GameState = {
    ...state,
    dirty: true,
    heroes: {
      ...state.heroes,
      [opts.attackerId]: { ...hero, stacks: normalizePlatoons(opts.attackerStacks) },
    },
  };
  let captured = false;
  if (opts.outcome === "attackerWon") {
    next = {
      ...next,
      settlements: {
        ...next.settlements,
        [opts.settlementId]: { ...settlement, stacks: normalizePlatoons([]) },
      },
    };
    const capture = captureSettlement(next, opts.attackerId, opts.settlementId);
    next = capture.state;
    captured = capture.captured;
  } else if (opts.outcome === "defenderWon" || opts.outcome === "draw") {
    next = {
      ...next,
      settlements: {
        ...next.settlements,
        [opts.settlementId]: { ...settlement, stacks: normalizePlatoons(opts.defenderStacks) },
      },
    };
    next = cancelMove(next, opts.attackerId);
  } else {
    next = cancelMove(next, opts.attackerId);
    const surrenderedGold = opts.surrenderedGold ?? 0;
    if (opts.outcome === "surrender" && surrenderedGold > 0) {
      const conceded = next.heroes[opts.attackerId];
      if (conceded) {
        next = {
          ...next,
          heroes: {
            ...next.heroes,
            [opts.attackerId]: { ...conceded, gold: Math.max(0, conceded.gold - surrenderedGold) },
          },
        };
      }
    }
  }
  next = endBattlePhase(next);
  return { state: next, captured };
}
