import type { TileRow } from "@heroes/engine";
import { resolveGameId } from "./gameRepo";
import type { Queryable } from "./gameRepo";

// Phase 4 (plan/2026-08-17-phase-4-db-deblobbing-dev-plan.md). Unlike
// heroRepo/settlementRepo/charterRepo, tiles is already granular (see
// server/schema.sql) -- this repo has no matching migration, it's purely
// the read wrapper server/persistence/hydrate.ts (Track A) needs. Read-only:
// tiles are generated once at game creation (server/routes.ts's POST /games)
// and never mutated by a command, so there's no upsert/delete surface here,
// unlike the other three Phase 4 repos.
export interface TileRepo {
  loadAllForGame(gameName: string): Promise<TileRow[]>;
}

export function createTileRepo(db: Queryable): TileRepo {
  return {
    async loadAllForGame(gameName) {
      const gameId = await resolveGameId(db, gameName);
      const r = await db.query<TileRow>(
        `SELECT q, r, terrain, resource FROM tiles WHERE game_id = $1 ORDER BY r ASC, q ASC`,
        [gameId],
      );
      return r.rows;
    },
  };
}
