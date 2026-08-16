import type { BuildingKind, ResourceType } from "@heroes/contracts";

export interface RecruitEntry {
  unitTypeId: string;
  goldCost: number;
  resourceCost?: Partial<Record<Exclude<ResourceType, "gold">, number>>;
}

export interface BuildingEffect {
  kind: BuildingKind;
  label: string;
  description: string;
  footprint: { w: number; h: number };
  buildDays: number;
  placementCost: Partial<Record<ResourceType, number>>;
  upkeepPerLevel: { wood: number; stone: number };
  recruits: RecruitEntry[];
  settlementEffects: {
    goldPerTurn?: number;
    foodPerTurn?: number;
    resourceYieldBonus?: Partial<Record<Exclude<ResourceType, "gold" | "food">, number>>;
    populationBonus?: number;
    defenseBonus?: number;
    unitCostReductionPct?: number;
  };
  playerEffects: {
    visionRangeBonus?: number;
    controlRangeBonus?: number;
    heroSpeedBonus?: number;
    heroAttackBonus?: number;
  };
}

const REGISTRY: Record<BuildingKind, BuildingEffect> = {
  townHall: {
    kind: "townHall",
    label: "Town Hall",
    description: "Center of settlement governance. Level unlocks settlement upgrades.",
    footprint: { w: 2, h: 2 },
    buildDays: 0,
    placementCost: {},
    upkeepPerLevel: { wood: 3, stone: 2 },
    recruits: [],
    settlementEffects: {},
    playerEffects: { controlRangeBonus: 1 },
  },
  house: {
    kind: "house",
    label: "House",
    description: "A humble dwelling.",
    footprint: { w: 1, h: 1 },
    buildDays: 2,
    placementCost: { gold: 100, wood: 5 },
    upkeepPerLevel: { wood: 1, stone: 0 },
    recruits: [],
    settlementEffects: { populationBonus: 50 },
    playerEffects: {},
  },
  tower: {
    kind: "tower",
    label: "Tower",
    description: "A tall defensive spire.",
    footprint: { w: 1, h: 1 },
    buildDays: 4,
    placementCost: { gold: 300, wood: 8, stone: 5 },
    upkeepPerLevel: { wood: 1, stone: 1 },
    recruits: [],
    settlementEffects: { defenseBonus: 1 },
    playerEffects: { visionRangeBonus: 2 },
  },
  mageGuild: {
    kind: "mageGuild",
    label: "Mage Guild",
    description: "Arcane research and spellcraft. Recruits mages.",
    footprint: { w: 1, h: 1 },
    buildDays: 6,
    placementCost: { gold: 400, wood: 5, stone: 8, arcane: 2 },
    upkeepPerLevel: { wood: 1, stone: 1 },
    recruits: [{ unitTypeId: "mage", goldCost: 500, resourceCost: { arcane: 2 } }],
    settlementEffects: { resourceYieldBonus: { arcane: 3 } },
    playerEffects: {},
  },
  mine: {
    kind: "mine",
    label: "Mine",
    description: "Extracts raw resources.",
    footprint: { w: 1, h: 1 },
    buildDays: 4,
    placementCost: { gold: 250, wood: 6, stone: 4 },
    upkeepPerLevel: { wood: 2, stone: 0 },
    recruits: [],
    settlementEffects: { resourceYieldBonus: { wood: 3, stone: 3, iron: 3 } },
    playerEffects: {},
  },
  market: {
    kind: "market",
    label: "Market",
    description: "Trade goods and gold.",
    footprint: { w: 1, h: 1 },
    buildDays: 3,
    placementCost: { gold: 200, wood: 8, stone: 5 },
    upkeepPerLevel: { wood: 1, stone: 1 },
    recruits: [],
    settlementEffects: { goldPerTurn: 40 },
    playerEffects: {},
  },
  barracks: {
    kind: "barracks",
    label: "Barracks",
    description: "Trains melee infantry. Recruits swordsmen.",
    footprint: { w: 1, h: 1 },
    buildDays: 5,
    placementCost: { gold: 300, wood: 10, stone: 6 },
    upkeepPerLevel: { wood: 2, stone: 1 },
    recruits: [{ unitTypeId: "swordsman", goldCost: 200 }],
    settlementEffects: { defenseBonus: 2 },
    playerEffects: {},
  },
  smithy: {
    kind: "smithy",
    label: "Smithy",
    description: "Forge weaponry and armor.",
    footprint: { w: 1, h: 1 },
    buildDays: 4,
    placementCost: { gold: 250, wood: 5, stone: 6 },
    upkeepPerLevel: { wood: 1, stone: 1 },
    recruits: [],
    settlementEffects: { unitCostReductionPct: 10 },
    playerEffects: {},
  },
  apartment: {
    kind: "apartment",
    label: "Apartment",
    description: "Multi-level living quarters.",
    footprint: { w: 2, h: 2 },
    buildDays: 5,
    placementCost: { gold: 300, wood: 12, stone: 6 },
    upkeepPerLevel: { wood: 2, stone: 0 },
    recruits: [],
    settlementEffects: { populationBonus: 100 },
    playerEffects: {},
  },
  farmField: {
    kind: "farmField",
    label: "Farm Field",
    description: "Cultivated crop rows.",
    footprint: { w: 2, h: 2 },
    buildDays: 2,
    placementCost: { gold: 120, wood: 3 },
    upkeepPerLevel: { wood: 0, stone: 0 },
    recruits: [],
    settlementEffects: { foodPerTurn: 5 },
    playerEffects: {},
  },
  farmhouse: {
    kind: "farmhouse",
    label: "Farmhouse",
    description: "A small rural home.",
    footprint: { w: 1, h: 1 },
    buildDays: 2,
    placementCost: { gold: 80, wood: 4 },
    upkeepPerLevel: { wood: 1, stone: 0 },
    recruits: [],
    settlementEffects: { foodPerTurn: 2, populationBonus: 20 },
    playerEffects: {},
  },
  archeryRange: {
    kind: "archeryRange",
    label: "Archery Range",
    description: "Train and recruit ranged units. Recruits archers.",
    footprint: { w: 1, h: 2 },
    buildDays: 4,
    placementCost: { gold: 350, wood: 8, stone: 5 },
    upkeepPerLevel: { wood: 1, stone: 1 },
    recruits: [{ unitTypeId: "archer", goldCost: 250, resourceCost: { wood: 2 } }],
    settlementEffects: { defenseBonus: 1 },
    playerEffects: { heroAttackBonus: 1 },
  },
  granary: {
    kind: "granary",
    label: "Granary",
    description: "Stores surplus grain. Increases food storage and yields a small food surplus each turn.",
    footprint: { w: 1, h: 1 },
    buildDays: 3,
    placementCost: { gold: 150, wood: 8, stone: 4 },
    upkeepPerLevel: { wood: 1, stone: 0 },
    recruits: [],
    settlementEffects: { foodPerTurn: 3 },
    playerEffects: {},
  },
};

