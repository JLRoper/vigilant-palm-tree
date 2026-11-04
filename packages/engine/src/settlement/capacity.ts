import type { HeroState, Player, SettlementState, Warehouse, WarehouseResource } from "@heroes/contracts";
import { WAREHOUSE_RESOURCES } from "@heroes/contracts";
import { buildingSettlementEffects } from "../buildingRegistry";

// docs/wagons-stockpiles-trade-routes-plan.md §4.1 — settlement stockpile
// caps are DERIVED (level base + warehouse-building bonuses), never stored.
// Caps gate additions only (§4.3): stored stock above cap (legacy saves)
// is never destroyed, it just can't grow.

export const BASE_STORAGE: Record<1 | 2 | 3, number> = { 1: 500, 2: 1500, 3: 4000 };
// THE BASE CAP MUST HOLD THE PRICE THE LEVEL IS OFFERED. A settlement pays its
// own upgrades out of its own treasury and every gold addition lands clamped by
// treasuryHeadroom, so a price above the cap a level can REACH is an offer that
// can never be accepted -- not a shortfall to save for. Above level 1 that is
// reachable through the design's capacity path (a Bank or Treasury adds
// 2,000g/level of cap and both are placeable from level 2), so those bases are
// deliberately base-blocked on purpose. Level 1 has no capacity path at all --
// warehouse/bank/treasury are the only treasuryBonus kinds and all three are
// requiredLevel 2 -- so its base has to carry its own tier upgrade's 5,000g
// (was 1,500g, which capped the vault below SETTLEMENT_UPGRADE_COSTS[1] and made
// that upgrade unpayable however long the player waited).
export const BASE_TREASURY: Record<1 | 2 | 3, number> = { 1: 5000, 2: 4000, 3: 10000 };

// §4.2 + the Phase 1 treasury-wagons split — hero caps scale with the
// matching wagon slot. Army `wagons` govern the RESOURCE cargo cap ONLY
// (×50 each); `treasuryWagons` (treasury carts) govern the gold purse cap
// ONLY (×500 each) — the designer's "they get their own slot, not shared
// with army slots". Gold's per-cart capacity is 10× resources' so a
// legacy hero soft-defaulting to 5 carts still affords the 2,500g charter.
export const DEFAULT_HERO_WAGONS = 5;
export const DEFAULT_TREASURY_WAGONS = 5;
export const WAGON_RESOURCE_CAPACITY = 50;
export const WAGON_GOLD_CAPACITY = 500;
export const WAGON_COST = { gold: 200, wood: 5 } as const;

export function heroWagons(hero: HeroState): number {
  return hero.wagons ?? DEFAULT_HERO_WAGONS;
}

// Soft-default 5 mirrors heroWagons: absent means a pre-split hero, and
// zero churn for legacy saves/fixtures means keeping the 2,500g purse cap
// (the deliberate 5-cart <-> CHARTER_GOLD_COST pairing). An EXPLICIT 0 is
// real (a hero stripped of its carts, or recruited from an empty pool) and
// yields a 0g purse cap.
export function heroTreasuryWagons(hero: HeroState): number {
  return hero.treasuryWagons ?? DEFAULT_TREASURY_WAGONS;
}

export function heroGoldCap(hero: HeroState): number {
  return heroTreasuryWagons(hero) * WAGON_GOLD_CAPACITY;
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

// Treasury-cart pool accessors, mirroring playerWagonsOwned/Unassigned
// field-for-field (Phase 1 treasury-wagons split).
export function playerTreasuryWagonsOwned(p: Player): number {
  return p.treasuryWagonsOwned ?? 0;
}

export function playerTreasuryWagonsUnassigned(p: Player): number {
  return p.treasuryWagonsUnassigned ?? 0;
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
  for (const d of Object.values(s.districts ?? {})) {
    for (const b of d.buildings) {
      const bonus = buildingSettlementEffects(b.kind, b.level).storageBonus;
      if (!bonus) continue;
      for (const r of WAREHOUSE_RESOURCES) {
        cap[r] += bonus[r] ?? 0;
      }
    }
  }
  return cap;
}

export function settlementTreasuryCap(s: SettlementState): number {
  let cap = BASE_TREASURY[s.level];
  for (const b of s.buildings) {
    cap += buildingSettlementEffects(b.kind, b.level).treasuryBonus;
  }
  for (const d of Object.values(s.districts ?? {})) {
    for (const b of d.buildings) {
      cap += buildingSettlementEffects(b.kind, b.level).treasuryBonus;
    }
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
