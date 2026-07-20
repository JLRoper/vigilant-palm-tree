CREATE TABLE IF NOT EXISTS games (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  seed INTEGER NOT NULL,
  hero_q INTEGER NOT NULL,
  hero_r INTEGER NOT NULL,
  turn INTEGER NOT NULL DEFAULT 1,
  gold INTEGER NOT NULL DEFAULT 0,
  enemy_positions JSONB NOT NULL DEFAULT '[]'::jsonb,
  round INT NOT NULL DEFAULT 1,
  day INT NOT NULL DEFAULT 1,
  active_player_id INT NOT NULL DEFAULT 0,
  players JSONB NOT NULL DEFAULT '[]'::jsonb,
  heroes JSONB NOT NULL DEFAULT '{}'::jsonb,
  settlements JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS game_events (
  id BIGSERIAL PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS game_events_game_id_idx ON game_events(game_id);

CREATE TABLE IF NOT EXISTS tiles (
  id          SERIAL PRIMARY KEY,
  game_id     INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  q           INTEGER NOT NULL,
  r           INTEGER NOT NULL,
  terrain     TEXT NOT NULL,
  resource    TEXT,
  UNIQUE (game_id, q, r)
);

CREATE INDEX IF NOT EXISTS tiles_game_idx ON tiles (game_id);
