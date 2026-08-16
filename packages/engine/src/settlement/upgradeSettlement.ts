import type { GameState, ResourceType, SettlementId, SettlementState, StartUpgradeResult, UpgradeState } from "@heroes/contracts";
import { POP_BY_LEVEL } from "../economy/settlementRates";

export const SETTLEMENT_UPGRADE_COSTS: Record<number, { gold: number; wood: number; stone: number; iron: number; arcane: number; days: number }> = {
  1: { gold: 5000, wood: 40, stone: 30, iron: 20, arcane: 0, days: 15 },
  2: { gold: 15000, wood: 80, stone: 60, iron: 50, arcane: 20, days: 25 },
};

export function startSettlementUpgrade(
  state: GameState,
  settlementId: SettlementId,
  targetLevel: 2 | 3,
  newResourceRates: Partial<Record<ResourceType, number>>,
  newCitySpots: Array<{ cell: { x: number; y: number }; resource: ResourceType; vein: string }>,
  upgradePopulationGate: number,
): StartUpgradeResult {
  const s = state.settlements[settlementId];
  if (!s) return { state, ok: false, reason: "no_settlement" };
  if (s.upgrade) return { state, ok: false, reason: "upgrade_in_progress" };
  if (s.level !== targetLevel - 1) return { state, ok: false, reason: "invalid_level" };
  const cost = SETTLEMENT_UPGRADE_COSTS[s.level];
  if (!cost) return { state, ok: false, reason: "invalid_level" };
  if (s.gold < cost.gold) return { state, ok: false, reason: "insufficient_gold" };
  if ((s.warehouse.wood ?? 0) < cost.wood) return { state, ok: false, reason: "insufficient_wood" };
  if ((s.warehouse.stone ?? 0) < cost.stone) return { state, ok: false, reason: "insufficient_stone" };
  if ((s.warehouse.iron ?? 0) < cost.iron) return { state, ok: false, reason: "insufficient_iron" };
  if ((s.warehouse.arcane ?? 0) < cost.arcane) return { state, ok: false, reason: "insufficient_arcane" };

  const levelMax = POP_BY_LEVEL[s.level] ?? 500;
  if (s.population < upgradePopulationGate * levelMax) return { state, ok: false, reason: "population_too_low" };

  const townHall = s.buildings.find((b) => b.kind === "townHall");
  if (!townHall || townHall.level < targetLevel) return { state, ok: false, reason: "town_hall_level_too_low" };

  const upgrade: UpgradeState = {
    kind: "settlement",
    targetLevel,
    daysRemaining: cost.days,
    newResourceRates,
    newCitySpots,
  };
  const updated: SettlementState = {
    ...s,
    gold: s.gold - cost.gold,
    warehouse: {
      ...s.warehouse,
      wood: (s.warehouse.wood ?? 0) - cost.wood,
      stone: (s.warehouse.stone ?? 0) - cost.stone,
      iron: (s.warehouse.iron ?? 0) - cost.iron,
      arcane: (s.warehouse.arcane ?? 0) - cost.arcane,
    },
    upgrade,
  };
  return {
    state: { ...state, settlements: { ...state.settlements, [settlementId]: updated }, dirty: true },
    ok: true,
  };
}
