import type { HeroState, Player, SettlementState } from "../../src/state/gameState";
import { WAREHOUSE_RESOURCES } from "../../src/state/gameState";

export type IntegritySeverity = "error" | "warning";

export interface IntegrityIssue {
  severity: IntegritySeverity;
  path: string;
  message: string;
}

export interface GameRowLike {
  round: number;
  day: number;
  active_player_id: number;
  players: Player[];
  heroes: Record<string, HeroState>;
  settlements: Record<string, SettlementState>;
}

const VALID_FACTIONS = new Set(["player", "ai"]);
const VALID_LEVELS = new Set([1, 2, 3]);

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Structural check for a game row. "error" = the row is malformed in a way
 * hydrateGameState can't safely paper over (bad references, wrong shapes).
 * "warning" = a field hydrateGameState will silently default on load, i.e.
 * schema drift that's tolerated but worth surfacing.
 */
export function validateGameRow(row: GameRowLike): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  const push = (severity: IntegritySeverity, path: string, message: string) =>
    issues.push({ severity, path, message });

  if (!isFiniteNumber(row.round) || row.round < 1) {
    push("error", "round", `round must be a positive integer, got ${JSON.stringify(row.round)}`);
  }
  if (row.day !== undefined && (!isFiniteNumber(row.day) || row.day < 1)) {
    push("warning", "day", `day is missing or invalid (defaults to round on load), got ${JSON.stringify(row.day)}`);
  }
  if (!Array.isArray(row.players) || row.players.length === 0) {
    push("error", "players", "players must be a non-empty array");
    return issues;
  }

  const playerIds = new Set<number>();
  for (const [i, p] of row.players.entries()) {
    const path = `players[${i}]`;
    if (!p || typeof p !== "object") {
      push("error", path, "player entry is not an object");
      continue;
    }
    if (!isFiniteNumber(p.id)) {
      push("error", `${path}.id`, `id must be a number, got ${JSON.stringify(p.id)}`);
    } else if (playerIds.has(p.id)) {
      push("error", `${path}.id`, `duplicate player id ${p.id}`);
    } else {
      playerIds.add(p.id);
    }
    if (!VALID_FACTIONS.has(p.faction)) {
      push("error", `${path}.faction`, `faction must be "player" or "ai", got ${JSON.stringify(p.faction)}`);
    }
    if (typeof p.name !== "string" || !p.name) {
      push("warning", `${path}.name`, "name is missing or empty");
    }
    if (typeof p.color !== "string" || !p.color) {
      push("warning", `${path}.color`, "color is missing or empty");
    }
    if (!Array.isArray(p.heroIds)) {
      push("error", `${path}.heroIds`, "heroIds must be an array");
    }
    if (!Array.isArray(p.settlementIds)) {
      push("error", `${path}.settlementIds`, "settlementIds must be an array");
    }
  }

  if (!isFiniteNumber(row.active_player_id)) {
    push("error", "active_player_id", `active_player_id must be a number, got ${JSON.stringify(row.active_player_id)}`);
  } else if (!playerIds.has(row.active_player_id)) {
    push("error", "active_player_id", `active_player_id ${row.active_player_id} does not match any player`);
  }

  if (!row.heroes || typeof row.heroes !== "object" || Array.isArray(row.heroes)) {
    push("error", "heroes", "heroes must be an object keyed by hero id");
  } else {
    for (const [key, h] of Object.entries(row.heroes)) {
      const path = `heroes.${key}`;
      if (!h || typeof h !== "object") {
        push("error", path, "hero entry is not an object");
        continue;
      }
      if (h.id !== key) {
        push("error", `${path}.id`, `hero key "${key}" does not match hero.id ${JSON.stringify(h.id)}`);
      }
      if (!isFiniteNumber(h.ownerId) || !playerIds.has(h.ownerId)) {
        push("error", `${path}.ownerId`, `ownerId ${JSON.stringify(h.ownerId)} does not match any player`);
      } else {
        const owner = row.players.find((p) => p.id === h.ownerId);
        if (owner && Array.isArray(owner.heroIds) && !owner.heroIds.includes(key)) {
          push("warning", path, `hero is not listed in owning player ${h.ownerId}'s heroIds`);
        }
      }
      if (!isFiniteNumber(h.q) || !isFiniteNumber(h.r)) {
        push("error", `${path}.q/r`, `q/r must be finite numbers, got q=${JSON.stringify(h.q)} r=${JSON.stringify(h.r)}`);
      }
      if (!isFiniteNumber(h.movementRemaining)) {
        push("warning", `${path}.movementRemaining`, "missing or invalid (defaulted to 7 on load)");
      }
      if (!isFiniteNumber(h.troops)) {
        push("warning", `${path}.troops`, "missing or invalid (defaulted to 1 on load)");
      }
      if (!Array.isArray(h.stacks)) {
        push("warning", `${path}.stacks`, "missing or invalid (defaulted on load)");
      }
    }
  }

  if (!row.settlements || typeof row.settlements !== "object" || Array.isArray(row.settlements)) {
    push("error", "settlements", "settlements must be an object keyed by settlement id");
  } else {
    for (const [key, s] of Object.entries(row.settlements)) {
      const path = `settlements.${key}`;
      if (!s || typeof s !== "object") {
        push("error", path, "settlement entry is not an object");
        continue;
      }
      if (s.id !== key) {
        push("error", `${path}.id`, `settlement key "${key}" does not match settlement.id ${JSON.stringify(s.id)}`);
      }
      if (!isFiniteNumber(s.q) || !isFiniteNumber(s.r)) {
        push("error", `${path}.q/r`, `q/r must be finite numbers, got q=${JSON.stringify(s.q)} r=${JSON.stringify(s.r)}`);
      }
      if (!VALID_LEVELS.has(s.level)) {
        push("error", `${path}.level`, `level must be 1, 2, or 3, got ${JSON.stringify(s.level)}`);
      }
      if (s.ownerId !== null && s.ownerId !== undefined) {
        if (!isFiniteNumber(s.ownerId) || !playerIds.has(s.ownerId)) {
          push("error", `${path}.ownerId`, `ownerId ${JSON.stringify(s.ownerId)} does not match any player`);
        } else {
          const owner = row.players.find((p) => p.id === s.ownerId);
          if (owner && Array.isArray(owner.settlementIds) && !owner.settlementIds.includes(key)) {
            push("warning", path, `settlement is not listed in owning player ${s.ownerId}'s settlementIds`);
          }
        }
      }
      if (!s.warehouse || typeof s.warehouse !== "object") {
        push("warning", `${path}.warehouse`, "missing (defaulted to zeros on load)");
      } else {
        for (const res of WAREHOUSE_RESOURCES) {
          if (!isFiniteNumber((s.warehouse as Partial<Record<string, unknown>>)[res])) {
            push("warning", `${path}.warehouse.${res}`, "missing or invalid (defaulted to 0 on load)");
          }
        }
      }
    }
  }

  for (const p of row.players) {
    if (!p || typeof p !== "object") continue;
    if (Array.isArray(p.heroIds)) {
      for (const hid of p.heroIds) {
        if (!(hid in (row.heroes ?? {}))) {
          push("warning", `players[id=${p.id}].heroIds`, `references hero "${hid}" which does not exist`);
        }
      }
    }
    if (Array.isArray(p.settlementIds)) {
      for (const sid of p.settlementIds) {
        if (!(sid in (row.settlements ?? {}))) {
          push("warning", `players[id=${p.id}].settlementIds`, `references settlement "${sid}" which does not exist`);
        }
      }
    }
  }

  return issues;
}

export function isHealthy(issues: IntegrityIssue[]): boolean {
  return !issues.some((i) => i.severity === "error");
}
