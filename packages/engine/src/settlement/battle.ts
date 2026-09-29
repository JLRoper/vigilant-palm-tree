import type { GameState, HeroBattleVerdict, HeroId, Platoon, SettlementId } from "@heroes/contracts";
import { cleanupDefeatedHeroCharters } from "../charter/cleanup";
import { nearestOwnedSettlement, relocateHeroToSettlement } from "../combat/battleOutcome";
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
  // A NEUTRAL settlement (ownerId null) with a live garrison fights exactly
  // like an enemy-owned one -- only the mover's OWN settlements are excluded.
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

// Attacker verdict for the settlement-battle outcome, hero-outcomes parity
// with the hero-battle mapping (commandHandler's SubmitBattleResult case):
// defenderWon always wipes the attacker, a draw wipes only when the attacker
// submitted zero survivors, retreat/surrender map straight through, and
// attackerWon never defeats the attacker.
export function settlementAttackerVerdict(
  outcome: SettlementBattleOutcome,
  attackerStacks: readonly Platoon[],
): HeroBattleVerdict {
  if (outcome === "retreat") return "retreated";
  if (outcome === "surrender") return "surrendered";
  const wiped =
    outcome === "defenderWon" ||
    (outcome === "draw" && attackerStacks.every((p) => p.entries.length === 0));
  return wiped ? "defeated" : "stood";
}

export interface SettlementBattleResult {
  state: GameState;
  captured: boolean;
  attackerVerdict: HeroBattleVerdict;
  removedHeroIds: HeroId[];
}

export function applySettlementBattleResult(
  state: GameState,
  opts: SettlementBattleResultOptions,
): SettlementBattleResult {
  const hero = state.heroes[opts.attackerId];
  const settlement = state.settlements[opts.settlementId];
  if (!hero || !settlement) {
    return { state, captured: false, attackerVerdict: "stood", removedHeroIds: [] };
  }

  const attackerStacks = normalizePlatoons(opts.attackerStacks);
  let next: GameState = {
    ...state,
    dirty: true,
    heroes: {
      ...state.heroes,
      [opts.attackerId]: { ...hero, stacks: attackerStacks },
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

  // Hero-outcome application (same rules as the hero-battle path): a wiped
  // attacker is removed from the record (owner heroIds pruned, outstanding
  // charter folded while the hero row is still readable); a retreat loses
  // ALL troops and relocates to the nearest owned settlement (staying at the
  // post-cancel position when the owner holds none, plan D1); a surrender
  // relocates keeping its stacks (gold debit already applied above).
  const attackerVerdict = settlementAttackerVerdict(opts.outcome, attackerStacks);
  let removedHeroIds: HeroId[] = [];
  const afterBattle = next.heroes[opts.attackerId];
  if (afterBattle && attackerVerdict === "defeated") {
    next = cleanupDefeatedHeroCharters(next, opts.attackerId);
    const heroes = { ...next.heroes };
    delete heroes[opts.attackerId];
    next = {
      ...next,
      heroes,
      players: next.players.map((p) =>
        p.id === afterBattle.ownerId && p.heroIds.includes(opts.attackerId)
          ? { ...p, heroIds: p.heroIds.filter((id) => id !== opts.attackerId) }
          : p,
      ),
    };
    removedHeroIds = [opts.attackerId];
  } else if (afterBattle && (attackerVerdict === "retreated" || attackerVerdict === "surrendered")) {
    const battleHero =
      attackerVerdict === "retreated"
        ? { ...afterBattle, stacks: normalizePlatoons([]), troops: 0 }
        : afterBattle;
    const nearest = nearestOwnedSettlement(next, battleHero);
    const settled = nearest ? relocateHeroToSettlement(battleHero, nearest) : battleHero;
    next = {
      ...next,
      heroes: { ...next.heroes, [opts.attackerId]: settled },
    };
  }
  next = endBattlePhase(next);
  return { state: next, captured, attackerVerdict, removedHeroIds };
}
