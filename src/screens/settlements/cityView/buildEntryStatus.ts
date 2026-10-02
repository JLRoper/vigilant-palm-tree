import type { BuildingKind } from "@heroes/contracts";
import { buildingPlacementCost, buildingUpkeep } from "@heroes/engine";
import type { NetCost } from "./netCost";
import { footprintLine } from "./footprint";

const COST_RESOURCES = ["gold", "wood", "stone", "iron", "arcane"] as const;

type CostResource = (typeof COST_RESOURCES)[number];

export interface BuildEntryAffordability {
  gold: number;
  warehouse: {
    wood: number;
    stone: number;
    iron: number;
    arcane: number;
  };
}

export interface BuildEntryStatus {
  disabled: boolean;
  reasons: string[];
  title: string;
}

export interface BuildConfirmStatus {
  ok: boolean;
  reasons: string[];
  title: string;
}

export interface BuildEntryStatusOptions {
  kind: BuildingKind;
  affordability: BuildEntryAffordability | null;
  hasTownHall?: boolean;
}

export interface BuildConfirmStatusOptions {
  net: NetCost;
  charged: NetCost;
  affordability: BuildEntryAffordability | null;
}

export function buildEntryStatus(opts: BuildEntryStatusOptions): BuildEntryStatus {
  const blocking: string[] = [];
  if (opts.affordability) {
    const cost = buildingPlacementCost(opts.kind);
    for (const r of COST_RESOURCES) {
      const need = cost[r] ?? 0;
      const have = availableOf(opts.affordability, r);
      if (need > have) blocking.push(`Not enough ${r} (need ${need}, have ${have})`);
    }
  }
  if (opts.hasTownHall) blocking.push("A town hall already exists in this settlement");
  const reasons = [...blocking];
  const size = footprintLine(opts.kind);
  if (size) reasons.push(size);
  const upkeep = upkeepLine(opts.kind);
  if (upkeep) reasons.push(upkeep);
  return { disabled: blocking.length > 0, reasons, title: reasons.join("\n") };
}

export function buildConfirmStatus(opts: BuildConfirmStatusOptions): BuildConfirmStatus {
  const reasons: string[] = [];
  if (opts.affordability) {
    for (const r of COST_RESOURCES) {
      const needed = Math.max(0, (opts.net[r] ?? 0) - (opts.charged[r] ?? 0));
      const have = availableOf(opts.affordability, r);
      if (needed > have) reasons.push(`Not enough ${r} (need ${needed}, have ${have})`);
    }
  }
  return { ok: reasons.length === 0, reasons, title: reasons.join("\n") };
}

function availableOf(affordability: BuildEntryAffordability, r: CostResource): number {
  return r === "gold" ? affordability.gold : affordability.warehouse[r];
}

function upkeepLine(kind: BuildingKind): string {
  const upkeep = buildingUpkeep(kind, 1);
  const parts: string[] = [];
  if (upkeep.wood > 0) parts.push(`${upkeep.wood} wood`);
  if (upkeep.stone > 0) parts.push(`${upkeep.stone} stone`);
  return parts.length > 0 ? `Upkeep: ${parts.join(", ")} per turn` : "";
}
