-- Idempotent migration: add the user profile tables for the pre-alpha0
-- profile scheme (see .plans/20261012-0145_user-profile-scheme_31124.md).
--
-- Re-run-safe: every statement is guarded with IF NOT EXISTS / IF NOT
-- EXISTS. The case-folding unique indexes are the backstop that keeps
-- "Alice" / "alice" / " Alice " from becoming separate rows, so the app
-- normalises (lower + trim) before inserting and the indexes double-check.

CREATE TABLE IF NOT EXISTS users (
  id              SERIAL PRIMARY KEY,
  account_name    TEXT NOT NULL,
  email           TEXT NOT NULL,
  email_verified_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Normalise at the boundary AND index the normalised form: callers (server
-- API + client) must lower-case and trim before inserting; the index is the
-- backstop so "Alice", "alice" and " Alice " cannot both stand.
CREATE UNIQUE INDEX IF NOT EXISTS users_account_name_idx
  ON users (lower(trim(account_name)));

-- Email stores the canonical lower-case form; this unique index keeps
-- case-folding persistent at the DB level.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx
  ON users (lower(email));

-- Pre-alpha0 username character-set guard: keeps the unique index above
-- meaningful (no ambiguity from newlines / unusual whitespace).
-- initSchema() re-runs every migration on each boot and PostgreSQL has no
-- ADD CONSTRAINT IF NOT EXISTS, so the existence check lives in a DO block.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_account_name_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_account_name_check
      CHECK (account_name ~ '^[A-Za-z0-9_ .-]{1,64}$');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS user_stats (
  user_id         INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  games_started   INTEGER NOT NULL DEFAULT 0,
  last_played_at  TIMESTAMPTZ
);
-- `games_completed` / `games_won` are deliberately reserved — no win
-- condition exists yet — and `detail` JSONB is deliberately absent (dead
-- counters + unstructured growth both cause code bloat). Slot them in as a
-- real typed table when a concrete stat scope exists (plan §Key decisions).
