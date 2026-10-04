import type {
  GameState,
  HeroState,
  PlayerId,
  SettlementId,
  SettlementState,
  TradeRouteEndpoint,
  TradeRoutePayload,
  WarehouseResource,
} from "@heroes/contracts";
import type { UnitType } from "../units";
import { settlementStacks } from "../units";
import { WAGON_GOLD_CAPACITY, WAGON_RESOURCE_CAPACITY } from "../settlement/capacity";
import { effectiveIncome, foodRequired } from "./consumption";
import { evaluateTroopUpkeep } from "./troopUpkeep";
import { tradeRoutesOf } from "../logistics";

// ── Trade-route recommendations (Phase 5) ──────────────────────────────────
// The designer's ask: "really just recommend moving food and gold to
// settlements or heroes that are low", one click to accept, and the same
// evaluator drives the AI seats' auto-accept (server/app/aiDriver.ts). This
// module is the ENGINE-side, pure, deterministic evaluator both surfaces
// share — the server imports it from @heroes/engine directly, the client
// through the same package.
//
// Thresholds (locked decision 5, one named constant each):
//   - settlement food is LOW below TRADE_LOW_FOOD_RATIO × its weekly
//     foodRequired(population);
//   - settlement gold is LOW when its weekly gold BURN exceeds its weekly
//     income (effectiveIncome) AND the treasury cannot cover the coming
//     week's bill. The burn is the garrison's per-unit weekly gold bill —
//     building upkeep is deliberately excluded because it bills wood/stone,
//     never gold, so mixing it into a gold comparison would invent an
//     exchange rate;
//   - a hero is LOW when its purse + larder cannot cover its army's next
//     weekly bill (evaluateTroopUpkeep().unfed > 0 — the same evaluator the
//     weekly charge itself runs, so the recommendation threshold can never
//     drift from the payment threshold). One recommendation per SHORT
//     resource, decided from the per-resource bill vs stock.
//
// Sources are the seat's own settlements only: a food source holds more
// food than its own weekly requirement, a gold source holds more than
// TRADE_GOLD_RESERVE (the working reserve); the best (largest surplus /
// largest treasury, id tie-break) wins and never doubles as its own
// destination. Pairs already connected by a live route with the same
// payload kind are skipped; suggested wagons are clamped to the player's
// unassigned pool but never below 1 (an empty pool yields a 1-wagon
// recommendation the accept path may reject — visible, honest, and the AI
// flow buys wagons before accepting). Pure + deterministic: iteration is
// id-sorted and every pick has an explicit tie-break.

/** Settlement food below this share of its weekly requirement counts as low. */
export const TRADE_LOW_FOOD_RATIO = 0.25;

/** Working reserve a settlement keeps before its gold counts as shippable surplus. */
export const TRADE_GOLD_RESERVE = 200;

/** Hard cap on the recommendation list (the designer's "suggest 5"). */
export const TRADE_MAX_RECOMMENDATIONS = 5;

export interface TradeRecommendation {
  from: TradeRouteEndpoint;
  to: TradeRouteEndpoint;
  payload: TradeRoutePayload;
  wagons: number;
  reason: string;
}

function sameEndpoint(a: TradeRouteEndpoint, b: TradeRouteEndpoint): boolean {
  return a.kind === b.kind && a.id === b.id;
}

function payloadKindOf(payload: TradeRoutePayload): "gold" | WarehouseResource {
  return payload.kind === "gold" ? "gold" : payload.resource;
}

/** True when a live route already connects this unordered endpoint pair with the same payload kind. */
function pairConnected(
  routes: ReturnType<typeof tradeRoutesOf>,
  from: TradeRouteEndpoint,
  to: TradeRouteEndpoint,
  payload: TradeRoutePayload,
): boolean {
  const kind = payloadKindOf(payload);
  return routes.some((route) => {
    if (payloadKindOf(route.payload) !== kind) return false;
    return (
      (sameEndpoint(route.from, from) && sameEndpoint(route.to, to)) ||
      (sameEndpoint(route.from, to) && sameEndpoint(route.to, from))
    );
  });
}

