-- Phase 4 (plan/2026-08-17-phase-4-db-deblobbing-dev-plan.md). game_events.id
-- is already BIGSERIAL PRIMARY KEY -- a strictly monotonic per-row sequence
-- -- so it doubles as Phase 5's event-cursor ("after=<id>") with no new
-- column needed. actor_seat is the real gap: no column today records which
-- player/seat triggered an event, only whatever happens to be in payload for
-- some kinds. Nullable because historical rows and some kinds
-- (round_started, ai_turn_started) aren't attributable to a single actor.
ALTER TABLE game_events ADD COLUMN IF NOT EXISTS actor_seat INTEGER;

CREATE INDEX IF NOT EXISTS game_events_actor_idx ON game_events(game_id, actor_seat);
