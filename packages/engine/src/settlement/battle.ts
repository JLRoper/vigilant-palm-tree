import type { GameState, HeroBattleVerdict, HeroId, Platoon, SettlementId } from "@heroes/contracts";
import { cleanupDefeatedHeroCharters } from "../charter/cleanup";
import { applyHeroConcession } from "../combat/battleOutcome";
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

// Settlement-battle outcome of an auto-resolved assault: an attacker hero
// retreat (the "outmatched" policy) is a "retreat", otherwise the winner
// decides. The garrison never retreats.
export function settlementOutcomeFromBattle(battle: {
  winner: "attacker" | "defender" | "draw";
  attackerOutcome: string;
}): SettlementBattleOutcome {
  if (battle.attackerOutcome === "retreated_hero") return "retreat";
  return battle.winner === "attacker" ? "attackerWon" : battle.winner === "defender" ? "defenderWon" : "draw";
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
  } else {
    // Every non-capture outcome keeps the garrison's survivors — including a
    // retreat/surrender, where the garrison still took the battle's losses.
    next = {
      ...next,
      settlements: {
        ...next.settlements,
        [opts.settlementId]: { ...settlement, stacks: normalizePlatoons(opts.defenderStacks) },
      },
    };
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
  // charter folded while the hero row is still readable); a retreat keeps
  // only its starting-edge escapees (already the submitted stacks) and a
  // surrender keeps its stacks (gold debit already applied above) — both
  // relocate via applyHeroConcession, and a retreat stuns the hero.
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
    next = {
      ...next,
      heroes: { ...next.heroes, [opts.attackerId]: applyHeroConcession(afterBattle, attackerVerdict, next, next.day) },
    };
  }
  next = endBattlePhase(next);
  return { state: next, captured, attackerVerdict, removedHeroIds };
}
