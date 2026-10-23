import type {
  GameState,
  HeroId,
  HeroState,
  Platoon,
  Warehouse,
  WarehouseResource,
} from "@heroes/contracts";
import { WAREHOUSE_RESOURCES } from "@heroes/contracts";
import type { HeroTradeOffer, HeroTradeRequest } from "@heroes/contracts";
import { depositIntoGarrison } from "../settlement/recruitUnits";
import { heroCargo, heroGoldCap, heroResourceCap, warehouseHeadroom } from "../settlement/capacity";
import { hexDistance } from "../map/pathfinding";
import { normalizePlatoons, platoonsHaveTroops, removeUnitsByType } from "../units";

// Field trading between two heroes (docs/heroes.md "Trading in the field").
// Heroes never share a tile (startMove rejects "occupied"), so a trade
// happens between ADJACENT heroes of the same seat -- the Heroes-of-Might
// convention for handing cargo and troops over in the open field.
//
// Both sides move in ONE command, and the whole request is validated before
// anything is written: a trade is an agreement, so a side that cannot pay or
// cannot fit refuses the trade outright rather than moving a partial amount
// (unlike TransferResources' clamp-to-headroom, which has no counterparty to
// shortchange).

export const HERO_TRADE_RANGE = 1;

export interface HeroTradeResult {
  ok: boolean;
  state: GameState;
  reason: string;
}

interface NormalizedOffer {
  gold: number;
  resources: Record<WarehouseResource, number>;
  units: { unitTypeId: string; count: number }[];
  empty: boolean;
}

function zeroResources(): Record<WarehouseResource, number> {
  return { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 };
}

// Sums duplicate unit types and validates every amount. Returns null for a
// malformed amount (a negative or fractional count) -- the caller turns that
// into "invalid_amount".
function normalizeOffer(offer: HeroTradeOffer | undefined): NormalizedOffer | null {
  const gold = offer?.gold ?? 0;
  if (!Number.isInteger(gold) || gold < 0) return null;
  const resources = zeroResources();
  for (const r of WAREHOUSE_RESOURCES) {
    const amount = offer?.resources?.[r] ?? 0;
    if (!Number.isInteger(amount) || amount < 0) return null;
    resources[r] = amount;
  }
  const byType = new Map<string, number>();
  const order: string[] = [];
  for (const entry of offer?.units ?? []) {
    if (!entry || typeof entry.unitTypeId !== "string" || entry.unitTypeId.length === 0) return null;
    if (!Number.isInteger(entry.count) || entry.count < 0) return null;
    if (entry.count === 0) continue;
    if (!byType.has(entry.unitTypeId)) order.push(entry.unitTypeId);
    byType.set(entry.unitTypeId, (byType.get(entry.unitTypeId) ?? 0) + entry.count);
  }
  const units = order.map((unitTypeId) => ({ unitTypeId, count: byType.get(unitTypeId) ?? 0 }));
  const empty = gold === 0 && units.length === 0 && WAREHOUSE_RESOURCES.every((r) => resources[r] === 0);
  return { gold, resources, units, empty };
}

function totalOfType(stacks: Platoon[], unitTypeId: string): number {
  let total = 0;
  for (const p of stacks) {
    for (const e of p.entries) {
      if (e.unitTypeId === unitTypeId) total += e.count;
    }
  }
  return total;
}

/** True when every unit the offer gives is present in `stacks`. */
function canGiveUnits(stacks: Platoon[], units: { unitTypeId: string; count: number }[]): boolean {
  return units.every((u) => totalOfType(stacks, u.unitTypeId) >= u.count);
}

/** Removes every offered unit type from a platoon set (emptied entries dropped). */
function removeOffered(stacks: Platoon[], units: { unitTypeId: string; count: number }[]): Platoon[] {
  let out = normalizePlatoons(stacks);
  for (const u of units) out = removeUnitsByType(out, u.unitTypeId, u.count);
  return out;
}

/**
 * Deposits every offered unit type into a platoon set. Returns null when the
 * army has no room (every slot at MAX_PLATOON_ENTRIES with no entry of a
 * matching type), which the caller reports as platoon_full.
 */
function depositOffered(
  stacks: Platoon[],
  units: { unitTypeId: string; count: number }[],
): Platoon[] | null {
  let out = stacks;
  for (const u of units) {
    const deposit = depositIntoGarrison(out, u.unitTypeId, u.count);
    if (!deposit.ok) return null;
    out = deposit.stacks;
  }
  return out;
}

function capped(hero: HeroState, resource: WarehouseResource, added: number): boolean {
  const cap = heroResourceCap(hero)[resource];
  return warehouseHeadroom(heroCargo(hero)[resource] ?? 0, cap) >= added;
}

function mergedCargo(hero: HeroState, added: Record<WarehouseResource, number>, removed: Record<WarehouseResource, number>): Warehouse {
  const cargo = heroCargo(hero);
  const out: Warehouse = { ...cargo };
  for (const r of WAREHOUSE_RESOURCES) {
    out[r] = (cargo[r] ?? 0) - removed[r] + added[r];
  }
  return out;
}

/**
 * Swaps the two offers between two adjacent heroes of one seat. `request.give`
 * leaves `request.heroId`, `request.take` leaves `request.partnerId`; failure
 * reasons for the partner side carry a `partner_` prefix so the panel can name
 * the hero that could not pay.
 */
