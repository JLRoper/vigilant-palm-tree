import { Axial } from "../core/hex";
import type { PlayerId, ResourceType, SettlementState, UpgradeState, Warehouse } from "../state/gameState";
import type { BuildingDef } from "../render/cityBuildingDraw";

export type CastleLevel = 1 | 2 | 3;
export type CastleVariant = 0 | 1;

function emptyWarehouse(): Warehouse {
  return { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 };
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
  citySpots: Array<{ cell: { x: number; y: number }; resource: ResourceType; vein: string }>;
  cityMines: Array<{ cell: { x: number; y: number }; resource: ResourceType; level: number }>;
  morale: number;
  autoTrade: boolean;
  castleVariant: CastleVariant;
  buildings: BuildingDef[];
  upgrade?: UpgradeState;

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
    citySpots?: Array<{ cell: { x: number; y: number }; resource: ResourceType; vein: string }>,
    cityMines?: Array<{ cell: { x: number; y: number }; resource: ResourceType; level: number }>,
    morale = 100,
    autoTrade = true,
    castleVariant: CastleVariant = 0,
    buildings: BuildingDef[] = [],
    upgrade?: UpgradeState,
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
    this.citySpots = citySpots ?? [];
    this.cityMines = cityMines ?? [];
    this.morale = morale;
    this.autoTrade = autoTrade;
    this.castleVariant = castleVariant;
    this.buildings = buildings;
    this.upgrade = upgrade;
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
      citySpots: this.citySpots,
      cityMines: this.cityMines,
      morale: this.morale,
      autoTrade: this.autoTrade,
      castleVariant: this.castleVariant,
      buildings: this.buildings,
      upgrade: this.upgrade,
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
      s.citySpots ?? [],
      s.cityMines ?? [],
      s.morale ?? 100,
      s.autoTrade ?? true,
      s.castleVariant ?? 0,
      s.buildings ?? [],
      s.upgrade ?? undefined,
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
