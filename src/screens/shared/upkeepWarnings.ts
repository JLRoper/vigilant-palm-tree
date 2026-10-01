import type { GameState, PlayerId } from "@heroes/contracts";

// Weekly upkeep shortfalls are otherwise silent: settlement consumption clamps
// at zero, morale decays, and troops desert with no on-screen explanation.
// This module is the pure read-side of that state — DOM-free, so it can be
// unit-tested and reused by the end-turn toast and the panel badges.

/** Whole unpaid weeks an entity must accumulate before troops start deserting. */
export const DESERTION_AFTER_WEEKS = 2;

/** How many offenders a single summary toast names before it just counts them. */
export const UPKEEP_SUMMARY_OFFENDER_LIMIT = 3;

export type UpkeepWarningKind = "hero" | "settlement";

export interface UpkeepWarningRow {
  key: string;
  kind: UpkeepWarningKind;
  label: string;
  daysUnpaid: number;
  weeksUnpaid: number;
  unfedTroops: number;
  unpaidGold: number;
  morale: number;
  deserting: boolean;
  detail: string;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function weeksUntilDesertion(weeksUnpaid: number): string {
  const left = Math.max(0, DESERTION_AFTER_WEEKS - weeksUnpaid);
  return `${left} more week${left === 1 ? "" : "s"}`;
}

function buildDetail(
  unfedTroops: number,
  unpaidGold: number,
  daysUnpaid: number,
  morale: number,
  deserting: boolean,
  weeksUnpaid: number,
): string {
  return [
    `unfed ${plural(unfedTroops, "troop")} (worth ${unpaidGold}g/wk)`,
    `${plural(daysUnpaid, "day")} unpaid`,
    `morale ${Math.round(morale)}%`,
    deserting ? "desertion has started" : `desertion in ${weeksUntilDesertion(weeksUnpaid)}`,
  ].join(" · ");
}

/**
 * Every hero and settlement owned by `seat` that is currently short on upkeep,
 * worst first. Foreign and neutral entities are deliberately excluded — an
 * opponent's unpaid upkeep is not this player's problem, and a neutral
 * settlement has no owner to warn.
 *
 * `seat === null` (the local seat is unknown) yields no rows rather than
 * guessing at ownership.
 */
export function evaluateUpkeepWarnings(state: GameState, seat: PlayerId | null): UpkeepWarningRow[] {
  if (seat === null) return [];
  const rows: UpkeepWarningRow[] = [];

  for (const hero of Object.values(state.heroes)) {
    if (hero.ownerId !== seat) continue;
    const sinceDay = hero.upkeepUnpaidSinceDay;
    if (sinceDay === null) continue;
    const daysUnpaid = Math.max(0, state.day - sinceDay);
    const weeksUnpaid = Math.floor(daysUnpaid / 7);
    const deserting = weeksUnpaid >= DESERTION_AFTER_WEEKS;
    const unfedTroops = hero.upkeepUnpaidTroops;
    const unpaidGold = hero.upkeepUnpaidGold;
    const morale = hero.morale;
    rows.push({
      key: `hero:${hero.id}`,
      kind: "hero",
      label: hero.name,
      daysUnpaid,
      weeksUnpaid,
      unfedTroops,
      unpaidGold,
      morale,
      deserting,
      detail: buildDetail(unfedTroops, unpaidGold, daysUnpaid, morale, deserting, weeksUnpaid),
    });
  }

  for (const settlement of Object.values(state.settlements)) {
    if (settlement.ownerId !== seat) continue;
    const sinceDay = settlement.garrisonUnpaidSinceDay;
    if (sinceDay === null) continue;
    const daysUnpaid = Math.max(0, state.day - sinceDay);
    const weeksUnpaid = Math.floor(daysUnpaid / 7);
    const deserting = weeksUnpaid >= DESERTION_AFTER_WEEKS;
    const unfedTroops = settlement.garrisonUnpaidTroops;
    const unpaidGold = settlement.garrisonUnpaidGold;
    const morale = settlement.morale;
    rows.push({
      key: `settlement:${settlement.id}`,
      kind: "settlement",
      label: settlement.name,
      daysUnpaid,
      weeksUnpaid,
      unfedTroops,
      unpaidGold,
      morale,
      deserting,
      detail: buildDetail(unfedTroops, unpaidGold, daysUnpaid, morale, deserting, weeksUnpaid),
    });
  }

  rows.sort((a, b) =>
    a.deserting === b.deserting ? b.daysUnpaid - a.daysUnpaid : a.deserting ? -1 : 1,
  );
  return rows;
}

/** One-line player-facing explanation for a single offending entity. */
export function upkeepToastMessage(row: UpkeepWarningRow): string {
  if (row.kind === "settlement") {
    const cause =
      `${row.label}: cannot pay garrison upkeep — ${row.unpaidGold}g/wk short, ` +
      `${plural(row.unfedTroops, "troop")} unfed for ${plural(row.daysUnpaid, "day")}.`;
    return row.deserting
      ? `${cause} Morale is falling and garrison troops are deserting.`
      : `${cause} Morale is falling.`;
  }
  const cause =
    `${row.label}: ${plural(row.unfedTroops, "troop")} unfed (${plural(row.daysUnpaid, "day")})` +
    ` — morale ${Math.round(row.morale)}%.`;
  return row.deserting
    ? `${cause} Troops are deserting.`
    : `${cause} Troops desert after ${weeksUntilDesertion(row.weeksUnpaid)}.`;
}

/**
 * Count plus the worst offenders, for when a single turn leaves more unpaid
 * entities than are worth one toast each.
 */
export function upkeepSummaryToastMessage(rows: UpkeepWarningRow[]): string {
  const named = rows.slice(0, UPKEEP_SUMMARY_OFFENDER_LIMIT).map((r) => r.label).join(", ");
  return (
    `Upkeep unpaid at ${rows.length} of your holdings — ${named}. ` +
    `Morale is falling; troops desert after ${plural(DESERTION_AFTER_WEEKS, "unpaid week")}.`
  );
}
