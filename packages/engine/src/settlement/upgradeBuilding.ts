import type {
  BuildingDef,
  BuildingRef,
  BuildingUpgradeRequest,
  DistrictState,
  GameState,
  SettlementId,
  SettlementState,
  StartUpgradeResult,
  UpgradeState,
} from "@heroes/contracts";
import { buildingUpgradeCost } from "../buildingRegistry";
import { districtKey } from "../control";
import { pickStyleForBuilding } from "../styleResolver";

export function startBuildingUpgrade(
  state: GameState,
  settlementId: SettlementId,
  requests: BuildingUpgradeRequest[],
  district?: { q: number; r: number },
): StartUpgradeResult {
  const s = state.settlements[settlementId];
  if (!s) return { state, ok: false, reason: "no_settlement" };
  if (s.upgrade) return { state, ok: false, reason: "upgrade_in_progress" };
  if (requests.length === 0) return { state, ok: false, reason: "no_buildings" };

  let totalGold = 0;
  let totalWood = 0;
  let totalStone = 0;
  let maxDays = 0;
  const seenKeys = new Set<string>();

  for (const req of requests) {
    const dCoord = req.district ?? district;
    const refKey = `${dCoord ? `${dCoord.q},${dCoord.r}:` : "main:"}${req.gx},${req.gy},${req.kind}`;
    if (seenKeys.has(refKey)) {
      return { state, ok: false, reason: "duplicate_building_ref" };
    }
    seenKeys.add(refKey);
    const list = dCoord
      ? (s.districts?.[districtKey(dCoord.q, dCoord.r)]?.buildings ?? [])
      : s.buildings;
    const b = list.find((x) => x.gx === req.gx && x.gy === req.gy && x.kind === req.kind);
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
    buildingRefs: requests.map((r) => {
      const dCoord = r.district ?? district;
      return {
        gx: r.gx,
        gy: r.gy,
        kind: r.kind,
        ...(dCoord ? { district: { q: dCoord.q, r: dCoord.r } } : {}),
      };
    }),
    ...(district ? { district: { q: district.q, r: district.r } } : {}),
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
  district?: { q: number; r: number },
): GameState {
  const s = state.settlements[settlementId];
  if (!s) return state;
  const mainRefs = refs.filter((r) => !(r.district ?? district));
  const buildings =
    mainRefs.length > 0
      ? s.buildings.map((b) => {
          const ref = mainRefs.find((r) => r.gx === b.gx && r.gy === b.gy && r.kind === b.kind);
          if (!ref || b.level >= 3) return b;
          const newLevel = (b.level + 1) as 2 | 3;
          const newStyle = pickStyleForBuilding(b.kind, newLevel, b.style);
          return { ...b, level: newLevel, style: newStyle };
        })
      : s.buildings;
  let districts: Record<string, DistrictState> | undefined = s.districts;
  if (districts) {
    const byDistrict = new Map<string, BuildingRef[]>();
    for (const r of refs) {
      const dCoord = r.district ?? district;
      if (!dCoord) continue;
      const key = districtKey(dCoord.q, dCoord.r);
      const bucket = byDistrict.get(key);
      if (bucket) bucket.push(r);
      else byDistrict.set(key, [r]);
    }
    for (const [key, dRefs] of byDistrict) {
      const d: DistrictState | undefined = districts[key];
      if (!d) continue;
      const dBuildings: BuildingDef[] = d.buildings.map((b: BuildingDef) => {
        const match = dRefs.some((r) => r.gx === b.gx && r.gy === b.gy && r.kind === b.kind);
        if (!match || b.level >= 3) return b;
        const newLevel = (b.level + 1) as 2 | 3;
        const newStyle = pickStyleForBuilding(b.kind, newLevel, b.style);
        return { ...b, level: newLevel, style: newStyle };
      });
      districts = { ...districts, [key]: { ...d, buildings: dBuildings } };
    }
  }
  return {
    ...state,
    settlements: {
      ...state.settlements,
      [settlementId]: { ...s, buildings, ...(districts ? { districts } : {}) },
    },
    dirty: true,
  };
}
