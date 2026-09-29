import type { Vec3 } from "./math";

export interface BoxPart {
  name: string;
  size: Vec3;
  color?: string;
  pivot?: Vec3;
  offset?: Vec3;
  rotation?: Vec3;
  children?: BoxPart[];
}

export interface Keyframe {
  t: number;
  rotation?: Vec3;
  offset?: Vec3;
}

export interface Animation {
  name: string;
  frames: number;
  loop: boolean;
  tracks: Record<string, Keyframe[]>;
}

export interface ModelDef {
  id: string;
  root: BoxPart;
  animations: Animation[];
}

export const DIRECTIONS = ["n", "ne", "e", "se", "s", "sw", "w", "nw"] as const;

export type Direction = (typeof DIRECTIONS)[number];

export const YAW_BY_DIRECTION: Record<Direction, number> = {
  se: 0,
  s: Math.PI / 4,
  sw: Math.PI / 2,
  w: (3 * Math.PI) / 4,
  nw: Math.PI,
  n: (-3 * Math.PI) / 4,
  ne: -Math.PI / 2,
  e: -Math.PI / 4,
};
