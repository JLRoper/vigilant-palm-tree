import type { GenerationStyle } from "../palettes";

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

export interface DrawBuildingContext {
  ctx: CanvasRenderingContext2D;
  gx: number;
  gy: number;
  w: number;
  h: number;
  gridOrigin: { x: number; y: number };
  screenOrigin: { x: number; y: number };
  tileScale: number;
  style: GenerationStyle;
  kind: BuildingKind;
  level: number;
  ownerColor: string;
  cellScreen: { x: number; y: number };
  hw: number;
  hh: number;
}
