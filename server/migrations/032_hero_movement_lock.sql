-- Idempotent migration: the retreat stun
-- (plan/2026-10-21-battle-retreat-rules.md).
--
-- HeroState.movementLockedThroughDay: a hero that retreats from a battle on
-- day D gets no movement through day D + 1. NULL = the field is absent from
-- HeroState (no stun) and must round-trip as absence -- heroRepo writes
-- `hero.movementLockedThroughDay ?? null` and reads NULL back as an absent
-- key, the same shape 023's nullable treasury_wagons uses.
--
-- ADD COLUMN IF NOT EXISTS makes this re-runnable at every boot.

ALTER TABLE heroes
  ADD COLUMN IF NOT EXISTS movement_locked_through_day INTEGER;
