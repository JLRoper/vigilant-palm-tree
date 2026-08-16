import type { Queryable } from "./gameRepo";

// Keyed by game name (not the numeric games.id) to match
// server/app/commandHandler.ts's EventRepo interface, which only has the
// command's gameName in scope at the call site -- resolving to the FK'd id
// happens here, in the same statement, via the same approach
// server/app/liveRepos.ts's placeholder already uses.
export interface EventRepo {
  append(gameName: string, kind: string, payload: unknown): Promise<void>;
}

export function createEventRepo(db: Queryable): EventRepo {
  return {
    async append(gameName, kind, payload) {
      await db.query(
        `INSERT INTO game_events (game_id, kind, payload)
         SELECT id, $2, $3::jsonb FROM games WHERE name = $1`,
        [gameName, kind, JSON.stringify(payload)],
      );
    },
  };
}
