-- Idempotent migration: per-building bank pot state.
--
-- BuildingDef.bank?: BankPot -- { gold: number, pendingOut: { gold, maturesOnDay }[] }
-- is the per-BUILDING pot a bank holds, distinct from the settlement-wide
-- treasury. One nullable JSONB column on the existing granular buildings row,
-- following the exact rule of 013_settlement_building_construction.sql
-- (`construction`) and settlements.upgrade (009): a single optional
-- in-flight value, not a collection.
--
-- NULL = this building has no pot. No backfill: a building only ever gains the
-- key when a pot is opened for it, so every pre-existing row (and every
-- non-bank kind, permanently) stays NULL and round-trips without the key.
-- An explicit `undefined` key would also be wrong here -- see the conditional
-- -spread note in server/persistence/repositories/settlementRepo.ts.
--
-- ADD COLUMN IF NOT EXISTS makes this re-runnable at every boot, same as 021.

ALTER TABLE settlement_buildings
  ADD COLUMN IF NOT EXISTS bank JSONB;
