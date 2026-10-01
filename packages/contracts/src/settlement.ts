import type { BuildingDef, BuildingRef } from "./buildings";
import type { CastleVariant } from "./castle";
import type { CharterId, HeroId, PlayerId, SettlementId } from "./ids";
import type { ResourceType, Warehouse } from "./resources";
import type { Platoon } from "./units";

export type CharterPhase = "traveling" | "constructing";

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
  // ── Upkeep shortfall (weekly garrison upkeep pass) ──
  /** Calendar day of the FIRST weekly garrison upkeep charge this settlement could not pay. null = paid up. */
  garrisonUnpaidSinceDay: number | null;
  /** How many garrison troops are currently unfed (unpaid gold, or no food). */
  garrisonUnpaidTroops: number;
  /** The weekly gold cost attributable to those unfed garrison troops (the deficit magnitude). */
  garrisonUnpaidGold: number;
  autoTrade: boolean;
  castleVariant: CastleVariant;
  buildings: BuildingDef[];
  upgrade?: UpgradeState;
  // Garrison platoons defending this settlement. Optional + helper-accessed
  // so legacy saves and old JSONB rows stay valid (HeroState.stacks precedent).
  stacks?: Platoon[];
}
