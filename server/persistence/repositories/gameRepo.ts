import type { Pool, PoolClient } from "pg";
import type {
  HeroId,
  HeroState,
  Player,
  SettlementId,
  SettlementState,
  Warehouse,
  WarehouseResource,
} from "@heroes/contracts";

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
  next_charter_id: number;
  next_settlement_id: number;
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
  "id, name, seed, hero_q, hero_r, turn, gold, enemy_positions, round, day, active_player_id, players, heroes, settlements, map_size, lobby, next_charter_id, next_settlement_id, created_at, updated_at";

export interface SaveHeroesAndSettlementsExtra {
  players?: Player[];
  gold?: number;
  // EndTurn's round-advance needs to move all three of these atomically
  // alongside heroes/settlements/players -- see
  // server/app/commandHandler.ts's EndTurn case.
  round?: number;
  day?: number;
  active_player_id?: number;
  // StartCharter's counter-persistence gap (plan/2026-08-17-consolidated-
  // phase-1-5-track-map.md §5.1 R5): these two must move atomically with
  // heroes/settlements too, or a second StartCharter in the same game
  // before a reload can collide charterId/settlementId with the first.
  next_charter_id?: number;
  next_settlement_id?: number;
}

// One row per settlement snapshot, matching the columns the now-dead
// server/routes.ts POST /games/:name/end-turn route used to write on every
// turn end (see #89) -- restoring this table's writes as a Track 3.B repo
// method so Track 3.A's EndTurn case has something to call once it's wired
// in. Batched (array, not one method per row) because EndTurn always writes
// one of these per settlement owned by the player whose turn just ended,
// same as the old route did in a loop.
export interface SettlementSnapshotInput {
  settlementId: SettlementId;
  day: number;
  gold: number;
  warehouse: Warehouse;
  morale: number;
  effectiveIncome: number;
}

// Mirrors resource_transactions' columns; one row per auto-trade transfer
// applyEndOfTurnDetailed() produces during EndTurn. fromSettlementId is
// nullable in the schema (server/schema.sql doesn't constrain it NOT NULL)
// even though auto_trade transfers always have one today -- kept optional
// here to match the column, not the one reason currently in use.
export interface ResourceTransactionInput {
  fromSettlementId: SettlementId | null;
  toSettlementId: SettlementId;
  resource: WarehouseResource;
  amount: number;
  goldPaid: number;
  reason?: string;
}

export interface GameRepo {
  load(name: string): Promise<GameRow>;
  saveHeroesAndSettlements(
    name: string,
    heroes: Record<HeroId, HeroState>,
    settlements: Record<SettlementId, SettlementState>,
    extra?: SaveHeroesAndSettlementsExtra,
  ): Promise<void>;
  insertSettlementSnapshots(gameName: string, snapshots: SettlementSnapshotInput[]): Promise<void>;
  insertResourceTransactions(gameName: string, transactions: ResourceTransactionInput[]): Promise<void>;
}

// Exported for the other repos in this directory (heroRepo, settlementRepo,
// charterRepo, tileRepo) -- every repo call site works off gameName, not the
// numeric id (see plan/2026-08-17-phase-4-db-deblobbing-dev-plan.md's
// "Pre-agreed repo interface" section), so this same resolution step would
// otherwise be duplicated in all five files instead of just called from four.
export async function resolveGameId(db: Queryable, name: string): Promise<number> {
  const r = await db.query<{ id: number }>("SELECT id FROM games WHERE name = $1", [name]);
  if (r.rowCount === 0) throw new GameNotFoundError(name);
  return r.rows[0].id;
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
      if (extra?.round !== undefined) {
        sets.push(`round = $${i++}`);
        vals.push(extra.round);
      }
      if (extra?.day !== undefined) {
        sets.push(`day = $${i++}`);
        vals.push(extra.day);
      }
      if (extra?.active_player_id !== undefined) {
        sets.push(`active_player_id = $${i++}`);
        vals.push(extra.active_player_id);
      }
      if (extra?.next_charter_id !== undefined) {
        sets.push(`next_charter_id = $${i++}`);
        vals.push(extra.next_charter_id);
      }
      if (extra?.next_settlement_id !== undefined) {
        sets.push(`next_settlement_id = $${i++}`);
        vals.push(extra.next_settlement_id);
      }
      sets.push("updated_at = now()");
      vals.push(name);
      const r = await db.query(
        `UPDATE games SET ${sets.join(", ")} WHERE name = $${i}`,
        vals,
      );
      if (r.rowCount === 0) throw new GameNotFoundError(name);
    },

    async insertSettlementSnapshots(gameName, snapshots) {
      if (snapshots.length === 0) return;
      const gameId = await resolveGameId(db, gameName);
      for (const s of snapshots) {
        await db.query(
          `INSERT INTO settlement_snapshots
             (game_id, settlement_id, day, gold, warehouse, morale, effective_income)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
           ON CONFLICT (game_id, settlement_id, day) DO NOTHING`,
          [gameId, s.settlementId, s.day, s.gold, JSON.stringify(s.warehouse), s.morale, s.effectiveIncome],
        );
      }
    },

    async insertResourceTransactions(gameName, transactions) {
      if (transactions.length === 0) return;
      const gameId = await resolveGameId(db, gameName);
      for (const t of transactions) {
        await db.query(
          `INSERT INTO resource_transactions
             (game_id, from_settlement_id, to_settlement_id, resource, amount, gold_paid, reason)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [gameId, t.fromSettlementId, t.toSettlementId, t.resource, t.amount, t.goldPaid, t.reason ?? "auto_trade"],
        );
      }
    },
  };
}
