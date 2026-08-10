import type {
  BuildingDef,
  BuildingKind,
  CastleVariant,
  CharterId,
  HeroId,
  PlayerId,
  ResourceType,
  SettlementId,
} from "./types";
import { WAREHOUSE_RESOURCES } from "./constants";

export type WarehouseResource = (typeof WAREHOUSE_RESOURCES)[number];

export type Warehouse = {
  wood: number;
  stone: number;
  iron: number;
  arcane: number;
  food: number;
};

export type CharterPhase = "traveling" | "constructing";

export interface BuildingRef {
  gx: number;
  gy: number;
  kind: BuildingKind;
}

export interface UpgradeState {
  kind: "townHall" | "settlement" | "building" | "buildings";
  targetLevel: 2 | 3;
  daysRemaining: number;
  buildingRef?: BuildingRef;
  buildingRefs?: BuildingRef[];
  newResourceRates?: Partial<Record<ResourceType, number>>;
  newCitySpots?: Array<{ cell: { x: number; y: number }; resource: ResourceType; vein: string }>;
}

export interface CharterState {
  id: CharterId;
  heroId: HeroId;
  ownerId: PlayerId;
  targetQ: number;
  targetR: number;
  settlementName: string;
  phase: CharterPhase;
  daysRemaining: number;
  settlementId: SettlementId;
  resourceRates: Partial<Record<ResourceType, number>>;
  foundedOnResource: ResourceType | null;
  citySpots: Array<{ cell: { x: number; y: number }; resource: ResourceType; vein: string }>;
}

export interface SettlementState {
  id: SettlementId;
  name: string;
  ownerId: PlayerId | null;
  q: number;
  r: number;
  level: 1 | 2 | 3;
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
}
