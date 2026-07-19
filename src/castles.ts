import { Axial } from "./hex";

export type CastleLevel = 1 | 2 | 3;

export class Castle {
  constructor(public tile: Axial, public level: CastleLevel) {}
}

export const CASTLES: Castle[] = [
  new Castle({ q: 6, r: 5 }, 1),
  new Castle({ q: 14, r: 8 }, 2),
  new Castle({ q: 10, r: 12 }, 3),
];

export function castleAt(q: number, r: number): Castle | undefined {
  return CASTLES.find((c) => c.tile.q === q && c.tile.r === r);
}
