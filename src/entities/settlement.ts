import { Axial } from "../core/hex";
import type { PlayerId, SettlementState } from "../state/gameState";

export type CastleLevel = 1 | 2 | 3;

export class Castle {
  tile: Axial;
  level: CastleLevel;
  ownerId: PlayerId | null;
  id: string;

  constructor(id: string, tile: Axial, level: CastleLevel, ownerId: PlayerId | null) {
    this.id = id;
    this.tile = tile;
    this.level = level;
    this.ownerId = ownerId;
  }

  toGameState(): SettlementState {
    return {
      id: this.id,
      ownerId: this.ownerId,
      q: this.tile.q,
      r: this.tile.r,
      level: this.level,
    };
  }

  static fromGameState(s: SettlementState): Castle {
    return new Castle(s.id, { q: s.q, r: s.r }, s.level, s.ownerId);
  }
}

export const CASTLES: Castle[] = [
  new Castle("castle-l1", { q: 6, r: 5 }, 1, 0),
  new Castle("castle-l2", { q: 14, r: 8 }, 2, 1),
  new Castle("castle-l3", { q: 10, r: 12 }, 3, null),
];

export function castleAt(q: number, r: number): Castle | undefined {
  return CASTLES.find((c) => c.tile.q === q && c.tile.r === r);
}

export function castlesFromGameState(settlements: Record<string, SettlementState>): Castle[] {
  return Object.values(settlements).map(Castle.fromGameState);
}
