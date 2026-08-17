import type { Pool, PoolClient } from "pg";
import type { HeroId, HeroState, Player, SettlementId, SettlementState } from "@heroes/contracts";

// Accepts either the shared pool (reads, or writes outside a transaction) or
// a PoolClient already inside a caller-owned transaction (writes that must
// commit/rollback atomically with other repo calls) - see withTransaction in
// ../db.ts.
export type Queryable = Pick<Pool | PoolClient, "query">;

export interface LobbyState {
  seats?: number;
  humanSlots?: number;
  claimed?: Record<string, { handle: string; claimedAt: string }>;
  startedAt?: string;
}

export interface EnemyPos {
  q: number;
  r: number;
}

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
  // TIMESTAMPTZ columns - node-postgres returns these as Date, not string.
  created_at: Date;
  updated_at: Date;
}

export class GameNotFoundError extends Error {
  constructor(name: string) {
    super(`game not found: ${name}`);
    this.name = "GameNotFoundError";
  }
}

const GAME_COLUMNS =
  "id, name, seed, hero_q, hero_r, turn, gold, enemy_positions, round, day, active_player_id, players, heroes, settlements, map_size, lobby, created_at, updated_at";

export interface GameRepo {
  load(name: string): Promise<GameRow>;
  saveHeroesAndSettlements(
    name: string,
    heroes: Record<HeroId, HeroState>,
    settlements: Record<SettlementId, SettlementState>,
    extra?: { players?: Player[]; gold?: number },
  ): Promise<void>;
}

export function createGameRepo(db: Queryable): GameRepo {
  return {
    async load(name) {
      const r = await db.query<GameRow>(
        `SELECT ${GAME_COLUMNS} FROM games WHERE name = $1`,
        [name],
      );
      if (r.rowCount === 0) throw new GameNotFoundError(name);
      return r.rows[0];
    },

    async saveHeroesAndSettlements(name, heroes, settlements, extra) {
      const sets = ["heroes = $1::jsonb", "settlements = $2::jsonb"];
      const vals: unknown[] = [JSON.stringify(heroes), JSON.stringify(settlements)];
      let i = 3;
      if (extra?.players !== undefined) {
        sets.push(`players = $${i++}::jsonb`);
        vals.push(JSON.stringify(extra.players));
      }
      if (extra?.gold !== undefined) {
        sets.push(`gold = $${i++}`);
        vals.push(extra.gold);
      }
      sets.push("updated_at = now()");
      vals.push(name);
      const r = await db.query(
        `UPDATE games SET ${sets.join(", ")} WHERE name = $${i}`,
        vals,
      );
      if (r.rowCount === 0) throw new GameNotFoundError(name);
    },
  };
}