export function getBuildingEffect(kind: BuildingKind): BuildingEffect {
  return REGISTRY[kind];
}

export function buildingPlacementCost(kind: BuildingKind): Partial<Record<ResourceType, number>> {
  return { ...REGISTRY[kind].placementCost };
}

export function buildingBuildDays(kind: BuildingKind): number {
  return REGISTRY[kind].buildDays;
}

export function buildingUpkeep(kind: BuildingKind, level: number): { wood: number; stone: number } {
  const e = REGISTRY[kind];
  return {
    wood: (e.upkeepPerLevel.wood ?? 0) * level,
    stone: (e.upkeepPerLevel.stone ?? 0) * level,
  };
}

export function buildingSettlementEffects(kind: BuildingKind, level: number) {
  const e = REGISTRY[kind];
  return {
    goldPerTurn: (e.settlementEffects.goldPerTurn ?? 0) * level,
    foodPerTurn: (e.settlementEffects.foodPerTurn ?? 0) * level,
    resourceYieldBonus: e.settlementEffects.resourceYieldBonus
      ? { ...e.settlementEffects.resourceYieldBonus }
      : undefined,
    populationBonus: (e.settlementEffects.populationBonus ?? 0) * level,
    defenseBonus: (e.settlementEffects.defenseBonus ?? 0) * level,
    unitCostReductionPct: e.settlementEffects.unitCostReductionPct ?? 0,
  };
}

export function buildingPlayerEffects(kind: BuildingKind, level: number) {
  const e = REGISTRY[kind];
  return {
    visionRangeBonus: (e.playerEffects.visionRangeBonus ?? 0) * level,
    controlRangeBonus: (e.playerEffects.controlRangeBonus ?? 0) * level,
    heroSpeedBonus: (e.playerEffects.heroSpeedBonus ?? 0) * level,
    heroAttackBonus: (e.playerEffects.heroAttackBonus ?? 0) * level,
  };
}

export function buildingFootprintFromRegistry(kind: BuildingKind, level?: number): { w: number; h: number } {
  // Level-specific overrides: 2x2 grid footprint with 1.5x1.5 visual rendering.
  // (coversCell rounds the fractional footprint down to integer cells, so the
  // sprite visually occupies 1.5x1.5 but blocks 4 grid cells for placement.)
  if (kind === "townHall" && level === 2) {
    return { w: 1.5, h: 1.5 };
  }
  if (kind === "granary" && (level === 2 || level === 3)) {
    return { w: 1.5, h: 1.5 };
  }
  return { ...REGISTRY[kind].footprint };
}

export function buildingLabel(kind: BuildingKind): string {
  return REGISTRY[kind].label;
}

export function buildingDescription(kind: BuildingKind): string {
  return REGISTRY[kind].description;
}

export interface BuildingUpgradeCost {
  gold: number;
  wood: number;
  stone: number;
  days: number;
}

const KIND_UPGRADE_MULTIPLIER: Partial<Record<BuildingKind, { l2: number; l3: number }>> = {
  townHall: { l2: 1500, l3: 5000 },
};

export function buildingUpgradeCost(kind: BuildingKind, currentLevel: number): BuildingUpgradeCost | null {
  if (currentLevel >= 3) return null;
  const targetLevel = currentLevel + 1;
  const mult = KIND_UPGRADE_MULTIPLIER[kind];
  if (mult) {
    const gold = targetLevel === 2 ? mult.l2 : mult.l3;
    return {
      gold,
      wood: Math.round(gold * 0.01),
      stone: Math.round(gold * 0.007),
      days: targetLevel === 2 ? 7 : 12,
    };
  }
  const base = buildingPlacementCost(kind);
  const factor = targetLevel === 2 ? 1.5 : 3.0;
  return {
    gold: Math.round((base.gold ?? 0) * factor),
    wood: Math.round((base.wood ?? 0) * factor),
    stone: Math.round((base.stone ?? 0) * factor),
    days: targetLevel === 2 ? 4 : 7,
  };
}

export function combineUpgradeCosts(costs: BuildingUpgradeCost[]): BuildingUpgradeCost {
  return costs.reduce(
    (acc, c) => ({
      gold: acc.gold + c.gold,
      wood: acc.wood + c.wood,
      stone: acc.stone + c.stone,
      days: Math.max(acc.days, c.days),
    }),
    { gold: 0, wood: 0, stone: 0, days: 0 },
  );
}
