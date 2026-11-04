import type { SettlementState } from "@heroes/contracts";
import { treasuryCapBlockerMessage, treasuryCapBlocksGold } from "./treasuryCap";

// Why an upgrade control is dead, as data.
//
// The town hall's own menu offered `L3: 5000g 40w 25s / 12d` with an `Upgrade`
// button that was `disabled` and carried NO `title` at all, so the only thing
// on screen was a dead control: the round-2 city-view card (F-2) measured
// exactly that (`disabled: true`, `title: ""`) at a level-1 settlement whose
// treasury cap is 1,500g. The build palette has answered this question for its
// own rows since 0.38.x -- `buildEntryStatus` joins one `Not enough <resource>
// (need N, have M)` line per missing resource into the row's `title` -- and
// this module is the same vocabulary for the upgrade controls, so a player
// reads one refusal language everywhere a control can be dead.
//
// The cap half is the reason this is not just a shortfall list. A level-2
// settlement's base cap is 4,000g while the town hall's L2->L3 offer costs
// 5,000g and the settlement's own L2->L3 costs 15,000g (F-6, the unwritten half
// of the same coin): income is discarded at the cap, so those prices are
// unreachable by waiting, and telling the player "need 5,000, have 4,000" would
// be asking for something the base cap forbids. When the cap is the blocker the
// refusal says so and names the way out (a Bank or Treasury), and the two
// sentences are never mixed up. A level-1 settlement has no such way out, so its
// base cap carries the prices its level offers and it never sees this sentence.

/** The cost fields an upgrade control prices: the same keys `buildingUpgradeCost` / `SETTLEMENT_UPGRADE_COSTS` carry. */
export interface UpgradeCostLike {
  gold: number;
  wood?: number;
  stone?: number;
  iron?: number;
  arcane?: number;
}

export interface UpgradeGateOptions {
  settlement: SettlementState;
  cost: UpgradeCostLike;
  /** A settlement-level upgrade is already running; the engine refuses a second one. */
  inProgress?: boolean;
  /** Reasons the caller already knows (a building still constructing, a level gate). */
  extra?: string[];
}

type CostResource = "wood" | "stone" | "iron" | "arcane";

const RESOURCE_LABELS: Array<[CostResource, string]> = [
  ["wood", "wood"],
  ["stone", "stone"],
  ["iron", "iron"],
  ["arcane", "arcane"],
];

/**
 * One line per resource the settlement cannot cover right now, in the build
 * palette's own shape (`buildEntryStatus.buildEntryStatus`): plain numbers, the
 * palette's exact wording, so the two refusal surfaces read the same.
 */
export function upgradeShortfallLines(settlement: SettlementState, cost: UpgradeCostLike): string[] {
  const lines: string[] = [];
  if (cost.gold > settlement.gold) {
    lines.push(`Not enough gold (need ${cost.gold}, have ${settlement.gold})`);
  }
  for (const [key, label] of RESOURCE_LABELS) {
    const need = cost[key] ?? 0;
    if (need <= 0) continue;
    const have = settlement.warehouse[key] ?? 0;
    if (need > have) lines.push(`Not enough ${label} (need ${need}, have ${have})`);
  }
  return lines;
}

/**
 * Everything standing between the settlement and this upgrade. The cap sentence
 * is appended only when the price is above the cap AND the settlement is
 * actually short of the gold: with the gold already in hand the cap is not what
 * is blocking the control, so naming it would be noise.
 */
export function upgradeRefusalReasons(opts: UpgradeGateOptions): string[] {
  const reasons = upgradeShortfallLines(opts.settlement, opts.cost);
  if (opts.inProgress) reasons.push("An upgrade is already in progress");
  if (opts.extra) reasons.push(...opts.extra);
  const shortOfGold = opts.cost.gold > opts.settlement.gold;
  if (reasons.length > 0 && shortOfGold && treasuryCapBlocksGold(opts.settlement, opts.cost.gold)) {
    reasons.push(treasuryCapBlockerMessage(opts.settlement, opts.cost.gold));
  }
  return reasons;
}

/** The `title` a blocked upgrade control carries; "" when nothing blocks it. */
export function upgradeRefusalTitle(opts: UpgradeGateOptions): string {
  return upgradeRefusalReasons(opts).join("\n");
}

/** True when the settlement cannot start this upgrade at all right now. */
export function upgradeBlocked(opts: UpgradeGateOptions): boolean {
  return upgradeRefusalReasons(opts).length > 0;
}
