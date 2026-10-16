import type { Axial, GameState, HeroId } from "@heroes/contracts";
import type { GameMap } from "../map/gameMap";
import { hexDistance } from "../map/pathfinding";
import { CHARTER_GOLD_COST, CHARTER_WAREHOUSE_COST } from "./start";

export const CHARTER_PURSE_HINT =
  "Withdraw gold from a friendly settlement's treasury — your hero must stand on it (hero panel → Withdraw all)";

export const CHARTER_MIN_SETTLEMENT_DISTANCE = 4;

export interface CharterRequirementRow {
  key: "heroSelected" | "notChartering" | "onFriendlySettlement" | "purse" | "warehouseWood" | "warehouseStone";
  label: string;
  ok: boolean;
  detail: string;
}

export interface CharterRequirements {
  canStart: boolean;
  missing: string[];
  hints: string[];
  rows: CharterRequirementRow[];
}

export function evaluateCharterRequirements(state: GameState, heroId: HeroId | null): CharterRequirements {
  const hero = heroId != null ? state.heroes[heroId] : undefined;
  const provisioning = hero
    ? Object.values(state.settlements).find(
        (s) => s.q === hero.q && s.r === hero.r && s.ownerId === hero.ownerId,
      )
    : undefined;

  const woodNow = provisioning ? (provisioning.warehouse.wood ?? 0) : 0;
  const stoneNow = provisioning ? (provisioning.warehouse.stone ?? 0) : 0;

  const rows: CharterRequirementRow[] = [
    {
      key: "heroSelected",
      label: "Hero selected",
      ok: hero != null,
      detail: hero ? hero.name : "No hero selected",
    },
    {
      key: "notChartering",
      label: "Not already chartering",
      ok: hero != null && !hero.isChartering,
      detail: hero ? (hero.isChartering ? "Already chartering" : "Ready") : "—",
    },
    {
      key: "onFriendlySettlement",
      label: "On friendly settlement",
      ok: provisioning != null,
      detail: provisioning ? `Standing on ${provisioning.name}` : "Not on a friendly settlement",
    },
    {
      key: "purse",
      label: "Purse",
      ok: hero != null && hero.gold >= CHARTER_GOLD_COST,
      detail: hero ? `${hero.gold}/${CHARTER_GOLD_COST}g` : "—",
    },
    {
      key: "warehouseWood",
      label: "Warehouse wood",
      ok: provisioning != null && woodNow >= CHARTER_WAREHOUSE_COST.wood,
      detail: provisioning ? `${woodNow}/${CHARTER_WAREHOUSE_COST.wood}` : "—",
    },
    {
      key: "warehouseStone",
      label: "Warehouse stone",
      ok: provisioning != null && stoneNow >= CHARTER_WAREHOUSE_COST.stone,
      detail: provisioning ? `${stoneNow}/${CHARTER_WAREHOUSE_COST.stone}` : "—",
    },
  ];

  const missing: string[] = [];
  const hints: string[] = [];
  if (!hero) {
    missing.push("No hero selected");
  } else {
    if (hero.isChartering) missing.push("Hero is already chartering");
    if (!provisioning) {
      missing.push("Hero must stand on a friendly settlement");
    }
    if (hero.gold < CHARTER_GOLD_COST) {
      missing.push(`Purse ${hero.gold}/${CHARTER_GOLD_COST}g`);
      hints.push(CHARTER_PURSE_HINT);
    }
    if (provisioning) {
      if (woodNow < CHARTER_WAREHOUSE_COST.wood) {
        missing.push(`Warehouse wood ${woodNow}/${CHARTER_WAREHOUSE_COST.wood}`);
      }
      if (stoneNow < CHARTER_WAREHOUSE_COST.stone) {
        missing.push(`Warehouse stone ${stoneNow}/${CHARTER_WAREHOUSE_COST.stone}`);
      }
    }
  }

  return { canStart: missing.length === 0, missing, hints, rows };
}

export interface ValidCharterHexesOptions {
  center?: Axial;
  maxDistance?: number;
}

export function validCharterHexes(
  state: GameState,
  map: GameMap,
  opts?: ValidCharterHexesOptions,
): Set<string> {
  const hexes = new Set<string>();
  const width = map.width;
  const height = map.height;
  const settlements = Object.values(state.settlements);

  const center = opts?.center;
  const maxDist = opts?.maxDistance;
  const hasRadiusBound = center != null && typeof maxDist === "number" && Number.isFinite(maxDist);
  const rMin = hasRadiusBound ? Math.max(0, Math.ceil(center.r - maxDist)) : 0;
  const rMax = hasRadiusBound ? Math.min(height - 1, Math.floor(center.r + maxDist)) : height - 1;
  const qMin = hasRadiusBound ? Math.max(0, Math.ceil(center.q - maxDist)) : 0;
  const qMax = hasRadiusBound ? Math.min(width - 1, Math.floor(center.q + maxDist)) : width - 1;

  if (Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0) {
    const forbidden = new Uint8Array(width * height);
    const radius = CHARTER_MIN_SETTLEMENT_DISTANCE - 1;
    for (const s of settlements) {
      for (let dr = -radius; dr <= radius; dr++) {
        const nr = s.r + dr;
        if (nr < 0 || nr >= height) continue;
        const rowOffset = nr * width;
        for (let dq = -radius; dq <= radius; dq++) {
          if (Math.abs(dq + dr) > radius) continue;
          const nq = s.q + dq;
          if (nq < 0 || nq >= width) continue;
          forbidden[rowOffset + nq] = 1;
        }
      }
    }
    for (const c of state.activeCharters) {
      if (c.targetQ >= 0 && c.targetQ < width && c.targetR >= 0 && c.targetR < height) {
        forbidden[c.targetR * width + c.targetQ] = 1;
      }
    }
    for (const h of Object.values(state.heroes)) {
      if (h.q >= 0 && h.q < width && h.r >= 0 && h.r < height) {
        forbidden[h.r * width + h.q] = 1;
      }
    }

    for (let r = rMin; r <= rMax; r++) {
      const rowOffset = r * width;
      for (let q = qMin; q <= qMax; q++) {
        if (forbidden[rowOffset + q]) continue;
        if (hasRadiusBound && hexDistance(center, { q, r }) > maxDist) continue;
        if (!map.isPassable(q, r)) continue;
        hexes.add(`${q},${r}`);
      }
    }
    return hexes;
  }

  const settlementSet = new Set<string>();
  for (const s of settlements) {
    settlementSet.add(`${s.q},${s.r}`);
  }
  const charterSet = new Set<string>();
  for (const c of state.activeCharters) {
    charterSet.add(`${c.targetQ},${c.targetR}`);
  }
  const heroSet = new Set<string>();
  for (const h of Object.values(state.heroes)) {
    heroSet.add(`${h.q},${h.r}`);
  }

  for (let r = rMin; r <= rMax; r++) {
    for (let q = qMin; q <= qMax; q++) {
      if (hasRadiusBound && hexDistance(center, { q, r }) > maxDist) continue;
      if (!map.isPassable(q, r)) continue;
      const key = `${q},${r}`;
      if (settlementSet.has(key)) continue;
      if (charterSet.has(key)) continue;
      if (heroSet.has(key)) continue;
      let tooClose = false;
      for (const s of settlements) {
        if (hexDistance({ q, r }, { q: s.q, r: s.r }) < CHARTER_MIN_SETTLEMENT_DISTANCE) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;
      hexes.add(key);
    }
  }
  return hexes;
}
