import type { GameState, HeroId } from "@heroes/contracts";
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

export function validCharterHexes(state: GameState, map: GameMap): Set<string> {
  const hexes = new Set<string>();
  const settlementSet = new Set<string>();
  for (const s of Object.values(state.settlements)) {
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

  for (let r = 0; r < map.height; r++) {
    for (let q = 0; q < map.width; q++) {
      if (!map.isPassable(q, r)) continue;
      const key = `${q},${r}`;
      if (settlementSet.has(key)) continue;
      if (charterSet.has(key)) continue;
      if (heroSet.has(key)) continue;
      let tooClose = false;
      for (const s of Object.values(state.settlements)) {
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
