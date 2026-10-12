CREATE TABLE IF NOT EXISTS users (
  id              SERIAL PRIMARY KEY,
  account_name    TEXT NOT NULL,
  email           TEXT NOT NULL,
  email_verified_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_account_name_idx
  ON users (lower(trim(account_name)));

CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx
  ON users (lower(email));

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
