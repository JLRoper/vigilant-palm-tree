-- Workforce staffing columns (workforce-kwork plan, wave 1c).
--
-- BuildingDef.workers?: number -- one building's explicit workforce size
-- (0 = shut down); BuildingDef.draft?: Partial<Record<unitTypeId, number>>
-- -- per-unitTypeId recruit pool remaining on the same building. Two
-- columns on the existing granular buildings row, following the exact rule
-- of 013_settlement_building_construction.sql (`construction`) and
-- 022_bank_pot.sql (`bank`): a single optional state value, not a
-- collection.
--
-- workers NULL = legacy auto-staffed (BuildingDef.workers absent means
-- fully staffed, effort 1). draft NULL = full pool (BuildingDef.draft
-- absent). An explicit number is written from the first assignment/recruit
-- onward; every pre-existing row stays NULL and round-trips without the
-- key. An explicit `undefined` key would also be wrong here -- see the
-- conditional-spread note in server/persistence/repositories/settlementRepo.ts.
--
-- ADD COLUMN IF NOT EXISTS makes this re-runnable at every boot, same as
-- 021/022.

ALTER TABLE settlement_buildings
  ADD COLUMN IF NOT EXISTS workers INTEGER,
  ADD COLUMN IF NOT EXISTS draft JSONB;