import { pool, withTransaction } from "../db";
import type { HeroId, HeroState, Player, SettlementId, SettlementState } from "@heroes/contracts";
import type { HydratableGameRow } from "@heroes/engine";
import type { EventRepo, GameRepo } from "./commandHandler";

// Week-1 placeholder for Track 3.B's real repos
// (server/persistence/repositories/, per
// plan/2026-08-16-phase-3-parallel-dev-plan.md's file ownership table).
// Deliberately lives in server/app/ (Track 3.A's own tree, not
// server/persistence/) so it never preempts Track 3.B's file ownership --
// it exists only so POST /api/games/:name/commands is exercisable against
// the real dev DB before Track 3.B lands, per the plan's Week 2 note ("Dev
// A: wires real repos in"). Delete this file once Track 3.B's real
// gameRepo.ts/eventRepo.ts exist and repoint commands.ts at those instead.

const ROW_COLUMNS = "name, seed, round, day, active_player_id, players, heroes, settlements";

interface RawGameRow {
  name: string;
  seed: number;
  round: number;
  day: number;
  active_player_id: number;
  players: Player[];
  heroes: Record<HeroId, HeroState>;
  settlements: Record<SettlementId, SettlementState>;
}

export const liveGameRepo: GameRepo = {
  async load(name: string): Promise<HydratableGameRow> {
    const r = await pool.query<RawGameRow>(
      `SELECT ${ROW_COLUMNS} FROM games WHERE name = $1`,
      [name],
    );
    if (r.rowCount === 0) throw new Error(`game not found: ${name}`);
    return r.rows[0];
  },
  async saveHeroesAndSettlements(
    name: string,
    heroes: Record<HeroId, HeroState>,
    settlements: Record<SettlementId, SettlementState>,
  ): Promise<void> {
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE games SET heroes = $1::jsonb, settlements = $2::jsonb, updated_at = now() WHERE name = $3`,
        [JSON.stringify(heroes), JSON.stringify(settlements), name],
      );
    });
  },
};

export const liveEventRepo: EventRepo = {
  async append(gameName: string, kind: string, payload: unknown): Promise<void> {
    await pool.query(
      `INSERT INTO game_events (game_id, kind, payload)
       SELECT id, $2, $3::jsonb FROM games WHERE name = $1`,
      [gameName, kind, JSON.stringify(payload)],
    );
  },
};
