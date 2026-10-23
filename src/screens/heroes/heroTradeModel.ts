import type { GameState, HeroId, HeroState, HeroTradeOffer, HeroTradeRequest, WarehouseResource } from "@heroes/contracts";
import { WAREHOUSE_RESOURCES } from "@heroes/contracts";
import { heroCargo, heroGoldCap, heroResourceCap, tradePartnersFor } from "@heroes/engine";

// DOM-free model for the field-trade panel (src/screens/heroes/heroTradePanel.ts):
// what each hero holds, what each side has staged to hand over, and the
// request the panel commits. Pure functions over HeroState so the arithmetic
// is unit-testable without a DOM, per the repo's panel convention.
//
// Staging is keyed by a flat string so the panel's drag/drop and stepper code
// can address any tradeable thing the same way:
//   "gold"              the hero's purse
//   "res:<resource>"    one warehouse resource in the cargo
//   "unit:<unitTypeId>" every unit of that type in the army (aggregated)

export type TradeSide = "give" | "take";

export interface TradeStaging {
  /** What the LEFT hero (the selected one) hands over. */
  give: HeroTradeOffer;
  /** What the RIGHT hero (the partner) hands over. */
  take: HeroTradeOffer;
}

export type TradeHoldingKind = "gold" | "resource" | "unit";

export interface TradeHolding {
  key: string;
  kind: TradeHoldingKind;
  resource?: WarehouseResource;
  unitTypeId?: string;
  /** What the hero currently holds of it. */
  amount: number;
}

export const TRADE_GOLD_KEY = "gold";

export function resourceKey(resource: WarehouseResource): string {
  return `res:${resource}`;
}

export function unitKey(unitTypeId: string): string {
  return `unit:${unitTypeId}`;
}

export function emptyStaging(): TradeStaging {
  return { give: {}, take: {} };
}

export function stagingFor(staging: TradeStaging, side: TradeSide): HeroTradeOffer {
  return side === "give" ? staging.give : staging.take;
}

/**
 * Everything the hero can put on the table: the purse, each warehouse
 * resource in the cargo, and one aggregated entry per distinct unit type in
 * the army (stack order preserved).
 */
export function holdingsOf(hero: HeroState | undefined): TradeHolding[] {
  if (!hero) return [];
  const out: TradeHolding[] = [{ key: TRADE_GOLD_KEY, kind: "gold", amount: Math.max(0, hero.gold) }];
  const cargo = heroCargo(hero);
  for (const resource of WAREHOUSE_RESOURCES) {
    out.push({
      key: resourceKey(resource),
      kind: "resource",
      resource,
      amount: Math.max(0, cargo[resource] ?? 0),
    });
  }
  const totals = new Map<string, number>();
  const order: string[] = [];
  for (const platoon of hero.stacks ?? []) {
    for (const entry of platoon.entries) {
      if (!entry || entry.count <= 0) continue;
      if (!totals.has(entry.unitTypeId)) order.push(entry.unitTypeId);
      totals.set(entry.unitTypeId, (totals.get(entry.unitTypeId) ?? 0) + entry.count);
    }
  }
  for (const unitTypeId of order) {
    out.push({ key: unitKey(unitTypeId), kind: "unit", unitTypeId, amount: totals.get(unitTypeId) ?? 0 });
  }
  return out;
}

export function holdingFor(hero: HeroState | undefined, key: string): TradeHolding | undefined {
  return holdingsOf(hero).find((h) => h.key === key);
}

export function stagedAmount(staging: TradeStaging, side: TradeSide, key: string): number {
  const offer = stagingFor(staging, side);
  if (key === TRADE_GOLD_KEY) return offer.gold ?? 0;
  if (key.startsWith("res:")) {
    return offer.resources?.[key.slice(4) as WarehouseResource] ?? 0;
  }
  if (key.startsWith("unit:")) {
    const unitTypeId = key.slice(5);
    return (offer.units ?? [])
      .filter((u) => u.unitTypeId === unitTypeId)
      .reduce((sum, u) => sum + u.count, 0);
  }
  return 0;
}

/** A copy of `offer` with `key` set to `amount` (0 drops the key entirely). */
function withAmount(offer: HeroTradeOffer, key: string, amount: number): HeroTradeOffer {
  if (key === TRADE_GOLD_KEY) {
    const next: HeroTradeOffer = { ...offer };
    if (amount > 0) next.gold = amount;
    else delete next.gold;
    return next;
  }
  if (key.startsWith("res:")) {
    const resource = key.slice(4) as WarehouseResource;
    const resources = { ...(offer.resources ?? {}) };
    if (amount > 0) resources[resource] = amount;
    else delete resources[resource];
    const next: HeroTradeOffer = { ...offer };
    if (Object.keys(resources).length > 0) next.resources = resources;
    else delete next.resources;
    return next;
  }
  if (key.startsWith("unit:")) {
    const unitTypeId = key.slice(5);
    const units = (offer.units ?? []).filter((u) => u.unitTypeId !== unitTypeId);
    if (amount > 0) units.push({ unitTypeId, count: amount });
    const next: HeroTradeOffer = { ...offer };
    if (units.length > 0) next.units = units;
    else delete next.units;
    return next;
  }
  return offer;
}

function withSide(staging: TradeStaging, side: TradeSide, offer: HeroTradeOffer): TradeStaging {
  return side === "give" ? { ...staging, give: offer } : { ...staging, take: offer };
}

/** Stages `amount` of one key, clamped to 0..available (0 = unstaged). */
export function stageAmount(
  staging: TradeStaging,
  side: TradeSide,
  key: string,
  amount: number,
  available: number,
): TradeStaging {
  const clamped = Math.max(0, Math.min(Math.floor(available), Math.floor(amount)));
  return withSide(staging, side, withAmount(stagingFor(staging, side), key, clamped));
}

