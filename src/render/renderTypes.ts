// Cross-cutting render types. These live in their own module so neither
// renderer.ts nor minimap.ts owns them and dependent files (like
// overlays/pathOverlay.ts) can pull them in without creating a cycle.

import type { Axial } from "../core/hex";
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
}
