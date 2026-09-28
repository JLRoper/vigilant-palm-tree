import type { Axial } from "./geometry";
import type { PlayerId } from "./ids";

export type CastleLevel = 1 | 2 | 3;
export type CastleVariant = 0 | 1;

export type GenerationStyle = "classic" | "blocky" | "crystalline" | "organic" | "industrial";

/** Plain data returned by the engine's map castle-placement (@heroes/engine map/castlePlacement). */
export interface PlacedCastle {
  id: string;
  tile: Axial;
  level: CastleLevel;
  ownerId: PlayerId | null;
}
