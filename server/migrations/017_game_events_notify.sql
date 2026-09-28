-- Idempotent migration: Postgres NOTIFY push for game_events
-- (.kilo/plan/2026-09-28-sse-event-push.md, "Design → Server: notify path").
--
-- Adds an AFTER INSERT trigger on game_events that pg_notifies the channel
-- 'game_events_changed' with the row's game_id as payload. The API process
-- holds one dedicated LISTEN connection on that channel
-- (server/persistence/eventsNotifier.ts); GET /games/:name/events/stream
-- (server/http/routes/eventStream.ts) uses the wakeup to tail new rows out
-- to connected browsers as server-sent events instead of waiting for the
-- 2 s poll. The table stays the system of record: a notification carries
-- only the game_id, and the stream handler re-SELECTs rows with the same
-- query the poll route uses -- the notification is a wakeup, never data.
--
-- Race-free by construction: NOTIFY is queued at INSERT but delivered to
-- listeners only when the inserting transaction COMMITS, and delivery
-- happens after commit, so by the time a stream handler wakes and SELECTs,
-- every row that caused the wakeup is already visible to its snapshot.
-- No notification-vs-payload race, and no lost wakeups between commit and
-- notify (the queue is transactional too). Row volume is tiny (per-command
-- pace), so one notify per inserted row is fine.
--
-- Idempotent: CREATE OR REPLACE FUNCTION plus DROP TRIGGER IF EXISTS before
-- CREATE TRIGGER, so re-running at every boot (server/db.ts initSchema()
-- reads server/migrations/*.sql sorted and pool.query()s each) is a no-op.
CREATE OR REPLACE FUNCTION game_events_notify() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('game_events_changed', NEW.game_id::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS game_events_notify_trigger ON game_events;
CREATE TRIGGER game_events_notify_trigger
  AFTER INSERT ON game_events
  FOR EACH ROW EXECUTE FUNCTION game_events_notify();
