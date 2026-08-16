import type { HeroId, HeroState, Player, SettlementId, SettlementState } from "@heroes/contracts";
import { pool, withTransaction } from "../db";

export interface LobbyState {
  seats?: number;
  humanSlots?: number;
  claimed?: Record<string, { handle: string; claimedAt: string }>;
  startedAt?: string;
}

type EnemyPos = { q: number; r: number };

// The games row shape, as persisted today (JSONB heroes/settlements columns,
// no separate tables -- see plan/2026-08-16-phase-3-parallel-dev-plan.md's
// Phase-4 note on why heroRepo/settlementRepo don't exist yet).
export interface GameRow {
  id: number;
  name: string;
  seed: number;
  hero_q: number;
  hero_r: number;
  turn: number;
  gold: number;
  enemy_positions: EnemyPos[];
  round: number;
  day: number;
  active_player_id: number;
  players: Player[];
  heroes: Record<HeroId, HeroState>;
  settlements: Record<SettlementId, SettlementState>;
  map_size: string;
  lobby: LobbyState;
  created_at: string;
  updated_at: string;
}

const GAME_COLUMNS =
  "id, name, seed, hero_q, hero_r, turn, gold, enemy_positions, round, day, active_player_id, players, heroes, settlements, map_size, lobby, created_at, updated_at";

function sumPlayerGold(
  players: Player[],
  heroes: Record<string, HeroState>,
  settlements: Record<string, SettlementState>,
): number {
  let total = 0;
  const playerIds = new Set(players.map((p) => p.id));
  for (const h of Object.values(heroes)) {
    if (playerIds.has(h.ownerId) && Number.isFinite(h.gold)) total += h.gold;
  }
  for (const s of Object.values(settlements)) {
    if (s.ownerId !== null && playerIds.has(s.ownerId) && Number.isFinite(s.gold)) total += s.gold;
  }
  return total;
}

export interface GameRepo {
  load(name: string): Promise<GameRow>;
  saveHeroesAndSettlements(
    name: string,
    heroes: Record<HeroId, HeroState>,
    settlements: Record<SettlementId, SettlementState>,
  ): Promise<void>;
}

export interface EventRepo {
  append(gameId: number, kind: string, payload: unknown): Promise<void>;
}

export function makeGameRepo(): GameRepo {
  return {
    async load(name) {
      const r = await pool.query<GameRow>(
        `SELECT ${GAME_COLUMNS} FROM games WHERE name = $1`,
        [name],
      );
      if (r.rowCount === 0) {
        throw new Error(`game not found: ${name}`);
      }
      return r.rows[0];
    },

    async saveHeroesAndSettlements(name, heroes, settlements) {
      await withTransaction(async (client) => {
        // Locks the row for the duration of the derived-gold recompute below,
        // matching the read-then-write shape the pre-command-bus handlers
        // already used for the same columns.
        const r = await client.query<Pick<GameRow, "id" | "players">>(
          `SELECT id, players FROM games WHERE name = $1 FOR UPDATE`,
          [name],
        );
        if (r.rowCount === 0) {
          throw new Error(`game not found: ${name}`);
        }
        const { id, players } = r.rows[0];
        // players/gold are derived/denormalized bookkeeping, not business
        // logic -- recomputed here so callers don't need a wider interface
        // than the pre-agreed load/saveHeroesAndSettlements shape.
        const legacyGold = sumPlayerGold(players, heroes, settlements);
        await client.query(
          `UPDATE games SET
             players = $1::jsonb,
             heroes = $2::jsonb,
             settlements = $3::jsonb,
             gold = $4,
             updated_at = now()
           WHERE id = $5`,
          [JSON.stringify(players), JSON.stringify(heroes), JSON.stringify(settlements), legacyGold, id],
        );
      });
    },
  };
}

export function makeEventRepo(): EventRepo {
  return {
    async append(gameId, kind, payload) {
      await pool.query(
        `INSERT INTO game_events (game_id, kind, payload) VALUES ($1, $2, $3::jsonb)`,
        [gameId, kind, JSON.stringify(payload)],
      );
    },
  };
}
