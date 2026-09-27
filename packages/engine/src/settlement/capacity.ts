import type { HeroState, Player, SettlementState, Warehouse, WarehouseResource } from "@heroes/contracts";
import { WAREHOUSE_RESOURCES } from "@heroes/contracts";
import { buildingSettlementEffects } from "../buildingRegistry";

// docs/wagons-stockpiles-trade-routes-plan.md §4.1 — settlement stockpile
// caps are DERIVED (level base + warehouse-building bonuses), never stored.
// Caps gate additions only (§4.3): stored stock above cap (legacy saves)
// is never destroyed, it just can't grow.

export const BASE_STORAGE: Record<1 | 2 | 3, number> = { 1: 500, 2: 1500, 3: 4000 };
export const BASE_TREASURY: Record<1 | 2 | 3, number> = { 1: 1500, 2: 4000, 3: 10000 };

// §4.2 — hero caps scale with assigned wagons. Gold's per-wagon capacity is
// 10× resources' so a fresh 5-wagon hero can still afford the 2,500g charter.
export const DEFAULT_HERO_WAGONS = 5;
export const WAGON_RESOURCE_CAPACITY = 50;
export const WAGON_GOLD_CAPACITY = 500;
export const WAGON_COST = { gold: 200, wood: 5 } as const;

export function heroWagons(hero: HeroState): number {
  return hero.wagons ?? DEFAULT_HERO_WAGONS;
}

export function heroGoldCap(hero: HeroState): number {
  return heroWagons(hero) * WAGON_GOLD_CAPACITY;
}

export function heroResourceCap(hero: HeroState): Record<WarehouseResource, number> {
  const cap = heroWagons(hero) * WAGON_RESOURCE_CAPACITY;
  return { wood: cap, stone: cap, iron: cap, arcane: cap, food: cap };
}

export function heroCargo(hero: HeroState): Warehouse {
  return {
    wood: hero.resources?.wood ?? 0,
    stone: hero.resources?.stone ?? 0,
    iron: hero.resources?.iron ?? 0,
    arcane: hero.resources?.arcane ?? 0,
    food: hero.resources?.food ?? 0,
  };
}

export function playerWagonsOwned(p: Player): number {
  return p.wagonsOwned ?? 0;
}

export function playerWagonsUnassigned(p: Player): number {
  return p.wagonsUnassigned ?? 0;
}

export function settlementResourceCap(s: SettlementState): Record<WarehouseResource, number> {
  const cap: Record<WarehouseResource, number> = {
    wood: BASE_STORAGE[s.level],
    stone: BASE_STORAGE[s.level],
    iron: BASE_STORAGE[s.level],
    arcane: BASE_STORAGE[s.level],
    food: BASE_STORAGE[s.level],
  };
  for (const b of s.buildings) {
    const bonus = buildingSettlementEffects(b.kind, b.level).storageBonus;
    if (!bonus) continue;
    for (const r of WAREHOUSE_RESOURCES) {
      cap[r] += bonus[r] ?? 0;
    }
  }
  return cap;
}

export function settlementTreasuryCap(s: SettlementState): number {
  let cap = BASE_TREASURY[s.level];
  for (const b of s.buildings) {
    cap += buildingSettlementEffects(b.kind, b.level).treasuryBonus;
  }
  return cap;
}

/** Headroom for one resource under the soft cap: how much may still be added. */
export function warehouseHeadroom(current: number, cap: number): number {
  if (current >= cap) return 0;
  return cap - current;
}

export function treasuryHeadroom(currentGold: number, cap: number): number {
  if (currentGold >= cap) return 0;
  return cap - currentGold;
}

/** Applies an addition clamped to the cap; stock above cap (legacy) is preserved, never reduced. */
export function addStockClamped(current: number, addition: number, cap: number): number {
  if (addition <= 0) return current;
  const headroom = warehouseHeadroom(current, cap);
  return current + Math.min(addition, headroom);
}

/** Clamps a whole warehouse worth of additions against per-resource caps. */
export function addWarehouseClamped(current: Warehouse, addition: Warehouse, caps: Record<WarehouseResource, number>): Warehouse {
  const out: Warehouse = { ...current };
  for (const r of WAREHOUSE_RESOURCES) {
    out[r] = addStockClamped(current[r] ?? 0, addition[r] ?? 0, caps[r]);
  }
  return out;
}
