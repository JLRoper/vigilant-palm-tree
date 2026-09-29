// D4 display policy (plan/2026-09-29-ai-enemies.md): AI-vs-AI auto-resolved
// battles are SILENT -- no result card at all, an info toast at most. A
// result card shows only when the local human's hero was the attacker or the
// defender. Pure decision, no DOM, so it is unit-testable under node:test.

export function shouldShowResultCard(
  localSeat: number | null,
  attackerOwner: number,
  defenderOwner: number,
): boolean {
  if (localSeat === null) return false;
  return attackerOwner === localSeat || defenderOwner === localSeat;
}
