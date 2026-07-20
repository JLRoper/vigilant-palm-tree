import { Axial } from "../core/hex";
import type { PlayerId, ResourceType, SettlementState } from "../state/gameState";

export type CastleLevel = 1 | 2 | 3;

export class Castle {
  tile: Axial;
  level: CastleLevel;
  ownerId: PlayerId | null;
  id: string;
  name: string;
  population: number;
  goldTax: number;
  resourceRates: Partial<Record<ResourceType, number>>;
  foundedOnResource: ResourceType | null;

  constructor(
    id: string,
    tile: Axial,
    level: CastleLevel,
    ownerId: PlayerId | null,
    name: string,
    population: number,
    goldTax: number,
    resourceRates: Partial<Record<ResourceType, number>>,
    foundedOnResource: ResourceType | null,
  ) {
    this.id = id;
    this.tile = tile;
    this.level = level;
    this.ownerId = ownerId;
    this.name = name;
    this.population = population;
    this.goldTax = goldTax;
    this.resourceRates = resourceRates;
    this.foundedOnResource = foundedOnResource;
  }

  toGameState(): SettlementState {
    return {
      id: this.id,
      name: this.name,
      ownerId: this.ownerId,
      q: this.tile.q,
      r: this.tile.r,
      level: this.level,
      population: this.population,
      goldTax: this.goldTax,
      resourceRates: { ...this.resourceRates },
      foundedOnResource: this.foundedOnResource,
    };
  }

  static fromGameState(s: SettlementState): Castle {
    return new Castle(
      s.id,
      { q: s.q, r: s.r },
      s.level,
      s.ownerId ?? null,
      s.name ?? s.id,
      s.population ?? 0,
      s.goldTax ?? 0,
      s.resourceRates ?? {},
      s.foundedOnResource ?? null,
    );
  }
}

export const CASTLE_LEVELS: readonly CastleLevel[] = [1, 2, 3] as const;

export const CASTLES: readonly Castle[] = [];

export function castleAt(q: number, r: number, castles: readonly Castle[] = CASTLES): Castle | undefined {
  return castles.find((c) => c.tile.q === q && c.tile.r === r);
}

export function castlesFromGameState(settlements: Record<string, SettlementState>): Castle[] {
  return Object.values(settlements).map(Castle.fromGameState);
}
