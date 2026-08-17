-- Phase 4 (plan/2026-08-17-phase-4-db-deblobbing-dev-plan.md): granular
-- tables mirroring games.heroes/settlements' current JSONB shape, so the
-- server can eventually read/write per-entity rows instead of a whole-blob
-- replace on every command. Additive only -- games.heroes/settlements stay
-- the write-through source of truth until Phase 4's read-path cutover; nothing
-- reads these tables yet.

CREATE TABLE IF NOT EXISTS heroes (
  id                          TEXT PRIMARY KEY,          -- HeroId, matches games.heroes JSONB key today
  game_id                     INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  name                        TEXT NOT NULL,
  owner_id                    INTEGER NOT NULL,
  q                           INTEGER NOT NULL,
  r                           INTEGER NOT NULL,
  movement_remaining          INTEGER NOT NULL,
  previous_q                  INTEGER,
  previous_r                  INTEGER,
  previous_movement_remaining INTEGER,
  trail                       JSONB NOT NULL DEFAULT '[]'::jsonb,  -- {q,r}[] breadcrumb; too small/positional to normalize
  gold                        INTEGER NOT NULL DEFAULT 0,
  troops                      INTEGER NOT NULL DEFAULT 0,
  is_chartering               BOOLEAN NOT NULL DEFAULT false,
  -- Not FK'd to charters(id) on purpose: charters.hero_id already references
  -- heroes(id), and heroes<->charters upsert order isn't fixed (whichever of
  -- the two a dual-write touches first) -- a two-way FK would make every
  -- write order-dependent for no real integrity gain, since this is a soft
  -- "which charter is this hero currently on" pointer, not a relationship
  -- enforced anywhere else in the codebase today either.
  charter_id                  TEXT,
  horse_variant               TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS heroes_game_idx ON heroes(game_id);

-- Flattens HeroState.stacks: Platoon[] (Platoon = { entries: PlatoonEntry[] }).
-- One row per (hero, stack, unit type) rather than a second normalization
-- level for "platoons" and a third for "entries" -- stack_index reconstructs
-- grouping, unit_type_id + count is the leaf data, and this shape makes
-- "how many archers does player X have total" a plain GROUP BY instead of a
-- JSONB traversal, which is the whole motivation for this phase.
CREATE TABLE IF NOT EXISTS hero_platoons (
  hero_id      TEXT NOT NULL REFERENCES heroes(id) ON DELETE CASCADE,
  stack_index  INTEGER NOT NULL,   -- position in HeroState.stacks[]
  unit_type_id TEXT NOT NULL REFERENCES unit_types(id),
  count        INTEGER NOT NULL,
  PRIMARY KEY (hero_id, stack_index, unit_type_id)
);

CREATE TABLE IF NOT EXISTS settlements (
  id                  TEXT PRIMARY KEY,          -- SettlementId
  game_id             INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  owner_id            INTEGER,
  q                   INTEGER NOT NULL,
  r                   INTEGER NOT NULL,
  level               SMALLINT NOT NULL CHECK (level IN (1, 2, 3)),
  population          INTEGER NOT NULL,
  gold_tax            INTEGER NOT NULL,
  founded_on_resource TEXT,
  gold                INTEGER NOT NULL DEFAULT 0,
  -- resourceRates (SettlementState) is Partial<Record<ResourceType, number>>
  -- and ResourceType includes "gold" (gold resource tiles exist on the map,
  -- see packages/engine/src/map/resourceTiles.ts's RESOURCE_YIELD.gold) --
  -- but Warehouse only ever tracks the other five. gold_rate lives here,
  -- next to the existing gold column, instead of forcing settlement_resources
  -- (which mirrors warehouse, not resourceRates alone) to accept a sixth
  -- resource value that would never have a matching warehouse amount.
  gold_rate           NUMERIC,
  morale              INTEGER NOT NULL DEFAULT 100,
  auto_trade          BOOLEAN NOT NULL DEFAULT true,
  castle_variant      SMALLINT NOT NULL DEFAULT 0,
  city_spots          JSONB NOT NULL DEFAULT '[]'::jsonb,   -- generation-time anchor data, not gameplay state -- kept JSONB
  city_mines          JSONB NOT NULL DEFAULT '[]'::jsonb,   -- same
  -- UpgradeState is a single optional in-flight upgrade, not a collection --
  -- one nullable JSONB column, not a separate table. Re-evaluate only if a
  -- concrete query need over "settlements currently upgrading" shows up.
  upgrade             JSONB
);

CREATE INDEX IF NOT EXISTS settlements_game_idx ON settlements(game_id);

-- Replaces SettlementState.warehouse (always-present amount for these five
-- resources) and the non-gold slice of .resourceRates (a *partial* record --
-- only resources the settlement actually produces; see settlements.gold_rate
-- above for the sixth, gold). rate is nullable to preserve "doesn't produce
-- this" vs "produces it at rate 0", which the current Partial<Record<...>>
-- type distinguishes and a NOT NULL default-0 rate column would collapse.
CREATE TABLE IF NOT EXISTS settlement_resources (
  settlement_id TEXT NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  resource      TEXT NOT NULL CHECK (resource IN ('wood', 'stone', 'iron', 'arcane', 'food')),
  amount        INTEGER NOT NULL DEFAULT 0,
  rate          NUMERIC,
  PRIMARY KEY (settlement_id, resource)
);

CREATE TABLE IF NOT EXISTS settlement_buildings (
  id            BIGSERIAL PRIMARY KEY,
  settlement_id TEXT NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  gx            INTEGER NOT NULL,
  gy            INTEGER NOT NULL,
  kind          TEXT NOT NULL,
  level         INTEGER NOT NULL,
  style         TEXT NOT NULL,
  w             INTEGER,
  h             INTEGER,
  UNIQUE (settlement_id, gx, gy)
);

CREATE TABLE IF NOT EXISTS charters (
  id                  TEXT PRIMARY KEY,        -- CharterId
  game_id             INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  hero_id             TEXT NOT NULL REFERENCES heroes(id) ON DELETE CASCADE,
  owner_id            INTEGER NOT NULL,
  target_q            INTEGER NOT NULL,
  target_r            INTEGER NOT NULL,
  settlement_name     TEXT NOT NULL,
  phase               TEXT NOT NULL CHECK (phase IN ('traveling', 'constructing')),
  days_remaining      INTEGER NOT NULL,
  settlement_id       TEXT NOT NULL,           -- the not-yet-founded settlement's future id
  resource_rates      JSONB NOT NULL DEFAULT '{}'::jsonb,  -- small partial record, generation config -- JSONB is fine
  founded_on_resource TEXT,
  city_spots          JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS charters_game_idx ON charters(game_id);

-- Closes two unpersisted-counter gaps found in packages/engine/src/
-- hydrate.ts:160-161 (activeCharters' companion counters, not activeCharters
-- itself -- that's the charters table above). Both currently silently reset
-- to a derived default on every load; real columns close this before
-- StartCharter (which allocates from next_charter_id) is ported.
ALTER TABLE games ADD COLUMN IF NOT EXISTS next_charter_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE games ADD COLUMN IF NOT EXISTS next_settlement_id INTEGER NOT NULL DEFAULT 0;
