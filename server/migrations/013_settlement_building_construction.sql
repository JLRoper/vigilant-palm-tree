-- BuildingDef.construction?: { daysRemaining: number } -- one nullable JSONB
-- column on the existing granular buildings row, same rule as
-- settlements.upgrade (009): a single optional in-flight value, not a
-- collection. NULL = construction complete (all pre-existing rows).
ALTER TABLE settlement_buildings
  ADD COLUMN IF NOT EXISTS construction JSONB;
