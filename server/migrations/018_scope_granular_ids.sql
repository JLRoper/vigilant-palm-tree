-- Mirrors the sibling worktree's 017_scope_granular_ids.sql (same DDL; number resolved for the SSE work's 017).
-- Idempotent migration: re-scope the granular tables (009 + 016) from
-- game-agnostic global keys to (game_id, id) keys. Fixes cross-game id
-- stealing on any database holding more than one game.
--
-- Why: entity ids (p0-hero, h0..h4, s0, s1, ...) are only unique PER GAME --
-- every game seeds the same "h0"/"s0" -- but heroes/settlements/charters
-- keyed PRIMARY KEY (id) and the child tables keyed on the bare entity id.
-- The repos' upserts all ran ON CONFLICT (id) DO UPDATE SET game_id =
-- EXCLUDED.game_id, ..., so on a shared database any game's save silently
-- STOLE another game's rows: it flipped game_id, overwrote the row's values,
-- and deleted its platoons. The victim game's next EndTurn hydrated from the
-- now-depleted granular tables (hydrate.ts only falls back to the games-row
-- JSONB when a table is entirely empty) and its heroes vanished from the
-- map. Child reads (hero_platoons by hero_id, settlement_* by
-- settlement_id) were equally ambiguous once ids repeated across games.
--
-- Existing rows are NOT migrated because they cannot be repaired: a stolen
-- row's original owner has already lost it, and which game a row originally
-- belonged to is unrecoverable. All granular rows are deleted; heroes and
-- settlements reseed from each game's games.heroes/games.settlements JSONB
-- on the next command (hydrate.ts falls back to the JSONB whenever a
-- granular table is empty, and every command's dual-write re-populates the
-- granular tables from the command's full state). In-flight charters are
-- dropped and not reseedable: activeCharters has no JSONB source anywhere
-- (the charters table is their only persistence), so games simply lose any
-- traveling/constructing charters -- acceptable for the dev DB.
--
-- initSchema() re-runs every migrations/*.sql on EVERY api boot (no tracking
-- table), so the whole body is guarded: it executes only while the heroes
-- PK is still the old bare-(id) shape, making the one-time wipe truly
-- one-time -- without the guard, every server restart would re-delete the
-- granular tables and permanently destroy in-flight charters (no JSONB
-- fallback for those).
--
-- The DELETE runs before the DDL (not after): these tables may hold the
-- very rows this migration removes, and ADD COLUMN ... NOT NULL on a
-- non-empty table would fail.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name
     AND kcu.table_schema = tc.table_schema
    WHERE tc.table_schema = current_schema()
      AND tc.table_name = 'heroes'
      AND tc.constraint_type = 'PRIMARY KEY'
      AND kcu.column_name = 'game_id'
  ) THEN
    RETURN;
  END IF;

ALTER TABLE hero_platoons DROP CONSTRAINT IF EXISTS hero_platoons_hero_id_fkey;
ALTER TABLE charters DROP CONSTRAINT IF EXISTS charters_hero_id_fkey;
ALTER TABLE settlement_resources DROP CONSTRAINT IF EXISTS settlement_resources_settlement_id_fkey;
ALTER TABLE settlement_buildings DROP CONSTRAINT IF EXISTS settlement_buildings_settlement_id_fkey;
ALTER TABLE settlement_platoons DROP CONSTRAINT IF EXISTS settlement_platoons_settlement_id_fkey;
ALTER TABLE settlement_buildings DROP CONSTRAINT IF EXISTS settlement_buildings_settlement_id_gx_gy_key;

DELETE FROM hero_platoons;
DELETE FROM settlement_resources;
DELETE FROM settlement_buildings;
DELETE FROM settlement_platoons;
DELETE FROM charters;
DELETE FROM heroes;
DELETE FROM settlements;

ALTER TABLE heroes DROP CONSTRAINT IF EXISTS heroes_pkey;
ALTER TABLE heroes ADD PRIMARY KEY (game_id, id);

ALTER TABLE settlements DROP CONSTRAINT IF EXISTS settlements_pkey;
ALTER TABLE settlements ADD PRIMARY KEY (game_id, id);

ALTER TABLE charters DROP CONSTRAINT IF EXISTS charters_pkey;
ALTER TABLE charters ADD PRIMARY KEY (game_id, id);

ALTER TABLE hero_platoons ADD COLUMN IF NOT EXISTS game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE;
ALTER TABLE settlement_resources ADD COLUMN IF NOT EXISTS game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE;
ALTER TABLE settlement_buildings ADD COLUMN IF NOT EXISTS game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE;
ALTER TABLE settlement_platoons ADD COLUMN IF NOT EXISTS game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE;

ALTER TABLE hero_platoons DROP CONSTRAINT IF EXISTS hero_platoons_pkey;
ALTER TABLE hero_platoons ADD PRIMARY KEY (game_id, hero_id, stack_index, unit_type_id);
ALTER TABLE hero_platoons DROP CONSTRAINT IF EXISTS hero_platoons_game_id_hero_id_fkey;
ALTER TABLE hero_platoons ADD CONSTRAINT hero_platoons_game_id_hero_id_fkey
  FOREIGN KEY (game_id, hero_id) REFERENCES heroes (game_id, id) ON DELETE CASCADE;

ALTER TABLE settlement_resources DROP CONSTRAINT IF EXISTS settlement_resources_pkey;
ALTER TABLE settlement_resources ADD PRIMARY KEY (game_id, settlement_id, resource);
ALTER TABLE settlement_resources DROP CONSTRAINT IF EXISTS settlement_resources_game_id_settlement_id_fkey;
ALTER TABLE settlement_resources ADD CONSTRAINT settlement_resources_game_id_settlement_id_fkey
  FOREIGN KEY (game_id, settlement_id) REFERENCES settlements (game_id, id) ON DELETE CASCADE;

ALTER TABLE settlement_buildings DROP CONSTRAINT IF EXISTS settlement_buildings_game_id_settlement_id_gx_gy_key;
ALTER TABLE settlement_buildings ADD CONSTRAINT settlement_buildings_game_id_settlement_id_gx_gy_key
  UNIQUE (game_id, settlement_id, gx, gy);
ALTER TABLE settlement_buildings DROP CONSTRAINT IF EXISTS settlement_buildings_game_id_settlement_id_fkey;
ALTER TABLE settlement_buildings ADD CONSTRAINT settlement_buildings_game_id_settlement_id_fkey
  FOREIGN KEY (game_id, settlement_id) REFERENCES settlements (game_id, id) ON DELETE CASCADE;

ALTER TABLE settlement_platoons DROP CONSTRAINT IF EXISTS settlement_platoons_pkey;
ALTER TABLE settlement_platoons ADD PRIMARY KEY (game_id, settlement_id, stack_index, unit_type_id);
ALTER TABLE settlement_platoons DROP CONSTRAINT IF EXISTS settlement_platoons_game_id_settlement_id_fkey;
ALTER TABLE settlement_platoons ADD CONSTRAINT settlement_platoons_game_id_settlement_id_fkey
  FOREIGN KEY (game_id, settlement_id) REFERENCES settlements (game_id, id) ON DELETE CASCADE;

ALTER TABLE charters DROP CONSTRAINT IF EXISTS charters_game_id_hero_id_fkey;
ALTER TABLE charters ADD CONSTRAINT charters_game_id_hero_id_fkey
  FOREIGN KEY (game_id, hero_id) REFERENCES heroes (game_id, id) ON DELETE CASCADE;
END
$$;
