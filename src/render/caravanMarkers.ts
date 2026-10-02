import type { HeroId, HeroState, SettlementId, SettlementState, TradeRouteState } from "@heroes/contracts";
import { caravanTile } from "@heroes/engine";
import type { CaravanMarkerSpec } from "./renderTypes";

/**
 * Maps departed trade-route caravans to their adventure-map marker specs
 * (docs/wagons-stockpiles-trade-routes-plan.md §5.2). Routes with no
 * caravan yet (still loading at the origin) never become specs -- the
 * marker only ever represents the physical caravan, not the route.
 *
 * The origin's tile/owner resolve per endpoint kind: a route may START at
 * a settlement or at a hero (the endpoints model, routes connect cities AND
 * heroes), so `settlements[route.from.id]` is only consulted for
 * settlement-kind origins and `heroes[...]` for hero-kind origins. A hero
 * origin contributes the hero's ownerId -- heroes always carry one -- while
 * a neutral settlement origin (ownerId null) stays markerless, exactly as
 * before. `payloadKind` rides along additively for a future gold-tinted
 * marker; nothing reads it yet.
 */
export function resolveCaravanMarkers(
  tradeRoutes: readonly TradeRouteState[] = [],
  settlements: Readonly<Record<SettlementId, SettlementState>>,
  heroes: Readonly<Record<HeroId, HeroState>> = {},
): CaravanMarkerSpec[] {
  const specs: CaravanMarkerSpec[] = [];
  for (const route of tradeRoutes) {
    const caravan = route.caravan;
    if (!caravan) continue;
    const origin =
      route.from.kind === "settlement"
        ? settlements[route.from.id]
        : heroes[route.from.id];
    if (!origin) continue;
    const ownerId = origin.ownerId;
    if (ownerId === null) continue;
    const tile = caravanTile(caravan, { q: origin.q, r: origin.r });
    specs.push({
      q: tile.q,
      r: tile.r,
      ownerId,
      wagons: route.wagons,
      payloadKind: route.payload.kind,
    });
  }
  return specs;
}
