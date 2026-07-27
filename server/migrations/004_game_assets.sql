CREATE TABLE IF NOT EXISTS game_assets (
  key       TEXT PRIMARY KEY,
  mime_type TEXT NOT NULL DEFAULT 'image/png',
  data      BYTEA NOT NULL,
  byte_size INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS game_assets_mime_idx ON game_assets (mime_type);
