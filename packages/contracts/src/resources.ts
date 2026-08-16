export type ResourceType = "gold" | "wood" | "stone" | "iron" | "arcane" | "food";

export const WAREHOUSE_RESOURCES = ["wood", "stone", "iron", "arcane", "food"] as const;

export type WarehouseResource = (typeof WAREHOUSE_RESOURCES)[number];

export type Warehouse = {
  wood: number;
  stone: number;
  iron: number;
  arcane: number;
  food: number;
};
