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
import { buildingFootprintFromRegistry, buildingUpgradeCost } from "../buildingRegistry";
import { districtKey } from "../control";
import { pickStyleForBuilding } from "../styleResolver";

/** Every grid cell a building occupies at a given level, as `"gx,gy"` keys.
 * The `ceil()` is the placement path's own rounding, so a building whose
 * registry footprint is fractional (1.5x1.5 at L2/L3) claims the same 2x2 block
 * `coversCell` blocks -- the client's click resolver and this check agree on
 * which cells are taken. */
function coveredCells(b: BuildingDef, level: number): string[] {
  const fp = buildingFootprintFromRegistry(b.kind, level);
  const w = Math.max(1, Math.ceil(b.w ?? fp.w));
  const h = Math.max(1, Math.ceil(b.h ?? fp.h));
  const cells: string[] = [];
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) cells.push(`${b.gx + dx},${b.gy + dy}`);
  }
  return cells;
}

/**
 * C-MAJOR-3. `buildingFootprintFromRegistry` grows several 1x1 producers
 * (`woodcutterHut`, `granary`, `bank`, `goldMine`) to 1.5x1.5 -- i.e. a 2x2
 * block of cells -- at L2/L3. Nothing validated the cells that growth NEWLY
 * claims, so an upgrade next to a neighbour was accepted and the bigger
 * building swallowed the neighbour's cell: clicking the neighbour then opened
 * the upgrader's menu and the neighbour's own controls were unreachable.
 *
 * Returns the refusal reason for the first conflict, or null when every request
 * fits. Cells the building already occupies are its own, and a pre-existing
 * overlap elsewhere in the grid must not block an unrelated upgrade, so only
 * the newly claimed cells are tested -- against every other building's cells
 * and against the other requests' new cells in the same command.
 */
function upgradeFootprintConflict(
  s: SettlementState,
  requests: BuildingUpgradeRequest[],
  district?: { q: number; r: number },
): string | null {
  const listFor = (dCoord?: { q: number; r: number }): BuildingDef[] =>
    dCoord ? (s.districts?.[districtKey(dCoord.q, dCoord.r)]?.buildings ?? []) : s.buildings;

  const byContainer = new Map<string, { list: BuildingDef[]; requested: BuildingDef[] }>();
  for (const req of requests) {
    const dCoord = req.district ?? district;
    const key = dCoord ? districtKey(dCoord.q, dCoord.r) : "main";
    let entry = byContainer.get(key);
    if (!entry) {
      entry = { list: listFor(dCoord), requested: [] };
      byContainer.set(key, entry);
    }
    const b = entry.list.find((x) => x.gx === req.gx && x.gy === req.gy && x.kind === req.kind);
    if (b) entry.requested.push(b);
  }

  for (const { list, requested } of byContainer.values()) {
    const upgrading = new Set(requested);
    const occupied = new Map<string, BuildingDef>();
    for (const b of list) {
      if (upgrading.has(b)) continue;
      for (const cell of coveredCells(b, b.level)) occupied.set(cell, b);
    }
    for (const b of requested) {
      const current = new Set(coveredCells(b, b.level));
      for (const cell of coveredCells(b, b.level + 1)) {
        if (current.has(cell)) continue;
        if (occupied.has(cell)) return "footprint_blocked";
        occupied.set(cell, b);
      }
    }
  }
  return null;
}

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

  // Refuse BEFORE any cost is charged: the whole command is atomic.
  const conflict = upgradeFootprintConflict(s, requests, district);
  if (conflict) return { state, ok: false, reason: conflict };

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
