import type { BuildingKind, ResourceType, WarehouseResource } from "@heroes/contracts";

export interface RecruitEntry {
  unitTypeId: string;
  goldCost: number;
  resourceCost?: Partial<Record<Exclude<ResourceType, "gold">, number>>;
  /** Lowest building level offering this unit (default 1). */
  minLevel?: number;
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
    /** Per-level storage capacity bonus (docs/wagons-stockpiles-trade-routes-plan.md §4.1). */
    storageBonus?: Partial<Record<WarehouseResource, number>>;
    /** Per-level treasury capacity bonus. */
    treasuryBonus?: number;
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
    description: "Arcane research and spellcraft. Recruits monks and mages.",
    footprint: { w: 1, h: 1 },
    buildDays: 6,
    placementCost: { gold: 400, wood: 5, stone: 8, arcane: 2 },
    upkeepPerLevel: { wood: 1, stone: 1 },
    recruits: [
      { unitTypeId: "monk", goldCost: 300, resourceCost: { arcane: 1 }, minLevel: 1 },
      { unitTypeId: "mage", goldCost: 500, resourceCost: { arcane: 2 }, minLevel: 2 },
    ],
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
  stoneMine: {
    kind: "stoneMine",
    label: "Stone Mine",
    description: "Cuts blocks of building stone from a worked rock face, shipping them to the warehouse each turn.",
    footprint: { w: 1, h: 1 },
    buildDays: 4,
    placementCost: { gold: 250, wood: 6, stone: 4 },
    upkeepPerLevel: { wood: 2, stone: 0 },
    recruits: [],
    settlementEffects: { resourceYieldBonus: { stone: 3 } },
    playerEffects: {},
  },
  ironMine: {
    kind: "ironMine",
    label: "Iron Mine",
    description: "Digs iron ore from deep veins, feeding the settlement's forge-bound stockpile each turn.",
    footprint: { w: 1, h: 1 },
    buildDays: 4,
    placementCost: { gold: 250, wood: 6, stone: 4 },
    upkeepPerLevel: { wood: 2, stone: 0 },
    recruits: [],
    settlementEffects: { resourceYieldBonus: { iron: 3 } },
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
    recruits: [
      { unitTypeId: "swordsman", goldCost: 200, minLevel: 1 },
      { unitTypeId: "pikeman", goldCost: 250, resourceCost: { iron: 3 }, minLevel: 2 },
      { unitTypeId: "crusader", goldCost: 500, resourceCost: { iron: 5 }, minLevel: 3 },
    ],
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
    recruits: [{ unitTypeId: "peasant", goldCost: 25, minLevel: 1 }],
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
    recruits: [
      { unitTypeId: "archer", goldCost: 250, resourceCost: { wood: 2 }, minLevel: 1 },
      { unitTypeId: "crossbowman", goldCost: 350, resourceCost: { iron: 2 }, minLevel: 2 },
    ],
    settlementEffects: { defenseBonus: 1 },
    playerEffects: { heroAttackBonus: 1 },
  },
  stables: {
    kind: "stables",
    label: "Stables",
    description: "Mounts and trains cavalry.",
    footprint: { w: 1, h: 1 },
    buildDays: 4,
    placementCost: { gold: 350, wood: 10, stone: 5 },
    upkeepPerLevel: { wood: 1, stone: 1 },
    recruits: [{ unitTypeId: "cavalry", goldCost: 400, resourceCost: { iron: 2 }, minLevel: 1 }],
    settlementEffects: { defenseBonus: 1 },
    playerEffects: {},
  },
  huntingLodge: {
    kind: "huntingLodge",
    label: "Hunting Lodge",
    description: "Kennels and hunting grounds; raises fierce warhounds for the crown.",
    footprint: { w: 1, h: 1 },
    buildDays: 3,
    placementCost: { gold: 250, wood: 8 },
    upkeepPerLevel: { wood: 2, stone: 1 },
    recruits: [{ unitTypeId: "warhound", goldCost: 180, minLevel: 1 }],
    settlementEffects: { defenseBonus: 1 },
    playerEffects: {},
  },
  eyrie: {
    kind: "eyrie",
    label: "Eagle Eyrie",
    description: "Cliffside aeries where the realm's giant eagles nest; a bonded prince leads the eyerie.",
    footprint: { w: 1, h: 1 },
    buildDays: 6,
    placementCost: { gold: 500, wood: 12, stone: 8 },
    upkeepPerLevel: { wood: 2, stone: 1 },
    recruits: [
      { unitTypeId: "giant_eagle", goldCost: 1400, resourceCost: { arcane: 2 }, minLevel: 1 },
      { unitTypeId: "eagle_prince", goldCost: 2400, resourceCost: { arcane: 4 }, minLevel: 2 },
    ],
    settlementEffects: {},
    playerEffects: {},
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
    settlementEffects: { foodPerTurn: 3, storageBonus: { food: 600 } },
    playerEffects: {},
  },
  warehouse: {
    kind: "warehouse",
    label: "Warehouse",
    description: "Walled storehouses with cellars and lofts, raising the settlement's stockpile capacity for every resource.",
    // 2x2 (not 1x1) so a warehouse is a real space commitment. That is also
    // why the placement cost doubled: four tiles is 19% of a level-1 town's
    // usable space, versus one tile at 5% before.
    footprint: { w: 2, h: 2 },
    buildDays: 3,
    placementCost: { gold: 500, wood: 16, stone: 12 },
    upkeepPerLevel: { wood: 1, stone: 1 },
    recruits: [],
    settlementEffects: {
      storageBonus: { wood: 600, stone: 600, iron: 600, arcane: 600, food: 600 },
      treasuryBonus: 500,
    },
    playerEffects: {},
  },
  bank: {
    kind: "bank",
    label: "Bank",
    description:
      "A vaulted strongroom that holds a bank pot of its own, and widens the settlement's treasury so more gold can be held at all. The treasury-cap role is shared with the treasury; the pot is the bank's own.",
    footprint: { w: 1, h: 1 },
    buildDays: 5,
    placementCost: { gold: 400, wood: 6, stone: 8 },
    upkeepPerLevel: { wood: 1, stone: 1 },
    recruits: [],
    // No goldPerTurn: only goldMine's gold actually accrues per turn, so the
    // 60g this used to advertise was never applied by the economy and the
    // description promised an effect the game did not have.
    settlementEffects: { treasuryBonus: 2000 },
    playerEffects: {},
  },
  treasury: {
    kind: "treasury",
    label: "Treasury",
    description:
      "A great counting-house that raises the settlement's treasury capacity, letting it hold more gold. It does nothing else.",
    footprint: { w: 1, h: 1 },
    buildDays: 5,
    placementCost: { gold: 400, wood: 6, stone: 8 },
    upkeepPerLevel: { wood: 1, stone: 1 },
    recruits: [],
    // settlementTreasuryCap sums treasuryBonus over every building, so a new
    // cap-building needs no capacity.ts change -- it contributes on sight.
    settlementEffects: { treasuryBonus: 2000 },
    playerEffects: {},
  },
  goldMine: {
    kind: "goldMine",
    label: "Gold Mine",
    description: "Extracts gold ore from deep seams, turning each turn into fresh coin for the treasury.",
    footprint: { w: 1, h: 1 },
    buildDays: 4,
    placementCost: { gold: 300, wood: 6, stone: 4 },
    upkeepPerLevel: { wood: 2, stone: 0 },
    recruits: [],
    settlementEffects: { goldPerTurn: 40 },
    playerEffects: {},
  },
  woodcutterHut: {
    kind: "woodcutterHut",
    label: "Woodcutter's Hut",
    description: "Fells and seasons timber from the surrounding woods, improving the settlement's wood yield.",
    footprint: { w: 1, h: 1 },
    buildDays: 3,
    placementCost: { gold: 150, wood: 5 },
    upkeepPerLevel: { wood: 1, stone: 0 },
    recruits: [],
    settlementEffects: { resourceYieldBonus: { wood: 3 } },
    playerEffects: {},
  },
  arcaneFont: {
    kind: "arcaneFont",
    label: "Arcane Font",
    description: "Draws raw power from a settled font of magic, condensing it into arcane dust each turn.",
    footprint: { w: 1, h: 1 },
    buildDays: 4,
    placementCost: { gold: 350, wood: 5, stone: 6 },
    upkeepPerLevel: { wood: 1, stone: 1 },
    recruits: [],
    settlementEffects: { resourceYieldBonus: { arcane: 3 } },
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
    // ×level, like goldPerTurn/foodPerTurn above and the convention
    // docs/resource-gathering.md pins for producers. It used to be a flat
    // copy: a woodcutter hut produced the SAME 3 wood at L3 as at L1 while
    // upkeepPerLevel charged 3× the wood, so every upgrade was strictly
    // negative ROI. producerBasePerTurn reads exactly this map.
    resourceYieldBonus: e.settlementEffects.resourceYieldBonus
      ? Object.fromEntries(
          Object.entries(e.settlementEffects.resourceYieldBonus).map(([r, v]) => [r, (v ?? 0) * level]),
        )
      : undefined,
    populationBonus: (e.settlementEffects.populationBonus ?? 0) * level,
    defenseBonus: (e.settlementEffects.defenseBonus ?? 0) * level,
    unitCostReductionPct: e.settlementEffects.unitCostReductionPct ?? 0,
    storageBonus: e.settlementEffects.storageBonus
      ? Object.fromEntries(
          Object.entries(e.settlementEffects.storageBonus).map(([r, v]) => [r, (v ?? 0) * level]),
        )
      : undefined,
    treasuryBonus: (e.settlementEffects.treasuryBonus ?? 0) * level,
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
  //
  // Deliberately 1x1 kinds only. Adding a 2x2 kind here (warehouse became 2x2)
  // would make it SMALLER on upgrade: 1.5x1.5 covers only 2 cells, so coversCell
  // would free the other two and two buildings could claim the same cells. The
  // other 2x2 kinds (apartment, farmField) stay out for the same reason.
  if (kind === "townHall" && level === 2) {
    return { w: 1.5, h: 1.5 };
  }
  if (
    (kind === "granary" || kind === "bank" || kind === "goldMine" || kind === "woodcutterHut") &&
    (level === 2 || level === 3)
  ) {
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
