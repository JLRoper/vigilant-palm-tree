import type { GameState, PlayerId, TradeRouteEndpoint } from "@heroes/contracts";
import { evaluateTradeNeeds, type TradeRecommendation, type UnitType } from "@heroes/engine";

// The End Turn trade-route reminder (Phase 5): a player with recommendations
// available and ZERO configured routes gets ONE summary toast naming the
// count plus the top examples.
//
// TOAST ONLY — never a blocking overlay. A full-screen surface on End Turn
// silently ate the button for six turns earlier in this project's history
// (the click-blocking verdict card); the reminder must be ignorable by
// construction. DOM-free like upkeepWarnings.ts/treasuryCap.ts so it is
// unit-testable and reusable.
//
// Dedupe is a module-level Set of recommendation keys, once per session —
// a deliberate, accepted simplification for a reminder (the treasury-cap
// toast derives its one-time-ness from the previous state instead, but a
// reminder keyed on "this exact recommendation was already surfaced" reads
// better: fix the shortage and the reminder can legitimately return for a
// NEW one after a reload too). `resetTradeReminderDedupe` exists for tests
// and nothing else.

/** How many recommendations a single summary toast names before it just counts them. */
export const TRADE_REMINDER_EXAMPLE_LIMIT = 3;

function recommendationKey(rec: TradeRecommendation): string {
  const payload = rec.payload.kind === "gold" ? "gold" : rec.payload.resource;
  return `${rec.from.kind}:${rec.from.id}->${rec.to.kind}:${rec.to.id}:${payload}`;
}

/** Display name for a recommendation endpoint, mirroring the logistics modal's labels. */
export function endpointDisplayName(state: GameState, endpoint: TradeRouteEndpoint): string {
  if (endpoint.kind === "settlement") return state.settlements[endpoint.id]?.name ?? endpoint.id;
  return `Hero: ${state.heroes[endpoint.id]?.name ?? endpoint.id}`;
}

export function tradeReminderMessage(recs: TradeRecommendation[], state: GameState): string {
  const named = recs
    .slice(0, TRADE_REMINDER_EXAMPLE_LIMIT)
    .map((rec) => {
      const payload = rec.payload.kind === "gold" ? "gold" : rec.payload.resource;
      return `${endpointDisplayName(state, rec.from)} \u2192 ${endpointDisplayName(state, rec.to)} (${payload})`;
    })
    .join("; ");
  return `No trade routes set up — ${recs.length} recommended: ${named}.`;
}

/** Whether `seat` owns at least one route (a route belongs to its FROM endpoint's owner). */
export function tradeRoutesConfigured(state: GameState, seat: PlayerId): boolean {
  return (state.tradeRoutes ?? []).some((route) => {
    const owner =
      route.from.kind === "settlement"
        ? state.settlements[route.from.id]?.ownerId
        : state.heroes[route.from.id]?.ownerId;
    return owner === seat;
  });
}

const toastedKeys = new Set<string>();

/** Test seam: clears the per-session dedupe set. */
export function resetTradeReminderDedupe(): void {
  toastedKeys.clear();
}

/**
 * The reminder text for this End Turn, or null when silent: no seat, routes
 * already configured, no recommendations, or every current recommendation
 * was already toasted this session. Toasting marks the CURRENT
 * recommendations seen — one summary toast per session per distinct
 * recommendation.
 */
export function evaluateTradeReminder(
  state: GameState,
  seat: PlayerId | null,
  unitTypes: Record<string, UnitType> = {},
): string | null {
  if (seat === null) return null;
  if (tradeRoutesConfigured(state, seat)) return null;
  const recs = evaluateTradeNeeds(state, seat, unitTypes);
  if (recs.length === 0) return null;
  const keys = recs.map(recommendationKey);
  if (keys.every((key) => toastedKeys.has(key))) return null;
  for (const key of keys) toastedKeys.add(key);
  return tradeReminderMessage(recs, state);
}