function byId(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function foodSurplus(s: SettlementState): number {
  return (s.warehouse.food ?? 0) - foodRequired(s);
}

/** Best food source: largest surplus over its own weekly requirement, id tie-break, never the destination itself. */
function pickFoodSource(settlements: SettlementState[], exclude: SettlementId | null): SettlementState | null {
  let best: SettlementState | null = null;
  let bestSurplus = 0;
  for (const s of settlements) {
    if (s.id === exclude) continue;
    const surplus = foodSurplus(s);
    if (surplus > bestSurplus) {
      best = s;
      bestSurplus = surplus;
    }
  }
  return best;
}

/** Best gold source: largest treasury above the working reserve, id tie-break, never the destination itself. */
function pickGoldSource(settlements: SettlementState[], exclude: SettlementId | null): SettlementState | null {
  let best: SettlementState | null = null;
  let bestGold = TRADE_GOLD_RESERVE;
  for (const s of settlements) {
    if (s.id === exclude) continue;
    if (s.gold > bestGold) {
      best = s;
      bestGold = s.gold;
    }
  }
  return best;
}

/** The garrison's weekly gold bill (building upkeep bills wood/stone — see module header). */
function garrisonGoldBurn(s: SettlementState, unitTypes: Record<string, UnitType>): number {
  const stacks = settlementStacks(s);
  if (stacks.length === 0) return 0;
  return evaluateTroopUpkeep(stacks, unitTypes, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY).costGold;
}

/** Shortfall (whole units, ≥1) needed to bring a low settlement back to one week's food, or null when not low. */
export function settlementFoodNeed(s: SettlementState): number | null {
  const required = foodRequired(s);
  if (required <= 0) return null;
  const stock = s.warehouse.food ?? 0;
  if (stock >= TRADE_LOW_FOOD_RATIO * required) return null;
  return Math.max(1, Math.ceil(required - stock));
}

/** Shortfall to cover one week of gold burn, or null when the treasury is not low. */
export function settlementGoldNeed(s: SettlementState, unitTypes: Record<string, UnitType> = {}): number | null {
  const burn = garrisonGoldBurn(s, unitTypes);
  if (burn <= effectiveIncome(s)) return null;
  // "Low" means the treasury cannot cover the COMING week's bill — the same
  // next-week reading as the hero threshold. A fat treasury draining slowly
  // (burn > income but 100 weeks in reserve) is not low; the rule re-fires
  // the moment the reserve can no longer cover one week.
  if (Math.max(0, s.gold) >= burn) return null;
  return Math.max(1, Math.ceil(burn - Math.max(0, s.gold)));
}

export interface HeroTradeNeeds {
  gold: number | null;
  food: number | null;
  /** The army's weekly bills (for recommendation copy). */
  costGold: number;
  costFood: number;
}

/** Per-resource shortfalls for a hero whose purse + larder cannot cover its next weekly bill (null = not short). */
export function heroTradeNeeds(hero: Pick<HeroState, "stacks" | "gold" | "resources">, unitTypes: Record<string, UnitType> = {}): HeroTradeNeeds {
  const larder = hero.resources?.food ?? 0;
  const evaluation = evaluateTroopUpkeep(hero.stacks, unitTypes, hero.gold, larder);
  if (evaluation.unfed <= 0) return { gold: null, food: null, costGold: evaluation.costGold, costFood: evaluation.costFood };
  const gold = evaluation.costGold > hero.gold ? Math.max(1, Math.ceil(evaluation.costGold - hero.gold)) : null;
  const food = evaluation.costFood > larder ? Math.max(1, Math.ceil(evaluation.costFood - larder)) : null;
  return { gold, food, costGold: evaluation.costGold, costFood: evaluation.costFood };
}

export function evaluateTradeNeeds(
  state: GameState,
  seat: PlayerId,
  unitTypes: Record<string, UnitType> = {},
): TradeRecommendation[] {
  const player = state.players.find((p) => p.id === seat);
  if (!player) return [];
  const settlements = Object.values(state.settlements)
    .filter((s) => s.ownerId === seat)
    .sort(byId);
  const heroes = Object.values(state.heroes)
    .filter((h) => h.ownerId === seat)
    .sort(byId);
  const routes = tradeRoutesOf(state);
  const unassigned = player.wagonsUnassigned ?? 0;
  const out: TradeRecommendation[] = [];

  const push = (
    to: TradeRouteEndpoint,
    excludeId: SettlementId | null,
    payload: TradeRoutePayload,
    need: number,
    reason: string,
  ): void => {
    if (out.length >= TRADE_MAX_RECOMMENDATIONS) return;
    const from = payload.kind === "gold" ? pickGoldSource(settlements, excludeId) : pickFoodSource(settlements, excludeId);
    if (!from) return;
    const fromEndpoint: TradeRouteEndpoint = { kind: "settlement", id: from.id };
    // A source standing ON the destination tile can never load (the
    // same-tile stall createTradeRoute now rejects) -- skip the pair rather
    // than recommend a route that would burn weekly maintenance doing
    // nothing. excludeId above still covers the same-ENDPOINT case.
    const toEntity = to.kind === "hero" ? state.heroes[to.id] : state.settlements[to.id];
    if (toEntity && toEntity.q === from.q && toEntity.r === from.r) return;
    if (pairConnected(routes, fromEndpoint, to, payload)) return;
    const perWagon = payload.kind === "gold" ? WAGON_GOLD_CAPACITY : WAGON_RESOURCE_CAPACITY;
    const wagons = Math.max(1, Math.min(unassigned, Math.ceil(need / perWagon)));
    out.push({ from: fromEndpoint, to, payload, wagons, reason });
  };

  for (const s of settlements) {
    const foodNeed = settlementFoodNeed(s);
    if (foodNeed !== null) {
      push(
        { kind: "settlement", id: s.id },
        s.id,
        { kind: "resource", resource: "food" },
        foodNeed,
        `Food low: ${Math.floor(s.warehouse.food ?? 0)} in store, ${foodRequired(s)}/wk needed`,
      );
    }
    const goldNeed = settlementGoldNeed(s, unitTypes);
    if (goldNeed !== null) {
      push(
        { kind: "settlement", id: s.id },
        s.id,
        { kind: "gold" },
        goldNeed,
        `Treasury short: ${Math.floor(s.gold)}g against ${Math.ceil(garrisonGoldBurn(s, unitTypes))}g/wk burn`,
      );
    }
  }

  for (const hero of heroes) {
    const needs = heroTradeNeeds(hero, unitTypes);
    if (needs.food !== null) {
      push(
        { kind: "hero", id: hero.id },
        null,
        { kind: "resource", resource: "food" },
        needs.food,
        `Larder short: ${Math.floor(hero.resources?.food ?? 0)} food for a ${Math.ceil(needs.costFood)} food/wk army`,
      );
    }
    if (needs.gold !== null) {
      push(
        { kind: "hero", id: hero.id },
        null,
        { kind: "gold" },
        needs.gold,
        `Purse short: ${Math.floor(hero.gold)}g for a ${Math.ceil(needs.costGold)}g/wk army`,
      );
    }
  }

  return out;
}
