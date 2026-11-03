-- E8: the granular per-building ledger cannot hold a district building.
--
-- settlement_buildings was keyed (game_id, settlement_id, gx, gy) and described
-- only the main city's own grid. A district's buildings sit on the district's
-- OWN grid (a 5x5 satellite grid on an adjacent hex, packages/engine/src/
-- settlement/districtSeed.ts), so a district building at (0,0) is the same
-- (gx, gy) pair as the main city's (0,0) and the unique key rejects it:
--
--   INSERT ... (gx 0, gy 0, 'farmHouse') -> duplicate key value violates unique
--   constraint "settlement_buildings_game_id_settlement_id_gx_gy_key"
--
-- District buildings therefore only ever existed inside settlements.districts
-- (JSONB, migration 029), and a reader of settlement_buildings saw a settlement
-- missing every district building: 11 rows for a town whose state holds 14
-- buildings, and a production sum short by exactly the district's own output
-- (3.12 stone + 3.75 food on Stone mark, castle-2-20-13).
--
-- This gives the ledger a district discriminator: district_q / district_r are
-- NULL for a main-city building and the district's own hex coordinates for a
-- district one. That pair is exactly what districtKey() (engine control.ts)
-- already keys a settlement's districts by, so a row is addressable by the same
-- key the engine addresses the district with.
--
-- Then the reader can assemble a settlement's districts from these rows plus
-- the `districts` column's per-district metadata (q, r, citySpots), which is
-- what server/persistence/repositories/settlementRepo.ts now does.

ALTER TABLE settlement_buildings ADD COLUMN IF NOT EXISTS district_q INTEGER;
ALTER TABLE settlement_buildings ADD COLUMN IF NOT EXISTS district_r INTEGER;

-- Re-scope the unique key. Dropping the constraint drops its backing index.
-- COALESCE(district_q, -1) rather than UNIQUE NULLS NOT DISTINCT: -1 is outside
-- both coordinate spaces (a district hex is q/r >= 0, a grid cell is 0..4), and
-- the expression form is valid on every Postgres this project runs against
-- rather than only 15+.
ALTER TABLE settlement_buildings DROP CONSTRAINT IF EXISTS settlement_buildings_game_id_settlement_id_gx_gy_key;
ALTER TABLE settlement_buildings DROP CONSTRAINT IF EXISTS settlement_buildings_settlement_id_gx_gy_key;
DROP INDEX IF EXISTS settlement_buildings_game_id_settlement_id_gx_gy_key;
CREATE UNIQUE INDEX IF NOT EXISTS settlement_buildings_scope_key
  ON settlement_buildings (game_id, settlement_id, COALESCE(district_q, -1), COALESCE(district_r, -1), gx, gy);

-- Backfill every existing game's district buildings out of its
-- settlements.districts JSONB, so a game created before this migration reads
-- its districts back unchanged. Without this the new read path would find no
-- district rows for an existing game and fall back to the JSONB (see
-- settlementRepo's per-district fallback) -- and an SQL consumer would keep
-- seeing the gap this migration exists to close.
--
-- initSchema() re-runs every migration file at every boot with no error
-- handling, so this statement must never raise. The CASE guards (not just
-- WHERE predicates) are what actually keep jsonb_each/jsonb_array_elements off
-- a non-object/non-array -- a set-returning function is evaluated by the scan,
-- before any WHERE can filter its row out, and jsonb_each('[]') raises rather
-- than returning nothing. The jsonb_typeof predicates then skip anything whose
-- coordinates or NOT NULL columns are unusable, instead of throwing a cast
-- error (22P02) or a NOT NULL violation that would block every subsequent boot.
-- numeric -> int rather than text -> int because a JSONB number round-trips as
-- "1.0" and '1.0'::int errors where 1.0::int does not. ON CONFLICT DO NOTHING
-- makes a second run a no-op (a row already present is left as the app wrote it).
INSERT INTO settlement_buildings
  (game_id, settlement_id, district_q, district_r, gx, gy, kind, level, style,
   w, h, construction, bank, workers, draft)
SELECT
  s.game_id,
  s.id,
  (d.value->>'q')::numeric::int,
  (d.value->>'r')::numeric::int,
  (b.value->>'gx')::numeric::int,
  (b.value->>'gy')::numeric::int,
  b.value->>'kind',
  (b.value->>'level')::numeric::int,
  COALESCE(b.value->>'style', 'pixel'),
  CASE WHEN jsonb_typeof(b.value->'w') = 'number' THEN (b.value->>'w')::numeric::int END,
  CASE WHEN jsonb_typeof(b.value->'h') = 'number' THEN (b.value->>'h')::numeric::int END,
  CASE WHEN jsonb_typeof(b.value->'construction') = 'object' THEN b.value->'construction' END,
  CASE WHEN jsonb_typeof(b.value->'bank') = 'object' THEN b.value->'bank' END,
  CASE WHEN jsonb_typeof(b.value->'workers') = 'number' THEN (b.value->>'workers')::numeric::int END,
  CASE WHEN jsonb_typeof(b.value->'draft') = 'object' THEN b.value->'draft' END
FROM settlements s
CROSS JOIN LATERAL jsonb_each(
  CASE WHEN jsonb_typeof(s.districts) = 'object' THEN s.districts ELSE NULL END
) AS d
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(d.value->'buildings') = 'array' THEN d.value->'buildings' ELSE NULL END
) AS b
WHERE jsonb_typeof(s.districts) = 'object'
  AND jsonb_typeof(d.value) = 'object'
  AND jsonb_typeof(d.value->'q') = 'number'
  AND jsonb_typeof(d.value->'r') = 'number'
  AND jsonb_typeof(b.value) = 'object'
  AND jsonb_typeof(b.value->'kind') = 'string'
  AND jsonb_typeof(b.value->'level') = 'number'
  AND jsonb_typeof(b.value->'gx') = 'number'
  AND jsonb_typeof(b.value->'gy') = 'number'
ON CONFLICT DO NOTHING;
