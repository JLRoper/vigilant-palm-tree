import type { Queryable } from "./gameRepo";

// Keyed by game name (not the numeric games.id) to match
// server/app/commandHandler.ts's EventRepo interface, which only has the
// command's gameName in scope at the call site -- resolving to the FK'd id
// happens here, in the same statement, via the same approach
// server/app/liveRepos.ts's placeholder already uses.
export interface EventRepo {
  // actorSeat is null for events not attributable to a single seat (see
  // server/migrations/010_event_seq.sql's header) -- round_started/
  // ai_turn_started today.
  append(gameName: string, kind: string, payload: unknown, actorSeat: number | null): Promise<void>;
}

export function createEventRepo(db: Queryable): EventRepo {
  return {
    async append(gameName, kind, payload, actorSeat) {
      await db.query(
        `INSERT INTO game_events (game_id, kind, payload, actor_seat)
         SELECT id, $2, $3::jsonb, $4 FROM games WHERE name = $1`,
        [gameName, kind, JSON.stringify(payload), actorSeat],
      );
    },
  };
}
