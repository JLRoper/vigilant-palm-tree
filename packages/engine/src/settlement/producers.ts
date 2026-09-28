import type { BuildingDef, BuildingKind, ResourceType, SettlementState } from "@heroes/contracts";
import { buildingSettlementEffects } from "../buildingRegistry";
import { cellMultiplier, spotResourceAt } from "./cityMultipliers";

export type ProducerKind =
  | "goldMine"
  | "woodcutterHut"
  | "stoneMine"
  | "ironMine"
  | "mine"
  | "arcaneFont";
export type ProducerResource = Extract<ResourceType, "gold" | "wood" | "stone" | "iron" | "arcane">;

const PRODUCER_KINDS: readonly string[] = [
  "goldMine",
  "woodcutterHut",
  "stoneMine",
  "ironMine",
  "mine",
  "arcaneFont",
];

export function isProducerKind(kind: BuildingKind): kind is ProducerKind {
  return PRODUCER_KINDS.includes(kind);
}

const FIXED_PRODUCER_RESOURCE: Record<Exclude<ProducerKind, "mine">, ProducerResource> = {
  goldMine: "gold",
  woodcutterHut: "wood",
  stoneMine: "stone",
  ironMine: "iron",
  arcaneFont: "arcane",
};

export function producerResource(
  kind: ProducerKind,
  spots: readonly { cell: { x: number; y: number }; resource: ResourceType }[],
  gx: number,
  gy: number,
): ProducerResource {
  if (kind === "stoneMine") return "stone";
  if (kind === "ironMine") return "iron";
  if (kind === "mine") {
    const spot = spotResourceAt(spots, gx, gy);
    if (spot === "iron") return "iron";
    return "stone";
  }
  return FIXED_PRODUCER_RESOURCE[kind];
}

export function producerBasePerTurn(
  kind: ProducerKind,
  level: number,
  resource: ProducerResource,
): number {
  const effects = buildingSettlementEffects(kind, level);
  if (kind === "goldMine") return effects.goldPerTurn;
  if (resource === "gold") return 0;
  return effects.resourceYieldBonus?.[resource] ?? 0;
}

export interface ProducerOutput {
  resource: ProducerResource;
  multiplier: number;
  basePerTurn: number;
  amount: number;
}

export function producerTurnOutput(
  building: BuildingDef,
  settlement: Pick<SettlementState, "q" | "r" | "citySpots">,
  seed: number,
): ProducerOutput | null {
  if (!isProducerKind(building.kind)) return null;
  if (building.construction) return null;
  const kind: ProducerKind = building.kind;
  const resource = producerResource(kind, settlement.citySpots, building.gx, building.gy);
  const basePerTurn = producerBasePerTurn(kind, building.level, resource);
  if (basePerTurn <= 0) return null;
  const multiplier = cellMultiplier({
    seed,
    q: settlement.q,
    r: settlement.r,
    gx: building.gx,
    gy: building.gy,
    resource,
    spots: settlement.citySpots,
  });
  return {
    resource,
    multiplier,
    basePerTurn,
    amount: Math.round(basePerTurn * multiplier * 100) / 100,
  };
}
