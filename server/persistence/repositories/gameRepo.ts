import type { Pool, PoolClient } from "pg";
import type {
  HeroId,
  HeroState,
  Player,
  SettlementId,
  SettlementState,
  TradeRouteState,
  Warehouse,
  WarehouseResource,
} from "@heroes/contracts";
import { toNumericColumn } from "../integerColumns";

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
  // Drop-policy presence (server/app/dropPolicy.ts) -- listed so this row
  // shape reflects what the column actually holds; the repo itself never
  // reads or writes it (flushes are direct jsonb_set updates from the
  // drop-policy module, and hydrate ignores lobby entirely).
  presence?: Record<string, { lastSeenAt: string; connected: boolean }>;
  // Legacy instant auto-trade gate (2026-10-02): written by POST /games
  // (explicit false on new games, optional opt-in true), read by the EndTurn
  // command case in server/app/commandHandler.ts. ABSENT (pre-flag rows read
  // here) means ON -- existing saves keep working.
  legacyAutoTrade?: boolean;
  // Pending battle offer (defender-chosen flow, 2026-10-04): stamped by the
  // EnterBattle command case, read via @heroes/engine's readPendingBattle,
  // cleared when the battle resolves / the offer goes stale. Optional --
  // every pre-offer row simply lacks the key.
  pendingBattle?: import("@heroes/engine").PendingBattleMarker | null;
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
  trade_routes: TradeRouteState[] | null;
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

// Canonical games column list. Exported for every other SELECT/RETURNING
// over the games table (routes.ts, commandHandler.ts) -- duplicate column
// lists drift, and the drift is client-visible: routes.ts's copy once
// omitted trade_routes/next_charter_id/next_settlement_id, so every GET
// returned games without them and the client hydrated tradeRoutes: [].
export const GAME_COLUMNS =
  "id, name, seed, hero_q, hero_r, turn, gold, enemy_positions, round, day, active_player_id, players, heroes, settlements, map_size, lobby, next_charter_id, next_settlement_id, trade_routes, created_at, updated_at";

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
  // Trade routes (docs/wagons-stockpiles-trade-routes-plan.md §5.2): always
  // read/written whole per game (games.trade_routes JSONB), so any command
  // that touches routes must pass the full array here or the next writer
  // clobbers it with the previous value.
  trade_routes?: TradeRouteState[];
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
  saveLobby(name: string, lobby: unknown): Promise<void>;
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
        // games.gold is NUMERIC (migration 027); the legacy total is an exact
        // sum of 2-dp purses and persists at full precision. The old INTEGER
        // column rejected unrounded floats outright (the every-EndTurn-500
        // bug) and its interim Math.round fix left a rounding shadow — see
        // ../integerColumns.ts for that history.
        sets.push(`gold = $${i++}`);
        vals.push(toNumericColumn(extra.gold));
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
      if (extra?.trade_routes !== undefined) {
        sets.push(`trade_routes = $${i++}::jsonb`);
        vals.push(JSON.stringify(extra.trade_routes));
      }
      sets.push("updated_at = now()");
      vals.push(name);
      const r = await db.query(
        `UPDATE games SET ${sets.join(", ")} WHERE name = $${i}`,
        vals,
      );
      if (r.rowCount === 0) throw new GameNotFoundError(name);
    },

    // Whole-lobby write, used inside the caller's transaction (same
    // PoolClient discipline as saveHeroesAndSettlements above). Callers own
    // read-modify-write of the bag: the EnterBattle case spreads the loaded
    // row.lobby and adds/removes pendingBattle, so other keys (aiDriver,
    // legacyAutoTrade, seat claims, presence) survive untouched.
    async saveLobby(name, lobby) {
      const r = await db.query(
        "UPDATE games SET lobby = $1::jsonb, updated_at = now() WHERE name = $2",
        [JSON.stringify(lobby), name],
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
          // gold / morale / effective_income are NUMERIC (migration 027).
          // morale and effective_income mostly arrive integral from their call
          // sites (applyMoraleDecay's rounding / effectiveIncome's own
          // Math.round); the guard is so this repo's type contract holds for
          // any caller. See ../integerColumns.ts.
          [gameId, s.settlementId, s.day, toNumericColumn(s.gold), JSON.stringify(s.warehouse), toNumericColumn(s.morale), toNumericColumn(s.effectiveIncome)],
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
          // amount / gold_paid are NUMERIC (migration 027), and runAutoTrade
          // pays out `min(stock, gold, remaining, headroom)` -- a fractional
          // food amount once food producers made fractional warehouse stock
          // reachable. See ../integerColumns.ts.
          [gameId, t.fromSettlementId, t.toSettlementId, t.resource, toNumericColumn(t.amount), toNumericColumn(t.goldPaid), t.reason ?? "auto_trade"],
        );
      }
    },
  };
}
