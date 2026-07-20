import { Axial } from "../core/hex";
import type { PlayerId, ResourceType, SettlementState, Warehouse } from "../state/gameState";

export type CastleLevel = 1 | 2 | 3;

function emptyWarehouse(): Warehouse {
  return { wood: 0, stone: 0, iron: 0, arcane: 0 };
}

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
  gold: number;
  warehouse: Warehouse;

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
    gold = 0,
    warehouse?: Warehouse,
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
    this.gold = gold;
    this.warehouse = warehouse ?? emptyWarehouse();
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
      gold: this.gold,
      warehouse: { ...this.warehouse },
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
      s.gold ?? 0,
      s.warehouse ?? emptyWarehouse(),
    );
  }
}

export const CASTLE_LEVELS: readonly CastleLevel[] = [1, 2, 3] as const;

export function castleAt(q: number, r: number, castles: readonly Castle[]): Castle | undefined {
  return castles.find((c) => c.tile.q === q && c.tile.r === r);
}

export function castlesFromGameState(settlements: Record<string, SettlementState>): Castle[] {
  return Object.values(settlements).map(Castle.fromGameState);
}