export function tradeHeroes(state: GameState, request: HeroTradeRequest): HeroTradeResult {
  const giver = state.heroes[request.heroId];
  const taker = state.heroes[request.partnerId];
  if (!giver) return { ok: false, state, reason: "no_hero" };
  if (!taker) return { ok: false, state, reason: "no_partner_hero" };
  if (giver.id === taker.id) return { ok: false, state, reason: "same_hero" };
  if (giver.ownerId !== taker.ownerId) return { ok: false, state, reason: "not_same_owner" };
  const distance = hexDistance(giver, taker);
  if (distance < 1 || distance > HERO_TRADE_RANGE) {
    return { ok: false, state, reason: "not_adjacent" };
  }

  const give = normalizeOffer(request.give);
  const take = normalizeOffer(request.take);
  if (!give || !take) return { ok: false, state, reason: "invalid_amount" };
  if (give.empty && take.empty) return { ok: false, state, reason: "nothing_offered" };

  // What each side can pay.
  if (give.gold > giver.gold) return { ok: false, state, reason: "not_enough_gold" };
  if (take.gold > taker.gold) return { ok: false, state, reason: "partner_not_enough_gold" };
  const giverCargo = heroCargo(giver);
  const takerCargo = heroCargo(taker);
  for (const r of WAREHOUSE_RESOURCES) {
    if (give.resources[r] > (giverCargo[r] ?? 0)) return { ok: false, state, reason: "not_enough_resources" };
    if (take.resources[r] > (takerCargo[r] ?? 0)) {
      return { ok: false, state, reason: "partner_not_enough_resources" };
    }
  }
  const giverStacks = normalizePlatoons(giver.stacks);
  const takerStacks = normalizePlatoons(taker.stacks);
  if (!canGiveUnits(giverStacks, give.units)) return { ok: false, state, reason: "not_enough_units" };
  if (!canGiveUnits(takerStacks, take.units)) {
    return { ok: false, state, reason: "partner_not_enough_units" };
  }

  // What each side can hold. A hero's purse/cargo cap is derived from its
  // treasury carts and cargo wagons, so an over-cap trade is a real refusal
  // (the receiving hero has nowhere to put it).
  if (giver.gold - give.gold + take.gold > heroGoldCap(giver)) {
    return { ok: false, state, reason: "not_enough_gold_space" };
  }
  if (taker.gold - take.gold + give.gold > heroGoldCap(taker)) {
    return { ok: false, state, reason: "partner_not_enough_gold_space" };
  }
  for (const r of WAREHOUSE_RESOURCES) {
    if (!capped(giver, r, take.resources[r])) return { ok: false, state, reason: "not_enough_cargo_space" };
    if (!capped(taker, r, give.resources[r])) {
      return { ok: false, state, reason: "partner_not_enough_cargo_space" };
    }
  }
  // Units: remove what each side gives first, then deposit what it receives,
  // so a same-type swap cannot report a false platoon_full against the
  // receiver's own departing stacks.
  const nextGiverStacks = depositOffered(removeOffered(giverStacks, give.units), take.units);
  if (!nextGiverStacks) return { ok: false, state, reason: "not_enough_unit_space" };
  const nextTakerStacks = depositOffered(removeOffered(takerStacks, take.units), give.units);
  if (!nextTakerStacks) return { ok: false, state, reason: "partner_not_enough_unit_space" };
  // Neither hero may be traded out of its whole army: an army-less hero cannot
  // fight or defend itself, so the swap is refused rather than producing one.
  // Checked on the POST-trade stacks (a swap sends troops both ways and is
  // therefore fine), and unconditionally -- a hero that somehow starts empty
  // still cannot trade goods for goods until it holds at least one troop.
  if (!platoonsHaveTroops(nextGiverStacks)) {
    return { ok: false, state, reason: "would_be_left_without_troops" };
  }
  if (!platoonsHaveTroops(nextTakerStacks)) {
    return { ok: false, state, reason: "partner_would_be_left_without_troops" };
  }

  const nextGiver: HeroState = {
    ...giver,
    gold: giver.gold - give.gold + take.gold,
    resources: mergedCargo(giver, take.resources, give.resources),
    stacks: nextGiverStacks,
  };
  const nextTaker: HeroState = {
    ...taker,
    gold: taker.gold - take.gold + give.gold,
    resources: mergedCargo(taker, give.resources, take.resources),
    stacks: nextTakerStacks,
  };
  return {
    ok: true,
    state: {
      ...state,
      heroes: { ...state.heroes, [giver.id]: nextGiver, [taker.id]: nextTaker },
      dirty: true,
    },
    reason: "",
  };
}

/** True when the two heroes may trade right now (adjacency + one seat). */
export function canTradeHeroes(a: HeroState | undefined, b: HeroState | undefined): boolean {
  if (!a || !b) return false;
  if (a.id === b.id) return false;
  if (a.ownerId !== b.ownerId) return false;
  const distance = hexDistance(a, b);
  // Exactly one hex apart: 0 is a shared tile (startMove refuses to stack
  // heroes there, so it can only come from a corrupt row, and a "trade" with
  // oneself is not a trade).
  return distance >= 1 && distance <= HERO_TRADE_RANGE;
}

/** The adjacent same-seat heroes a hero can trade with (deterministic id order). */
export function tradePartnersFor(state: GameState, heroId: HeroId): HeroState[] {
  const hero = state.heroes[heroId];
  if (!hero) return [];
  return Object.values(state.heroes)
    .filter((other) => canTradeHeroes(hero, other))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
