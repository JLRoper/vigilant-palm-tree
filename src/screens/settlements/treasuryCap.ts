import type { GameState, PlayerId, SettlementState } from "@heroes/contracts";
import { settlementTreasuryCap } from "@heroes/engine";

// A full treasury is a deliberate progression gate, but nothing on screen said
// so: applyEffectiveIncome pays Math.min(income, headroom), so at the cap the
// whole gold income vanishes with no event, no toast and no HUD change -- the
// player sees a gold rate in the panel next to a purse that never moves.
//
// This module is the pure read-side of that state (the bankRows.ts /
// upkeepWarnings.ts seam): the predicate both settlement panels colour with,
// the copy that explains it, and the previous-state comparison that turns
// "capped" into a one-time "just became capped" for the end-turn toast.

// The codebase's established warning amber, from hpColor() (arena/layout.ts,
// platoonInfoPopup.ts) and the inline stat rows in openManualBattleArena.ts:
// green -> amber -> red as a value degrades. Reusing it keeps a "this value is
// being wasted" readout looking like every other degraded-stat readout instead
// of introducing a second warning hue.
export const TREASURY_CAP_AMBER = "#ffb300";

/** How many settlements a single summary toast names before it just counts them. */
export const TREASURY_CAP_SUMMARY_OFFENDER_LIMIT = 3;

/**
 * Gold is at (or above) the cap, so the next turn's income will be discarded.
 * `>=` rather than `>`, matching treasuryHeadroom: a purse sitting exactly on
 * its cap already has zero headroom and already discards income. Gold ABOVE the
 * cap is a legacy-save shape (caps never claw gold back) and is equally stuck,
 * so it counts too.
 */
export function treasuryCapped(settlement: SettlementState): boolean {
  return settlement.gold >= settlementTreasuryCap(settlement);
}

/** The one explanation shared by the row tooltip and the one-time toast. */
export function treasuryCapMessage(settlement: SettlementState): string {
  const cap = settlementTreasuryCap(settlement);
  return (
    `Treasury full — it holds ${settlement.gold.toLocaleString()}g of its ${cap.toLocaleString()}g cap, ` +
    `so gold income is being discarded until you build a Bank or Treasury (which raise the cap).`
  );
}

/** The same sentence with the settlement named, for the toast surface. */
export function treasuryCapToastMessage(settlement: SettlementState): string {
  return `${settlement.name}: ${treasuryCapMessage(settlement)}`;
}

/** Count plus the first few names, for when one turn caps more holdings than are worth a toast each. */
export function treasuryCapSummaryToastMessage(settlements: SettlementState[]): string {
  const named = settlements
    .slice(0, TREASURY_CAP_SUMMARY_OFFENDER_LIMIT)
    .map((s) => s.name)
    .join(", ");
  return (
    `Treasury full at ${settlements.length} of your settlements — ${named}. ` +
    `Gold income is being discarded; build a Bank or Treasury to raise the cap.`
  );
}

/**
 * The player's own settlements that are at their cap. Foreign and neutral
 * settlements are deliberately excluded, same as evaluateUpkeepWarnings: an
 * opponent's discarded income is not this player's problem, and a neutral
 * settlement has no owner to warn. `seat === null` (unknown local seat) yields
 * nothing rather than guessing at ownership.
 */
export function cappedSettlements(state: GameState, seat: PlayerId | null): SettlementState[] {
  if (seat === null) return [];
  return Object.values(state.settlements).filter(
    (s) => s.ownerId === seat && treasuryCapped(s),
  );
}

/**
 * Settlements that CROSSED into the cap between `prev` and `next` — the
 * transition, not the level. Comparing two states is what makes the toast
 * genuinely one-time: a settlement sitting at its cap for ten turns yields one
 * row on the turn it arrived, and un-caps and re-caps later it yields one more.
 *
 * `prev === null` means "nothing known about the prior state", so every capped
 * settlement counts as newly capped — the honest reading when there is no
 * evidence either way. Passing the same state twice yields nothing, which is the
 * correct answer for a failed end-turn that changed nothing.
 *
 * Deriving from the previous state rather than a module-level `Set` of toasted
 * ids means there is no "already toasted" state to reset on game load, and no
 * re-toast after a reload: the previous state IS the record, and it is
 * recomputed from the game every time.
 */
export function newlyCappedSettlements(
  prev: GameState | null,
  next: GameState,
  seat: PlayerId | null,
): SettlementState[] {
  if (seat === null) return [];
  const wasCapped = new Set<string>();
  if (prev) {
    for (const s of cappedSettlements(prev, seat)) wasCapped.add(s.id);
  }
  return cappedSettlements(next, seat).filter((s) => !wasCapped.has(s.id));
}

// E1(a) (logistics-interface-fixes plan §3/§5.8): the transition rows above
// still re-toast whenever a capped treasury oscillates — weekly route upkeep
// or a bank deposit drops it below the cap, the next turn's income refills
// it, and the "just became capped" comparison fires again every cycle. This
// per-session guard (the tradeNeedsReminder.ts pattern) lets each settlement
// toast ONCE while it stays at cap; its id is released only when the treasury
// is observed below cap, so a genuinely new crossing toasts again. A
// module-level Set dies with the page, so there is no bookkeeping to reset on
// game load; the session key scopes ids so two games played in one session
// never suppress each other's first toast. `resetTreasuryCapDedupe` exists
// for tests and nothing else.
const toastedSessionKeys = new Set<string>();

export function resetTreasuryCapDedupe(): void {
  toastedSessionKeys.clear();
}

function capDedupeKey(sessionKey: string | null, settlementId: string): string {
  return sessionKey === null ? settlementId : `${sessionKey}:${settlementId}`;
}

/**
 * Filters the transition rows down to the ones this session has not toasted
 * yet, marks what it returns, and releases every OWN settlement observed
 * below cap in `next` so a later re-cap can toast again. Compose AFTER
 * newlyCappedSettlements in the toast caller.
 */
export function applyTreasuryCapSessionDedupe(
  sessionKey: string | null,
  next: GameState,
  seat: PlayerId | null,
  rows: SettlementState[],
): SettlementState[] {
  if (seat !== null) {
    for (const s of Object.values(next.settlements)) {
      if (s.ownerId === seat && !treasuryCapped(s)) toastedSessionKeys.delete(capDedupeKey(sessionKey, s.id));
    }
  }
  const out = rows.filter((s) => !toastedSessionKeys.has(capDedupeKey(sessionKey, s.id)));
  for (const s of out) toastedSessionKeys.add(capDedupeKey(sessionKey, s.id));
  return out;
}