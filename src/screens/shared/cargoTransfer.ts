import type { GameState, HeroState, SettlementState, WarehouseResource } from "@heroes/contracts";
import { WAREHOUSE_RESOURCES } from "@heroes/contracts";
import { heroCargo, heroRoomFor, settlementResourceCap, warehouseHeadroom } from "@heroes/engine";

// Hero cargo <-> settlement warehouse, as data: the seam both surfaces that
// offer the transfer share (the settlement panel's Warehouse section and the
// Logistics modal's hero block), so the verb, the direction and the amounts are
// decided once instead of at each mount.

/** The player's verbs. */
export type CargoTransferVerb = "deposit" | "withdraw";

/**
 * The engine's own names for those verbs, which are the OTHER way round:
 * `TransferResources`'s "load" IS hero -> settlement and its "unload" IS
 * settlement -> hero (packages/engine/src/logistics.ts). One table, so a
 * surface cannot wire the two backwards.
 */
export const CARGO_TRANSFER_COMMAND_DIRECTION: Record<CargoTransferVerb, "load" | "unload"> = {
  deposit: "load",
  withdraw: "unload",
};

export interface CargoTransferRequest {
  /**
   * Per-resource amounts. Both verbs ask for the FULL source side and clamp to
   * the destination's room using the engine's own cap helpers, so "all" needs
   * no separate amount box and the client never re-derives a cap.
   */
  amounts: Partial<Record<WarehouseResource, number>>;
  /** The sum of `amounts`; 0 means there is nothing this verb could move. */
  total: number;
  /** The whole source side, before the destination's room clamped it: how the surfaces tell "nothing to move" from "no room for it". */
  source: number;
  direction: "load" | "unload";
}

/** The same-seat settlement on the hero's tile, or null (the transfer needs both). */
export function ownedSettlementAt(state: GameState, hero: HeroState): SettlementState | null {
  const tile = (hero as unknown as { tile?: { q: number; r: number } }).tile;
  const q = tile?.q ?? hero.q;
  const r = tile?.r ?? hero.r;
  for (const s of Object.values(state.settlements)) {
    if (s.q === q && s.r === r && s.ownerId === hero.ownerId) return s;
  }
  return null;
}

/**
 * The sentences for a refused cargo transfer, keyed by the engine's own reason
 * vocabulary (packages/engine/src/logistics.ts). Both mounts read this one
 * table, so a refusal reads as one sentence wherever the player asked for it.
 */
export const CARGO_TRANSFER_REFUSALS: Record<string, string> = {
  not_your_turn: "it is not your turn",
  no_hero: "the hero is no longer there",
  no_settlement: "the settlement is no longer there",
  forbidden_not_your_hero: "the hero is not yours",
  forbidden_not_your_settlement: "the settlement is not yours",
  hero_not_at_settlement: "the hero has to stand on the settlement",
  nothing_transferred: "nothing moved — the wagons are empty, or there is no room",
  invalid_amount: "that amount is not a whole number",
};

/** The engine's reason as a sentence; an unknown code shows itself rather than vanishing. */
export function cargoTransferRefusalMessage(reason: string): string {
  return CARGO_TRANSFER_REFUSALS[reason] ?? reason.replace(/_/g, " ");
}

/** One cargo transfer's request, ready to hand to the engine verb of the same direction. */
export function cargoTransferRequest(
  hero: HeroState,
  settlement: SettlementState,
  verb: CargoTransferVerb,
): CargoTransferRequest {
  const cargo = heroCargo(hero);
  const stockCap = settlementResourceCap(settlement);
  const amounts: Partial<Record<WarehouseResource, number>> = {};
  let total = 0;
  let source = 0;
  for (const r of WAREHOUSE_RESOURCES) {
    const available = verb === "deposit" ? (cargo[r] ?? 0) : (settlement.warehouse[r] ?? 0);
    source += Math.floor(available);
    const move =
      verb === "deposit"
        ? Math.min(cargo[r] ?? 0, warehouseHeadroom(settlement.warehouse[r] ?? 0, stockCap[r]))
        : Math.min(settlement.warehouse[r] ?? 0, heroRoomFor(hero, r));
    if (move > 0) {
      amounts[r] = Math.floor(move);
      total += Math.floor(move);
    }
  }
  return { amounts, total, source, direction: CARGO_TRANSFER_COMMAND_DIRECTION[verb] };
}

/**
 * ONE sentence per cargo button, for every state of it -- what the button will
 * move when it can move anything, and WHICH SIDE IS FULL when it cannot.
 *
 * The `source` field of the request exists for exactly this ("how the surfaces
 * tell 'nothing to move' from 'no room for it'"), and a surface that skips it
 * tells the player the wrong story: the Logistics modal used one dead-button
 * sentence per verb ("the hero's wagons are empty"), so a hero CARRYING cargo
 * into a warehouse at its storage cap was told its wagons were empty -- while
 * the settlement panel's row, mounting the same verb off the same shared model,
 * said "The warehouse is full". Both surfaces read this function now, so the
 * two cannot drift into two different stories about one click.
 */
export function cargoTransferTitle(verb: CargoTransferVerb, request: CargoTransferRequest): string {
  if (request.total > 0) {
    return verb === "deposit"
      ? `Move ${request.total} of the hero's cargo into the warehouse`
      : `Take ${request.total} out of the warehouse into the hero's cargo`;
  }
  // Nothing can move: `source > 0` means the SOURCE has goods and the
  // DESTINATION has no room, which is a different sentence from an empty source.
  if (verb === "deposit") {
    return request.source > 0 ? "The warehouse is full" : "The hero's wagons are empty";
  }
  return request.source > 0 ? "The hero's wagons are full" : "The warehouse is empty";
}
