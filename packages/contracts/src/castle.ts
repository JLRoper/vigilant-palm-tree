import type { Axial } from "./geometry";
import type { PlayerId } from "./ids";

export type CastleLevel = 1 | 2 | 3;
/**
 * Adventure-map sprite variant. 0 = base, 1 = FLUX alternate, 2 = walled
 * hamlet, 3 = stockaded village. Variants 2/3 only ship tier-1 art; at levels
 * 2-3 they alias the variant-1 sprite so the key always resolves.
 */
export type CastleVariant = 0 | 1 | 2 | 3;

export type GenerationStyle = "classic" | "blocky" | "crystalline" | "organic" | "industrial";

/** Plain data returned by the engine's map castle-placement (@heroes/engine map/castlePlacement). */
export interface PlacedCastle {
  id: string;
  tile: Axial;
  level: CastleLevel;
  ownerId: PlayerId | null;
}
