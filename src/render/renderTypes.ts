// Cross-cutting render types. These live in their own module so neither
// renderer.ts nor minimap.ts owns them and dependent files (like
// overlays/pathOverlay.ts) can pull them in without creating a cycle.

import type { Axial, HeroId, TradeRouteId } from "@heroes/contracts";
import type { HeroDirection } from "../entities/hero";
import type { CharterState } from "../state/gameState";

export interface MinimapGeometry {
  x0: number;
  y0: number;
  w: number;
  h: number;
  centerX: number;
  centerY: number;
  baseScale: number;
}

export interface RenderOptions {
  selectedHeroId: string | null;
  selectedSettlementId: string | null;
  colorForOwner: (ownerId: number | null) => string;
  viewPlayerId: number;
  /** If provided, overrides the reachable split computed from movementRemaining. Use this to keep the proposed yellow route stable while a hero animates a committed move. */
  pathReachableIdx?: number;
  /** If provided, anchors the yellow proposed route to this tile instead of the hero's current (moving) tile. */
  pathOrigin?: Axial;
  /** Fallback origin when pathOrigin is not set. Use the selected hero's tile from game state. */
  selectedHeroTile?: Axial;
  /** Charter targets for overlay rendering. */
  activeCharters?: readonly CharterState[];
  /** Valid hexes for charter placement mode. */
  validCharterHexes?: Set<string> | null;
  /** The clicked/inspected tile driving the tile info panel, if any. Drawn as a persistent selection ring, even through fog. */
  inspectedTile?: Axial;
  /** Trade-route id of the caravan currently under the pointer (if any); drives the map hover ring and the own-seat route preview. */
  hoveredCaravanId?: string | null;
  /** Departed trade-route caravans resolved to their current tile for marker rendering (docs/wagons-stockpiles-trade-routes-plan.md §5.2). The caller resolves positions via caravanTile so the scene builder stays pure. */
  caravans?: readonly CaravanMarkerSpec[];
  /** Per non-own-hero fade alpha from the spotted tracker; an absent entry = 1. */
  heroAlpha?: Readonly<Record<string, number>>;
  /** Uncharted fog mode: never-revealed tiles render fully opaque black instead of fog (absent = off). */
  uncharted?: boolean;
  /** Persisted per-player reveal ("q,r" keys) seeding the session reveal accumulator in uncharted mode. */
  revealedTiles?: readonly string[];
  /** Session-accumulator key for the per-game reveal set (the current game's name). */
  gameName?: string;
}

/** One trade-route caravan pre-resolved to its current map tile, owning seat, and wagon count. A route whose caravan is still loading (null) never becomes a spec. */
export interface CaravanMarkerSpec {
  routeId: TradeRouteId;
  q: number;
  r: number;
  ownerId: number;
  wagons: number;
  payloadKind?: "resource" | "gold";
  pixelOffset?: { x: number; y: number };
  moving?: boolean;
  moveProgress?: number;
  facingDirection?: HeroDirection;
  /** Tiles still to walk on the current leg, starting with the next tile after the cart. Empty while waiting at the destination. Used by the hover route preview. */
  remainingPath?: Axial[];
  /**
   * The hero this leg is heading for, when the leg's endpoint is a hero
   * (destination outbound, origin on the way home). `remainingPath` is a
   * snapshot of the last daily advance, so the hover preview re-projects the
   * line onto this hero's CURRENT tile while the pointer rests on the cart.
   */
  goalHeroId?: HeroId;
}
