import type { GameState, PlayerId, SettlementState, WarehouseResource } from "@heroes/contracts";
import { WAREHOUSE_RESOURCES } from "@heroes/contracts";
import { buildingPlacementCost, buildingSettlementEffects, settlementResourceCap } from "@heroes/engine";
import { TREASURY_CAP_AMBER } from "./treasuryCap";

// E2 (playthrough round 2b): the WAREHOUSE half of the cap the treasury already
// announces. `addStockClamped` drops every unit of production that does not fit
// under the store cap, silently, while the panel goes on printing the rate the
// settlement produces at -- so a store pinned at 500 read "+26.36/day" and never
// moved (measured on the round-2b Gold hold at 498/500 wood: three turns, three
// 496s). The treasury equivalent was closed in this file's sibling
// (treasuryCap.ts): an amber row, a tooltip sentence, and ONE transition toast.
// This module is the same three things for the five store resources, on the same
// seam (a pure, DOM-free read side both panels and the End Turn toast share).
//
// The warning hue is deliberately the SAME constant as the treasury's: a
// degraded readout should look like every other degraded readout, not like a
// second colour the player has to learn.

export const WAREHOUSE_CAP_AMBER = TREASURY_CAP_AMBER;

/** How many capped resources a single summary toast names before it just counts them. */
export const WAREHOUSE_CAP_SUMMARY_OFFENDER_LIMIT = 3;

/** One capped (settlement, resource) pair, in WAREHOUSE_RESOURCES order within a settlement. */
export interface WarehouseCapRow {
  settlement: SettlementState;
  resource: WarehouseResource;
}

/**
 * This resource is at (or above) its store cap, so the next turn's production of
 * it will be discarded. `>=` rather than `>`, matching warehouseHeadroom and the
 * treasury's own predicate: a store sitting exactly on its cap already has zero
 * headroom, and stock ABOVE the cap is a legacy-save shape (caps never claw
 * stock back) that is equally stuck.
 */
export function warehouseResourceCapped(settlement: SettlementState, resource: WarehouseResource): boolean {
  return (settlement.warehouse[resource] ?? 0) >= settlementResourceCap(settlement)[resource];
}

/** Every capped store in this settlement, in the warehouse's own order. */
export function cappedWarehouseResources(settlement: SettlementState): WarehouseResource[] {
  return WAREHOUSE_RESOURCES.filter((r) => warehouseResourceCapped(settlement, r));
}

function resourceLabel(resource: WarehouseResource): string {
  return resource.charAt(0).toUpperCase() + resource.slice(1);
}

/**
 * What raises this store's cap, read from the registry so the numbers cannot
 * drift from the buildings that pay them (`buildingSettlementEffects` scales
 * `storageBonus` by level; `granary` is the food-only one, `warehouse` covers
 * all five).
 */
export function capBuildingHint(resource: WarehouseResource): string {
  const warehouseBonus = buildingSettlementEffects("warehouse", 1).storageBonus?.[resource] ?? 0;
  const granaryBonus = buildingSettlementEffects("granary", 1).storageBonus?.[resource] ?? 0;
  const parts: string[] = [];
  if (warehouseBonus > 0) {
    parts.push(`a Warehouse (+${warehouseBonus.toLocaleString()} per level, ${(buildingPlacementCost("warehouse").gold ?? 0).toLocaleString()}g each)`);
  }
  if (granaryBonus > 0) {
    parts.push(`a Granary (+${granaryBonus.toLocaleString()} per level, ${(buildingPlacementCost("granary").gold ?? 0).toLocaleString()}g each)`);
  }
  return parts.length > 0 ? parts.join(" or ") : "a storage building";
}

/**
 * The one explanation shared by the row tooltip and the one-time toast.
 * `produced` is what the turn would add this resource for (the panel's own
 * per-day figure) and is named only when it is known and positive -- the
 * sentence never invents a number the caller did not measure.
 */
export function warehouseCapMessage(
  settlement: SettlementState,
  resource: WarehouseResource,
  produced?: number,
): string {
  const cap = settlementResourceCap(settlement)[resource];
  const held = settlement.warehouse[resource] ?? 0;
  const label = resourceLabel(resource);
  const loss =
    produced !== undefined && produced > 0
      ? `the ${produced.toLocaleString()}/day it receives is being discarded`
      : "anything more it receives is discarded";
  return (
    `${label} is at its ${cap.toLocaleString()} store cap (${held.toLocaleString()} held), so ${loss} ` +
    `until you spend some or raise the cap by building ${capBuildingHint(resource)}.`
  );
}

