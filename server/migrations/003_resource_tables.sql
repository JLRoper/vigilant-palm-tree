CREATE TABLE IF NOT EXISTS resource_transactions (
  id BIGSERIAL PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  from_settlement_id TEXT,
  to_settlement_id TEXT NOT NULL,
  resource TEXT NOT NULL,
  amount INTEGER NOT NULL,
  gold_paid INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT 'auto_trade'
);

CREATE INDEX IF NOT EXISTS idx_resource_tx_game ON resource_transactions(game_id);

CREATE TABLE IF NOT EXISTS settlement_snapshots (
  id BIGSERIAL PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  settlement_id TEXT NOT NULL,
  day INTEGER NOT NULL,
  gold INTEGER NOT NULL,
  warehouse JSONB NOT NULL,
  morale INTEGER NOT NULL,
  effective_income INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (game_id, settlement_id, day)
);

CREATE INDEX IF NOT EXISTS idx_settlement_snapshots_game ON settlement_snapshots(game_id);
