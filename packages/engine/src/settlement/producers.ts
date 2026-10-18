import type { BuildingDef, BuildingKind, PlayerId, ResourceType, SettlementState } from "@heroes/contracts";
import { buildingSettlementEffects } from "../buildingRegistry";
import { cellMultiplier, spotResourceAt } from "./cityMultipliers";
import { effortFraction } from "./workforce";

export function isDistrictBlockedByHero(
  settlementOwnerId: PlayerId | null,
  dq: number,
  dr: number,
  heroes?: Iterable<{ ownerId: PlayerId; q: number; r: number }> | Record<string, { ownerId: PlayerId; q: number; r: number }>,
): boolean {
  if (!heroes) return false;
  const list = Symbol.iterator in Object(heroes)
    ? (heroes as Iterable<{ ownerId: PlayerId; q: number; r: number }>)
    : Object.values(heroes);
  for (const h of list) {
    if (h.q === dq && h.r === dr && h.ownerId !== settlementOwnerId) {
      return true;
    }
  }
  return false;
}

export type ProducerKind =
  | "goldMine"
  | "woodcutterHut"
  | "stoneMine"
  | "ironMine"
  | "mine"
  | "arcaneFont"
  | "farmField"
  | "farmhouse"
  | "granary";
export type ProducerResource = Extract<ResourceType, "gold" | "wood" | "stone" | "iron" | "arcane" | "food">;

const PRODUCER_KINDS: readonly string[] = [
  "goldMine",
  "woodcutterHut",
  "stoneMine",
  "ironMine",
  "mine",
  "arcaneFont",
  "farmField",
  "farmhouse",
  "granary",
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
  farmField: "food",
  farmhouse: "food",
  granary: "food",
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
  if (resource === "food") return effects.foodPerTurn;
  if (resource === "gold") return 0;
  return effects.resourceYieldBonus?.[resource] ?? 0;
}

export interface ProducerOutput {
  resource: ProducerResource;
  multiplier: number;
  basePerTurn: number;
  effort: number;
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
  const effort = effortFraction(building);
  return {
    resource,
    multiplier,
    basePerTurn,
    effort,
    amount: Math.round(basePerTurn * multiplier * effort * 100) / 100,
  };
}

export function buildingFallbackGold(b: BuildingDef): number {
  if (b.construction) return 0;
  if (isProducerKind(b.kind)) return 0;
  const flat = buildingSettlementEffects(b.kind, b.level).goldPerTurn;
  if (!(flat > 0)) return 0;
  return Math.round(flat * effortFraction(b) * 100) / 100;
}
