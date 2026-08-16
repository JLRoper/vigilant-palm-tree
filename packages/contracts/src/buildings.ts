import type { GenerationStyle } from "./castle";

export type BuildingKind =
  | "townHall"
  | "house"
  | "tower"
  | "mageGuild"
  | "mine"
  | "market"
  | "barracks"
  | "smithy"
  | "apartment"
  | "farmField"
  | "farmhouse"
  | "archeryRange"
  | "granary";

export interface BuildingDef {
  gx: number;
  gy: number;
  kind: BuildingKind;
  level: number;
  style: GenerationStyle;
  w?: number;
  h?: number;
}

export interface BuildingRef {
  gx: number;
  gy: number;
  kind: BuildingKind;
}
