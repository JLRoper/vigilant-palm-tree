-- Idempotent migration: settlement garrison platoons
-- (.kilo/plans/1790560842471-unit-recruitment-garrison-plan.md task 2).
--
-- Flattens SettlementState.stacks -- the new optional garrison field, same
-- Platoon[] shape as HeroState.stacks -- exactly the way 009's
-- hero_platoons flattens hero stacks: one row per (settlement, stack,
-- unit type) rather than a second normalization level for "platoons" and a
-- third for "entries". stack_index reconstructs grouping; unit_type_id +
-- count is the leaf data. Recruits bought from city buildings land here;
-- the owning hero pulls them into hero platoons via TransferUnits, weekly
-- garrison upkeep trims them from the end, and an attacker must defeat
-- them in the arena before CaptureSettlement succeeds. Dual-write + hydrate
-- wiring lands with the server tasks; nothing reads this table yet.
CREATE TABLE IF NOT EXISTS settlement_platoons (
  settlement_id TEXT NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  stack_index   INTEGER NOT NULL,   -- position in SettlementState.stacks[]
  unit_type_id  TEXT NOT NULL REFERENCES unit_types(id),
  count         INTEGER NOT NULL,
  PRIMARY KEY (settlement_id, stack_index, unit_type_id)
);
