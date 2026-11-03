import type { Axial } from "./geometry";
import type { PlayerId } from "./ids";

export type CastleLevel = 1 | 2 | 3;
/**
 * Adventure-map sprite variant. 0 = base, 1 = FLUX alternate, 2 = walled
 * hamlet, 3 = stockaded village. Variants 2/3 only ship tier-1 art; at levels
 * 2-3 they alias the variant-1 sprite so the key always resolves.
 */
export type CastleVariant = 0 | 1 | 2 | 3;

/**
 * Building-sprite generation style: the accepted values of `BuildingDef.style`.
 *
 * `pixel` (the default family, 162 keys) and `pixel-alt` (the farm-plot
 * alternate, 5 keys) are the only styles with art — see
 * `packages/engine/src/generated/buildingSpriteKeys.ts`, generated from the
 * `building-pixel-<kind>-<level>[-alt].png` files on disk.
 *
 * The five legacy names stay in the union because `style` is persisted on
 * `BuildingDef`: a row written by an older build may carry one, and
 * `pickStyleForBuilding` falls through to the art that actually resolves for
 * that kind+level rather than trusting the stored name.
 */
export type GenerationStyle =
  | "pixel"
  | "pixel-alt"
  | "classic"
  | "blocky"
  | "crystalline"
  | "organic"
  | "industrial";

/** Plain data returned by the engine's map castle-placement (@heroes/engine map/castlePlacement). */
export interface PlacedCastle {
  id: string;
  tile: Axial;
  level: CastleLevel;
  ownerId: PlayerId | null;
}
