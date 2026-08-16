import type { BuildingKind, GenerationStyle } from "../../../shared/types";

export type { BuildingKind, BuildingDef, GenerationStyle } from "../../../shared/types";

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
