-- Idempotent migration: roster faction column on the unit catalog.
--
-- faction_id is the roster-faction tag (contracts FactionId: human / ashen /
-- ironmark / verdant / neutral) — the column the faction plans fill their
-- rosters into and the recruit-gating seam reads (engine
-- settlement/recruitUnits.ts). It is NOT the combat-triangle advantage_type
-- (infantry/cavalry/ranged/monster, 002_unit_types.sql), which stays exactly
-- as it is: a Pikeman is "infantry" on the triangle and "human" on the
-- roster, and a Warhound is "monster" on the triangle but a ladder-3
-- Crownlands unit on the roster.
--
-- Backfill (supersedes nothing; 020 predates the column):
--   human   — the 12 purchasable Crownlands units (002's eleven + mage from
--             015 + warhound/giant_eagle/eagle_prince from 020)
--   neutral — the four monsters (griffin, hydra, wisp, black_dragon):
--             catalog-only wild creatures, recruitable by nobody
--
-- The UPDATEs are guarded on faction_id = 'neutral' (the column DEFAULT) so
-- re-runs only fill rows that still carry the default — a later tuning pass
-- or faction-plan migration that retags a unit is never clobbered by a
-- re-run (migrations re-run at every boot, server/db.ts, sorted by filename,
-- so this file always runs BEFORE any 024+ faction plan that fills its own
-- roster).
--
-- DEFAULT 'neutral' is the fail-safe choice: an unlisted future unit is
-- recruitable by nobody until it is deliberately tagged, not recruitable by
-- everyone.

ALTER TABLE unit_types ADD COLUMN IF NOT EXISTS faction_id TEXT NOT NULL DEFAULT 'neutral';

UPDATE unit_types SET faction_id = 'human'
  WHERE id IN ('peasant','archer','crossbowman','swordsman','pikeman','cavalry',
               'monk','crusader','mage','warhound','giant_eagle','eagle_prince')
    AND faction_id = 'neutral';

UPDATE unit_types SET faction_id = 'neutral'
  WHERE id IN ('griffin','hydra','wisp','black_dragon')
    AND faction_id = 'neutral';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'unit_types_faction_id_check'
  ) THEN
    ALTER TABLE unit_types
      ADD CONSTRAINT unit_types_faction_id_check
      CHECK (faction_id IN ('human','ashen','ironmark','verdant','neutral'));
  END IF;
END $$;