/** The same sentence with the settlement named, for the toast surface. */
export function warehouseCapToastMessage(row: WarehouseCapRow, produced?: number): string {
  return `${row.settlement.name}: ${warehouseCapMessage(row.settlement, row.resource, produced)}`;
}

/** Count plus the first few names, for a turn that caps more stores than are worth a toast each. */
export function warehouseCapSummaryToastMessage(rows: WarehouseCapRow[]): string {
  const named = rows
    .slice(0, WAREHOUSE_CAP_SUMMARY_OFFENDER_LIMIT)
    .map((row) => `${row.settlement.name} ${row.resource}`)
    .join(", ");
  return (
    `Store full at ${rows.length} of your stockpiles — ${named}. ` +
    `Production is being discarded; a Warehouse or Granary raises the cap.`
  );
}

/**
 * The player's own settlements' capped stores, in settlement-id order then
 * warehouse order. Foreign and neutral settlements are excluded exactly as
 * `cappedSettlements` does: an opponent's discarded production is not this
 * player's problem. `seat === null` yields nothing rather than guessing.
 */
export function cappedWarehouseResourcesOf(state: GameState, seat: PlayerId | null): WarehouseCapRow[] {
  if (seat === null) return [];
  return Object.values(state.settlements)
    .filter((s) => s.ownerId === seat)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .flatMap((s) => cappedWarehouseResources(s).map((resource) => ({ settlement: s, resource })));
}

/**
 * The stores that CROSSED into their cap between `prev` and `next` -- the
 * transition, not the level, so a store pinned for ten turns yields one row on
 * the turn it arrived (and one more if it is drained below and re-caps later).
 * `prev === null` means nothing is known about the prior state, so every capped
 * store counts as newly capped.
 */
export function newlyCappedWarehouseResources(
  prev: GameState | null,
  next: GameState,
  seat: PlayerId | null,
): WarehouseCapRow[] {
  if (seat === null) return [];
  const wasCapped = new Set<string>();
  if (prev) {
    for (const row of cappedWarehouseResourcesOf(prev, seat)) wasCapped.add(`${row.settlement.id}:${row.resource}`);
  }
  return cappedWarehouseResourcesOf(next, seat).filter(
    (row) => !wasCapped.has(`${row.settlement.id}:${row.resource}`),
  );
}

// The per-session dedupe, the tradeNeedsReminder.ts / treasuryCap.ts pattern: a
// store that oscillates around its cap (a caravan delivery, a weekly upkeep
// bill, a build) would re-cross the transition every cycle, so each store toasts
// ONCE per session while it stays capped and is re-armed only when it is
// observed below its cap. A module-level Set dies with the page, so there is no
// bookkeeping to reset on game load; the session key scopes ids so two games
// played in one session never suppress each other's first toast.
// `resetWarehouseCapDedupe` exists for tests and nothing else.
const toastedSessionKeys = new Set<string>();

export function resetWarehouseCapDedupe(): void {
  toastedSessionKeys.clear();
}

function capDedupeKey(sessionKey: string | null, settlementId: string, resource: WarehouseResource): string {
  const key = `${settlementId}:${resource}`;
  return sessionKey === null ? key : `${sessionKey}:${key}`;
}

/**
 * Filters the transition rows down to the ones this session has not toasted yet,
 * marks what it returns, and releases every own store observed below cap in
 * `next` so a later re-cap can toast again. Compose AFTER
 * newlyCappedWarehouseResources in the toast caller.
 */
export function applyWarehouseCapSessionDedupe(
  sessionKey: string | null,
  next: GameState,
  seat: PlayerId | null,
  rows: WarehouseCapRow[],
): WarehouseCapRow[] {
  if (seat !== null) {
    // A store observed BELOW its cap re-arms: the toast is about crossing into
    // the cap, not about staying there.
    for (const settlement of Object.values(next.settlements)) {
      if (settlement.ownerId !== seat) continue;
      for (const resource of WAREHOUSE_RESOURCES) {
        if (!warehouseResourceCapped(settlement, resource)) {
          toastedSessionKeys.delete(capDedupeKey(sessionKey, settlement.id, resource));
        }
      }
    }
  }
  const out = rows.filter((row) => !toastedSessionKeys.has(capDedupeKey(sessionKey, row.settlement.id, row.resource)));
  for (const row of out) toastedSessionKeys.add(capDedupeKey(sessionKey, row.settlement.id, row.resource));
  return out;
}
