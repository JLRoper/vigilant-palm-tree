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

// Settlement-battle outcome without the legacy draw collapse (B6/D6) --
// structurally the SettlementBattleResolved event's `outcome` field.
export type SettlementBattleOutcomeView = "attackerWon" | "defenderWon" | "draw";

// Winner banner for the event-derived settlement-battle card. A draw is a
// stalemate (the attacker bounces, the garrison holds) -- never the hero
// battle's "both sides fell". `captured === false` on an attackerWon is the
// kept-the-hex-but-didn't-capture edge; the garrison still broke.
export function settlementBattleCardBanner(args: {
  outcome: SettlementBattleOutcomeView;
  captured?: boolean;
  attackerLabel: string;
  settlementName?: string;
}): string {
  const place = args.settlementName ?? "the settlement";
  switch (args.outcome) {
    case "attackerWon":
      return args.captured === false
        ? `${args.attackerLabel} broke the garrison at ${place}!`
        : `${args.attackerLabel} captured ${place}!`;
    case "draw":
      return `Stalemate at ${place}.`;
    default:
      return `The garrison of ${place} holds!`;
  }
}

// Draw wording for the event-derived hero-battle card: a mutual
// annihilation (both sides' verdicts "defeated") keeps the legacy "both
// sides fell" banner; every other draw is a stalemate with real survivors
// standing on both sides.
export function heroBattleDrawBanner(
  attackerVerdict?: HeroBattleVerdict,
  defenderVerdict?: HeroBattleVerdict,
): string {
  return attackerVerdict === "defeated" && defenderVerdict === "defeated"
    ? "Draw — both sides fell."
    : "Draw — both sides stand.";
}

// Info-toast wording for an event-derived settlement-battle outcome: who
// did what to whose garrison, with the attacker's verdict (slain /
// retreated to <name> / surrendered) appended when there is one. Accurate
// for a draw (the garrison holds) and for concessions, which the legacy
// collapsed `winner` cannot express.
export function settlementBattleToastMessage(args: {
  attackerLabel: string;
  settlementName?: string;
  outcome: SettlementBattleOutcomeView;
  captured?: boolean;
  attackerVerdict?: HeroBattleVerdict;
  attackerOwnerName?: string;
}): string {
  const place = args.settlementName ?? "the settlement";
  const phrase = battleVerdictToastPhrase({
    verdict: args.attackerVerdict,
    ownerName: args.attackerOwnerName,
  });
  switch (args.outcome) {
    case "attackerWon":
      return args.captured === false
        ? phrase
          ? `${args.attackerLabel} broke the garrison at ${place} — ${phrase}.`
          : `${args.attackerLabel} broke the garrison at ${place}.`
        : phrase
          ? `${args.attackerLabel} captured ${place} — ${phrase}.`
          : `${args.attackerLabel} captured ${place}.`;
    case "draw":
      return phrase
        ? `The assault on ${place} stalled — ${phrase}; the garrison holds.`
        : `The assault on ${place} stalled — the garrison holds.`;
    default:
      return phrase
        ? `The garrison of ${place} repelled ${args.attackerLabel} — ${phrase}.`
        : `The garrison of ${place} repelled ${args.attackerLabel}.`;
  }
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
