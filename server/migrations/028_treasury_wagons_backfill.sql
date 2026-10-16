-- Idempotent migration: materialize the hero treasury-cart default (L6 fix,
-- .plans/20261003-2359_logistics-interface-fixes_29904.md §5.6 DB half).
--
-- 023_treasury_wagons.sql deliberately shipped treasury_wagons NULLable with
-- NO backfill: NULL meant "field absent from HeroState, engine soft-defaults
-- to 5" (heroTreasuryWagons / DEFAULT_TREASURY_WAGONS). That distinction
-- broke at the AssignWagons seam: logistics.ts's assignWagons seeded the
-- slot from `hero.treasuryWagons ?? 0`, so a pre-023 hero's first
-- AssignWagons materialized the field from 0 — +1 shrank the hero's purse
-- cap 2,500g -> 500g, and -1 was rejected not_enough_wagons despite the
-- soft default (test/logistics-bugs/logistics.wagonPools.test.ts L6a/L6b).
--
-- This backfill makes the soft default EXPLICIT, mirroring 014's
-- `wagons INTEGER NOT NULL DEFAULT 5` shape: every NULL hero now owns its 5
-- carts on the row itself, so no reader can ever derive a sub-default cart
-- count from an absent field. The engine-side soft default
-- (capacity.ts heroTreasuryWagons) and assignWagons seeding from
-- DEFAULT_TREASURY_WAGONS stay as the belt for rows that have not seen this
-- migration yet.
--
-- An explicit 0 remains REAL (a hero recruited from an empty pool, or
-- stripped of its carts, with a 0g purse cap) and is untouched: only NULL
-- rows are rewritten.
--
-- Re-run-safe: the WHERE treasury_wagons IS NULL guard makes every run
-- after the first a zero-row no-op (migrations re-run at every boot,
-- server/db.ts, sorted by filename — same as 021/022).

UPDATE heroes
SET treasury_wagons = 5
WHERE treasury_wagons IS NULL;
