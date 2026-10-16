// Pure decision for who resolves a BATTLE phase. Replaces the old `pvp`
// predicate whose else-branch (`!localIsAttacker && defenderOwnerIsHuman`)
// mis-classified "AI attacks the local human" as PvP and silently
// auto-resolved it: the local defender now gets the same Fight / Quick
// Resolve modal an attacker gets, minus Flee (fleeing cancels the ATTACKER's
// move, so it is not a defender choice).
export interface BattleChoiceContext {
  localIsAttacker: boolean;
  localIsDefender: boolean;
  serverDriven: boolean;
}

export type BattleChoicePlan =
  | { kind: "spectate" } // someone else's server-offered battle; wait for the resolution event
  | { kind: "modal"; hideFlee: boolean } // the local seat picks how to fight
  | { kind: "autoResolve" }; // silent server auto-resolver (driving client for AI-vs-AI / remote PvP)

export function resolveBattleChoice(ctx: BattleChoiceContext): BattleChoicePlan {
  if (ctx.serverDriven && !ctx.localIsAttacker && !ctx.localIsDefender) {
    return { kind: "spectate" };
  }
  if (ctx.localIsAttacker) return { kind: "modal", hideFlee: false };
  if (ctx.localIsDefender) return { kind: "modal", hideFlee: true };
  return { kind: "autoResolve" };
}
