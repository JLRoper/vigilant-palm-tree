import type { Axial } from "@heroes/contracts";

/** The six axial neighbour directions in E, NE, NW, W, SW, SE order. */
export const NEIGHBOR_DIRS: Axial[] = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
];
