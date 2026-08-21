import type { Queryable } from "./gameRepo";

// Keyed by game name (not the numeric games.id) to match
// server/app/commandHandler.ts's EventRepo interface, which only has the
// command's gameName in scope at the call site -- resolving to the FK'd id
// happens here, in the same statement, via the same approach
// server/app/commandHandler.ts's createLiveCommandDeps already uses.
export interface EventRepo {
  // actorSeat is null for events not attributable to a single seat (see
  // server/migrations/010_event_seq.sql's header) -- round_started/
  // ai_turn_started today. Returns the inserted row's id (game_events.id,
  // BIGSERIAL) so callers can report the cursor position of the event they
  // just caused.
  append(gameName: string, kind: string, payload: unknown, actorSeat: number | null): Promise<number>;
}

export function createEventRepo(db: Queryable): EventRepo {
  return {
    async append(gameName, kind, payload, actorSeat) {
      // id comes back as a string -- node-postgres parses int8/BIGSERIAL as
      // string by default to avoid silent precision loss above 2^53. No
      // game will ever produce anywhere near Number.MAX_SAFE_INTEGER
      // events, so converting here is safe and keeps the interface a plain
      // number for callers instead of leaking the driver's string quirk.
      const result = await db.query<{ id: string }>(
        `INSERT INTO game_events (game_id, kind, payload, actor_seat)
         SELECT id, $2, $3::jsonb, $4 FROM games WHERE name = $1
         RETURNING id`,
        [gameName, kind, JSON.stringify(payload), actorSeat],
      );
      // The SELECT ... FROM games WHERE name = $1 subquery inserts zero
      // rows (rather than erroring) when gameName doesn't match -- existing
      // no-op-on-missing-game behavior (see eventRepo.test.ts). 0 is not a
      // real game_events.id (BIGSERIAL starts at 1), so it's a safe sentinel
      // for "nothing was inserted" without widening the return type to
      // `number | null` for a path callers never hit in practice (they only
      // call append() after gameRepo.load() already confirmed the game exists).
      return result.rows[0] ? Number(result.rows[0].id) : 0;
    },
  };
}