/** Stages everything the hero holds of one key (the drag-across gesture). */
export function stageAll(staging: TradeStaging, side: TradeSide, key: string, available: number): TradeStaging {
  return stageAmount(staging, side, key, available, available);
}

export function unstage(staging: TradeStaging, side: TradeSide, key: string): TradeStaging {
  return stageAmount(staging, side, key, 0, 0);
}

/**
 * The stepper's step: a tenth of what the hero holds (so a 2,500g purse moves
 * in 250g clicks) with a floor of one unit. Units step by one -- a platoon is
 * chunky and "half a platoon" is rarely the intent.
 */
export function tradeStep(available: number, kind: TradeHoldingKind): number {
  if (kind === "unit") return 1;
  return Math.max(1, Math.floor(Math.max(0, available) / 10));
}

export function adjustStaged(
  staging: TradeStaging,
  side: TradeSide,
  key: string,
  delta: number,
  holding: TradeHolding | undefined,
): TradeStaging {
  if (!holding) return staging;
  const step = tradeStep(holding.amount, holding.kind);
  const next = stagedAmount(staging, side, key) + Math.sign(delta) * step;
  return stageAmount(staging, side, key, next, holding.amount);
}

export function stagingIsEmpty(staging: TradeStaging): boolean {
  return sideIsEmpty(staging, "give") && sideIsEmpty(staging, "take");
}

/** True when that side's offer carries nothing (both directions of a swap). */
function offerIsEmpty(offer: HeroTradeOffer): boolean {
  return (
    (offer.gold ?? 0) <= 0 &&
    (offer.units ?? []).length === 0 &&
    WAREHOUSE_RESOURCES.every((r) => (offer.resources?.[r] ?? 0) <= 0)
  );
}

export function sideIsEmpty(staging: TradeStaging, side: TradeSide): boolean {
  return offerIsEmpty(stagingFor(staging, side));
}

/** The staged rows of one side, in holdings order (gold, resources, units). */
export function stagedEntries(
  staging: TradeStaging,
  side: TradeSide,
  holdings: TradeHolding[],
): TradeHolding[] {
  const out: TradeHolding[] = [];
  for (const holding of holdings) {
    const amount = stagedAmount(staging, side, holding.key);
    if (amount > 0) out.push({ ...holding, amount });
  }
  // A staged key with no matching holding (the hero spent it under us) is
  // dropped rather than rendered as a phantom row.
  return out;
}

/**
 * What the panel commits: the two sides' staged offers, stripped of empty
 * keys so the request matches what the user sees.
 */
export function requestFromStaging(
  staging: TradeStaging,
  heroId: string,
  partnerId: string,
): HeroTradeRequest {
  return {
    heroId,
    partnerId,
    give: compactOffer(staging.give),
    take: compactOffer(staging.take),
  };
}

export function compactOffer(offer: HeroTradeOffer): HeroTradeOffer {
  const out: HeroTradeOffer = {};
  if ((offer.gold ?? 0) > 0) out.gold = offer.gold;
  const resources: Partial<Record<WarehouseResource, number>> = {};
  for (const r of WAREHOUSE_RESOURCES) {
    const amount = offer.resources?.[r] ?? 0;
    if (amount > 0) resources[r] = amount;
  }
  if (Object.keys(resources).length > 0) out.resources = resources;
  const units = (offer.units ?? []).filter((u) => u.count > 0);
  if (units.length > 0) out.units = units;
  return out;
}

export interface TradeNames {
  hero: string;
  partner: string;
}

/**
 * A rejection reason as a sentence for the panel's status line. Every reason
 * tradeHeroes() can return is covered; a `partner_`-prefixed reason names the
 * partner hero, which is the whole point of the prefix.
 */
export function tradeFailureText(reason: string, names: TradeNames): string {
  const partner = reason.startsWith("partner_");
  const bare = partner ? reason.slice("partner_".length) : reason;
  const who = partner ? names.partner : names.hero;
  switch (bare) {
    case "no_hero":
      return "That hero is gone.";
    case "no_partner_hero":
      return "The other hero is gone.";
    case "same_hero":
      return "A hero cannot trade with itself.";
    case "not_same_owner":
      return "Those heroes are not yours.";
    case "not_adjacent":
      return "Heroes must be on adjacent hexes to trade.";
    case "invalid_amount":
      return "That amount is not a whole number.";
    case "nothing_offered":
      return "Nothing is on the table yet.";
    case "not_enough_gold":
      return `${who} does not have that much gold.`;
    case "not_enough_resources":
      return `${who} does not have that many resources.`;
    case "not_enough_units":
      return `${who} does not have those units.`;
    case "not_enough_gold_space":
      return `${who} has no room in the purse (treasury carts are full).`;
    case "not_enough_cargo_space":
      return `${who} has no room in the cargo wagons.`;
    case "not_enough_unit_space":
      return `${who} has no room in the army (every slot is full).`;
    default:
      return `Trade refused: ${reason}.`;
  }
}

/** Purse/cargo/army caps, for the panel's readouts. */
export function tradeCaps(hero: HeroState | undefined): { gold: number; resources: Record<WarehouseResource, number> } {
  if (!hero) {
    return { gold: 0, resources: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 } };
  }
  return { gold: heroGoldCap(hero), resources: heroResourceCap(hero) };
}

/** The adjacent same-seat hero a hero could trade with (null when none). */
export function tradePartnerOf(state: GameState | undefined, heroId: HeroId | null | undefined): HeroState | null {
  if (!state || !heroId) return null;
  return tradePartnersFor(state, heroId)[0] ?? null;
}
