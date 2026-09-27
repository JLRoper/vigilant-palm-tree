import type { GenerationStyle } from "./castle";

export type BuildingKind =
  | "townHall"
  | "house"
  | "tower"
  | "mageGuild"
  | "mine"
  | "stoneMine"
  | "ironMine"
  | "market"
  | "barracks"
  | "smithy"
  | "apartment"
  | "farmField"
  | "farmhouse"
  | "archeryRange"
  | "granary"
  | "warehouse"
  | "bank"
  | "goldMine"
  | "woodcutterHut"
  | "arcaneFont";

export interface BuildingDef {
  gx: number;
  gy: number;
  kind: BuildingKind;
  level: number;
  style: GenerationStyle;
  w?: number;
  h?: number;
  /** Present while the building is under construction (new placements); removed on completion. */
  construction?: { daysRemaining: number };
}

export interface BuildingRef {
  gx: number;
  gy: number;
  kind: BuildingKind;
}
