import type { GameState, SettlementId, SettlementState, StartUpgradeResult, UpgradeState } from "@heroes/contracts";

export const TOWN_HALL_COSTS: Record<number, { gold: number; wood: number; stone: number; days: number }> = {
  1: { gold: 1500, wood: 15, stone: 10, days: 7 },
  2: { gold: 5000, wood: 40, stone: 25, days: 12 },
};

export function startTownHallUpgrade(state: GameState, settlementId: SettlementId, targetLevel: 2 | 3): StartUpgradeResult {
  const s = state.settlements[settlementId];
  if (!s) return { state, ok: false, reason: "no_settlement" };
  if (s.upgrade) return { state, ok: false, reason: "upgrade_in_progress" };
  const cost = TOWN_HALL_COSTS[targetLevel - 1];
  if (!cost) return { state, ok: false, reason: "invalid_level" };
  if (s.gold < cost.gold) return { state, ok: false, reason: "insufficient_gold" };
  if ((s.warehouse.wood ?? 0) < cost.wood) return { state, ok: false, reason: "insufficient_wood" };
  if ((s.warehouse.stone ?? 0) < cost.stone) return { state, ok: false, reason: "insufficient_stone" };

  const townHall = s.buildings.find((b) => b.kind === "townHall");
  if (!townHall || townHall.level !== targetLevel - 1) return { state, ok: false, reason: "town_hall_level_mismatch" };

  const upgrade: UpgradeState = { kind: "townHall", targetLevel, daysRemaining: cost.days };
  const updated: SettlementState = {
    ...s,
    gold: s.gold - cost.gold,
    warehouse: {
      ...s.warehouse,
      wood: (s.warehouse.wood ?? 0) - cost.wood,
      stone: (s.warehouse.stone ?? 0) - cost.stone,
    },
    upgrade,
  };
  return {
    state: { ...state, settlements: { ...state.settlements, [settlementId]: updated }, dirty: true },
    ok: true,
  };
}
