// Per-hero battle-outcome wording (hero-outcomes plan W2b): the card line and
// toast phrase for a side's `HeroBattleVerdict`, plus settlement-name lookup at
// a relocated hero's position. Pure, no DOM, so it is unit-testable under
// node:test (test/combat/battleResultText.test.ts).

import type { HeroBattleVerdict, SettlementState } from "@heroes/contracts";

export interface BattleVerdictSide {
  verdict?: HeroBattleVerdict;
  ownerName?: string;
  settlementName?: string;
}

// One per-side line under the result card's winner banner. "stood" (and an
// absent verdict — pre-W1 servers) render nothing; a stalemate keeps the
// card's existing wording.
export function battleVerdictCardLine(
  label: string,
  verdict: HeroBattleVerdict | undefined,
  settlementName?: string,
): string | null {
  switch (verdict) {
    case "defeated":
      return `${label} was slain.`;
    case "retreated":
      return settlementName ? `${label} retreated to ${settlementName}.` : `${label} retreated.`;
    case "surrendered":
      return settlementName
        ? `${label} surrendered to ${settlementName}.`
        : `${label} surrendered.`;
    default:
      return null;
  }
}

// Terser per-side phrase for the AI-battle info toast ("AI 2's hero slain").
export function battleVerdictToastPhrase(side: BattleVerdictSide): string | null {
  if (!side.verdict) return null;
  const who = side.ownerName ? `${side.ownerName}'s hero` : "hero";
  switch (side.verdict) {
    case "defeated":
      return `${who} slain`;
    case "retreated":
      return side.settlementName ? `${who} retreated to ${side.settlementName}` : `${who} retreated`;
    case "surrendered":
      return side.settlementName
        ? `${who} surrendered to ${side.settlementName}`
        : `${who} surrendered`;
    default:
      return null;
  }
}

export function battleToastMessage(args: {
  attackerLabel: string;
  defenderLabel: string;
  winner: "attacker" | "defender" | "draw";
  attacker?: BattleVerdictSide;
  defender?: BattleVerdictSide;
}): string {
  const phrases = [
    battleVerdictToastPhrase(args.attacker ?? {}),
    battleVerdictToastPhrase(args.defender ?? {}),
  ].filter((p): p is string => p !== null);
  const suffix = phrases.length > 0 ? ` — ${phrases.join("; ")}` : "";
  if (args.winner === "draw") {
    return `${args.attackerLabel} vs ${args.defenderLabel}: both sides fell${suffix}.`;
  }
  const winner = args.winner === "attacker" ? args.attackerLabel : args.defenderLabel;
  const loser = args.winner === "attacker" ? args.defenderLabel : args.attackerLabel;
  return `${winner} defeated ${loser}${suffix}.`;
}

// Name of the settlement sitting on a hex — the relocated hero's new q/r after
// a retreat/surrender (resolved AFTER merging, from the caller's merged state).
export function settlementNameAt(
  settlements: Record<string, SettlementState>,
  q: number,
  r: number,
): string | undefined {
  for (const s of Object.values(settlements)) {
    if (s.q === q && s.r === r) return s.name;
  }
  return undefined;
}
