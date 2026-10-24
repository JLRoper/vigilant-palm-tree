import { hexDistance, type GameState, type SettlementId } from "@heroes/contracts";

// Founding a settlement in settlers mode (SETTLERS-PLAN.md §2, §4 W2).
//
// Phase 0 lands the SEAM only: the types, the ONE refusal vocabulary the
// engine, the server and the UI sentence all share, and two signature-only
// stubs that throw. No rule is implemented here.

/**
 * Why founding was refused. ONE vocabulary: the engine returns these strings,
 * the server relays them, and the client shows the sentence it maps to -- a
 * second spelling anywhere is how the panel and the rule drift apart.
 *
 * - `not_settlers_mode` -- the game is classic; founding goes through the
 *   charter path instead.
 * - `founder_not_at_tile` -- the founding wagon/hero is not standing on the
 *   target hex.
 * - `tile_impassable` -- the target hex cannot hold a settlement (water,
 *   dense forest, a river, a resource deposit's own rules).
 * - `occupied` -- a settlement already stands on the target hex.
 * - `too_close_to_settlement` -- within `minFoundingDistance` of a settlement,
 *   neutral castles included (design answer 2).
 */
export const FOUND_SETTLEMENT_REFUSALS = [
  "not_settlers_mode",
  "founder_not_at_tile",
  "tile_impassable",
  "occupied",
  "too_close_to_settlement",
] as const;

// Derived from the array, never hand-spelled beside it (the MAP_SIZE_ORDER
// precedent): one list to extend, one list for a test to pin.
export type FoundSettlementRefusal = (typeof FOUND_SETTLEMENT_REFUSALS)[number];

export interface FoundSettlementRequest {
  state: GameState;
  /**
   * The founding entity (the wagon/hero), by id. Also the id its start was
   * placed with, so `settlersStreamRng(seed, founderId)` replays it.
   */
  founderId: string;
  /** The target hex. */
  q: number;
  r: number;
}

export type FoundSettlementResult =
  | {
      ok: true;
      state: GameState;
      settlementId: SettlementId;
      /** True when the founder was consumed (design answer 1). */
      consumedFounder: boolean;
      /** The supplies written into the new settlement's warehouse (answer 3). */
      suppliesGranted: boolean;
    }
  | { ok: false; state: GameState; reason: FoundSettlementRefusal };

/**
 * The engine predicate the client gesture and the AI both gate on -- exported
 * so neither re-derives the rule (the distance check is `hexDistance`, the
 * same metric map/castlePlacement.ts spaces castles with).
 *
 * Signature-only in phase 0: throws rather than answering `ok: true`, because
 * a predicate that guesses is worse than one that is missing -- it would let
 * the UI offer a founding the rule then refuses.
 */
export function canFoundSettlement(
  request: FoundSettlementRequest,
): { ok: true } | { ok: false; reason: FoundSettlementRefusal } {
  void request;
  void hexDistance;
  throw new Error(
    "settlers founding is not implemented yet (phase 0 is signature-only -- SETTLERS-PLAN.md §5)",
  );
}

/**
 * Found a settlement at `(q, r)`: the settlers-mode twin of the charter path,
 * not a rewrite of it. Consumes the founder when the mode's
 * `wagonConsumedOnFounding` says so, writes `wagonSupplies` into the new
 * settlement's warehouse, and leaves the starter layout to the existing
 * `freeStarterBuildings` rule.
 *
 * Signature-only in phase 0: it throws rather than returning a state, so a
 * caller cannot ship a founding whose rules were never written.
 */
export function foundSettlement(request: FoundSettlementRequest): FoundSettlementResult {
  void request;
  throw new Error(
    "settlers founding is not implemented yet (phase 0 is signature-only -- SETTLERS-PLAN.md §5)",
  );
}
