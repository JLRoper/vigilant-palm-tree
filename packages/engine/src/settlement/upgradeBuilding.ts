import type {
  BuildingDef,
  BuildingRef,
  BuildingUpgradeRequest,
  GameState,
  SettlementId,
  SettlementState,
  StartUpgradeResult,
  UpgradeState,
} from "@heroes/contracts";
import { buildingUpgradeCost } from "../buildingRegistry";
import { pickStyleForBuilding } from "../styleResolver";

export function startBuildingUpgrade(
  state: GameState,
  settlementId: SettlementId,
  requests: BuildingUpgradeRequest[],
): StartUpgradeResult {
  const s = state.settlements[settlementId];
  if (!s) return { state, ok: false, reason: "no_settlement" };
  if (s.upgrade) return { state, ok: false, reason: "upgrade_in_progress" };
  if (requests.length === 0) return { state, ok: false, reason: "no_buildings" };

  let totalGold = 0;
  let totalWood = 0;
  let totalStone = 0;
  let maxDays = 0;

  for (const req of requests) {
    const b = s.buildings.find((x) => x.gx === req.gx && x.gy === req.gy && x.kind === req.kind);
    if (!b) return { state, ok: false, reason: "building_not_found" };
    if (b.level >= 3) return { state, ok: false, reason: "max_level" };
    const cost = buildingUpgradeCost(req.kind, b.level);
    if (!cost) return { state, ok: false, reason: "no_cost_for_level" };
    totalGold += cost.gold;
    totalWood += cost.wood;
    totalStone += cost.stone;
    maxDays = Math.max(maxDays, cost.days);
  }

  if (s.gold < totalGold) return { state, ok: false, reason: "insufficient_gold" };
  if ((s.warehouse.wood ?? 0) < totalWood) return { state, ok: false, reason: "insufficient_wood" };
  if ((s.warehouse.stone ?? 0) < totalStone) return { state, ok: false, reason: "insufficient_stone" };

  const upgrade: UpgradeState = {
    kind: "buildings",
    targetLevel: 3,
    daysRemaining: maxDays,
    buildingRefs: requests.map((r) => ({ gx: r.gx, gy: r.gy, kind: r.kind })),
  };

  const updated: SettlementState = {
    ...s,
    gold: s.gold - totalGold,
    warehouse: {
      ...s.warehouse,
      wood: (s.warehouse.wood ?? 0) - totalWood,
      stone: (s.warehouse.stone ?? 0) - totalStone,
    },
    upgrade,
  };

  return {
    state: { ...state, settlements: { ...state.settlements, [settlementId]: updated }, dirty: true },
    ok: true,
  };
}

export function applyBuildingUpgrade(
  state: GameState,
  settlementId: SettlementId,
  refs: BuildingRef[],
): GameState {
  const s = state.settlements[settlementId];
  if (!s) return state;
  const buildings = s.buildings.map((b) => {
    const ref = refs.find((r) => r.gx === b.gx && r.gy === b.gy && r.kind === b.kind);
    if (!ref || b.level >= 3) return b;
    const newLevel = (b.level + 1) as 2 | 3;
    const newStyle = pickStyleForBuilding(b.kind, newLevel, b.style) as BuildingDef["style"];
    return { ...b, level: newLevel, style: newStyle };
  });
  return {
    ...state,
    settlements: { ...state.settlements, [settlementId]: { ...s, buildings } },
    dirty: true,
  };
}
