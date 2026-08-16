import type { BuildingKind, GenerationStyle } from "@heroes/contracts";

export type { BuildingKind, BuildingDef, GenerationStyle } from "@heroes/contracts";

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
