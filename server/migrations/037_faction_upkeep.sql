-- Idempotent migration: per-faction troop upkeep in the unit catalog.
--
-- ── What this file is ──
-- Upkeep is a real per-unit cost already: 015 added unit_types.upkeep_gold /
-- upkeep_food, 021 tuned them from `tier`, and the weekly charge reads them
-- through UnitType.upkeepGold / upkeepFood. What has never existed is a
-- FACTION term: every unit's bill is a pure function of its tier, so an Ashen
-- skeleton and a Crownlands swordsman of the same tier cost the same. This
-- file gives the three non-human rosters their own bill. It is DATA ONLY --
-- no engine file, no income or movement table, no map generation is touched.
--
-- ── The premise, measured at this SHA (not taken from prose) ──
-- docs/army.md's "the catalog's own upkeep_gold/upkeep_food columns still all
-- ship at 1/1" is STALE: 021's `UPDATE unit_types SET upkeep_gold =
-- COALESCE(tier, 8)` (mirrored by 033 for its own 15 rows) has run at every
-- boot since. Measured on the long-lived dev database at this SHA:
--
--   SELECT count(*) AS units, count(*) FILTER (WHERE upkeep_gold = 1 AND
--          upkeep_food = 1) AS ship_1_1, count(DISTINCT (upkeep_gold,
--          upkeep_food)) AS distinct_pairs FROM unit_types;
--    units | ship_1_1 | distinct_pairs
--   -------+----------+----------------
--       52 |        4 |              8
--
-- Four of the fifty-two rows are 1/1; the other forty-eight are already
-- graded, and fourteen of them are not on the ladder at all (the tier-3..7
-- food column is capped at 3 by 021's LEAST(3, ...)). So the truthful
-- statement is not "everything is 1/1" -- it is "every unit's bill is a
-- function of its tier alone and no faction's roster bills differently", which
-- is what this file changes.
--
-- ── The ladder this file reads ──
-- t    = COALESCE(tier, 8)                            -- 021/033's own read
-- f(t) = LEAST(3, GREATEST(1, CEIL(t / 2.0)))         -- 021's food rule
-- V(t) = t + f(t)                                     -- a unit's whole bill today
--
-- ── The design rule: SHAPE the bill, never RESIZE it ──
-- Each faction keeps V(t) -- its per-unit total in gold + food -- for every
-- tier, and only moves the split between the two columns. A faction that
-- wanted a smaller total would be strictly better than the others at equal
-- roster strength, which is the one thing this migration must not do. The
-- three non-human shapes, with Human left exactly as it is (the control the
-- faction design leans on):
--
--   human    (t, f(t))                                  untouched
--   ashen    (V(t), 0)                                  pays the whole bill in gold
--   ironmark (GREATEST(1, t - 2), V(t) - gold)          pays it in stores
--   verdant  (V(t) - GREATEST(1, f(t) - 1), that)       pays a little more coin
--
-- which lands, tier by tier, on:
--
--   tier |  V | human | ashen | ironmark | verdant
--   -----+----+-------+-------+----------+--------
--      1 |  2 |   1/1 |   2/0 |      1/1 |     1/1
--      2 |  3 |   2/1 |   3/0 |      1/2 |     2/1
--      3 |  5 |   3/2 |   5/0 |      1/4 |     4/1
--      4 |  6 |   4/2 |   6/0 |      2/4 |     5/1
--      5 |  8 |   5/3 |   8/0 |      3/5 |     6/2
--      6 |  9 |   6/3 |   9/0 |      4/5 |     7/2
--      7 | 10 |   7/3 |  10/0 |      5/5 |     8/2
--   NULL | 11 |   8/3 |     - |        - |       -    (neutral monsters: untouched)
--
-- Read it as a spectrum with Human in the middle: Ashen and Verdant pay the
-- same total in more coin and less food, Ironmark pays it in more food and
-- less coin. Every row's two numbers still add to V. The three lowest bills
-- (tiers 1-2, V of 2 and 3) cannot be split four ways into distinct shapes,
-- so Human/Ironmark/Verdant coincide at tier 1 and Human/Verdant at tier 2 --
-- stated here rather than hidden: the identity bites from tier 3 up, which is
-- where 9 of Human's 12 units and 10 of each other roster's sit.
--
-- ── Why equal totals is the right equality ──
-- Gold and food are not freely interchangeable in this game, but the one lane
-- that does exchange them prices them 1:1: the legacy auto-trade moves food to
-- a deficit settlement and books `goldPaid = transferable`
-- (packages/engine/src/economy/trade.ts). On the game's own rate, holding
-- gold + food fixed holds the bill fixed. The residual asymmetry is real and
-- is NOT hidden here: a food shortage additionally carries the consumption
-- step's foodDeficitRatio morale penalty, so a food-light bill is the safer
-- one and Ashen's is the safest of the four. It cuts both ways -- Ashen is the
-- most exposed to an empty treasury and Ironmark the most exposed to a failed
-- harvest -- and both directions are represented, so neither is a free win
-- over Human.
--
-- ── Guarded against a boot-order bug that is live at this SHA ──
-- The guards below ask "does this row already carry this faction's bill for
-- its tier?", NOT "is this row still on 021's ladder?". That distinction is
-- load-bearing, and it was found by running a FRESH database rather than the
-- long-lived one: 021 re-runs at every boot, but it sits at position 21, so
-- every unit INSERTed after it -- 024/025/026's faction rosters -- keeps 015's
-- column DEFAULT (1 gold / 1 food) for the whole of a fresh database's first
-- boot. Measured on a fresh database at this SHA, before this file:
--
--   faction  | units | billed 1/1 in gold AND food
--   ---------+-------+----------------------------
--   ashen    |    12 |                          7
--   human    |    12 |                          1    (its tier-1 peasant, which is 1/1 on the ladder too)
--   ironmark |    12 |                          8
--   verdant  |    12 |                          8
--   neutral  |     4 |                          0
--
-- 21 of those 23 are 024/025/026's own rows, which nothing grades on a first
-- boot. The other 2 are the tier-1 units 033 inserts (tunnel_levy,
-- sproutling): 033 grades its own fifteen rows after inserting them, and at
-- tier 1 the ladder's answer is 1/1 anyway, so they are right by accident
-- rather than by reach. The same boot also leaves eleven (faction, tier) pairs
-- billing two different amounts -- ashen tier 3 is 1/1 vs 3/2, verdant tier 6
-- is 1/1 vs 6/3 -- so a fresh install's faction rosters are not merely
-- unshaped, they are internally inconsistent. A guard written against the
-- ladder would skip every one of those rows and leave a fresh install in that
-- state until a second boot -- the same shape of bug as 006 (renumbered from
-- 023, it now runs before the migrations that INSERT four of the units it
-- backfills). Asking the question the other way round makes this file repair
-- them instead: measured after this file, one boot, two boots and the tsx
-- pipeline all produce the same 52 rows.
--
-- ── Why nothing here is keyed to an id list ──
-- Every statement filters on faction_id and derives its numbers from `tier`.
-- A future migration that INSERTs a unit into one of these factions gets that
-- faction's bill on the next boot with no edit here -- the failure mode 006's
-- frozen backfill list hit. There is nothing to renumber and nothing to keep
-- in sync.
--
-- ── Idempotence ──
-- Migrations re-run at every boot, sorted by filename (server/db.ts), so this
-- file runs after 021, 027 and 033. Each statement writes only the rows that
-- do not already hold the value it is writing, which makes a re-run a literal
-- no-op (0 rows) rather than a rewrite -- and, like 021's own unconditional
-- recompute, it means a hand-tuned per-unit override is reverted on the next
-- boot. Retuning is a migration edit, not a manual UPDATE, exactly as 021's
-- header says. A unit RETAGGED to another faction simply stops being touched.
-- The gold/food columns are INTEGER NOT NULL with no CHECK (measured), and
-- every value this file writes is a whole number, so 027's "sums of per-unit
-- upkeep are integral by construction" contract for the *_unpaid_gold
-- counters still holds -- which is also why Verdant's food floor is 1 rather
-- than the 0.5 a fractional design would need.

-- ── Ashen: pays in gold, eats nothing ──
-- f is 1,1,2,2,3,3,3 across tiers 1..7, so V is 2,3,5,6,8,9,10: the dearest
-- gold bill in the game and a food bill that is zero at every tier. A zero is
-- safe here and was checked, not assumed: affordableHeadcount treats a
-- per-unit cost of <= 0 as "always fed" (economy/troopUpkeep.ts), so an Ashen
-- army can never lose troops to an empty larder, and its shortfall maths keys
-- on the gold side, which is never zero.
WITH base AS (
  SELECT id,
         (COALESCE(tier, 8) + LEAST(3, GREATEST(1, CEIL(COALESCE(tier, 8) / 2.0))))::int AS bill
    FROM unit_types
   WHERE faction_id = 'ashen'
     AND tier IS NOT NULL
)
UPDATE unit_types u
   SET upkeep_gold = base.bill,
       upkeep_food = 0
  FROM base
 WHERE u.id = base.id
   AND (u.upkeep_gold IS DISTINCT FROM base.bill OR u.upkeep_food IS DISTINCT FROM 0);

-- ── Ironmark: digs in, then out-produces -- its army is a farming problem ──
-- One gold cheaper than the ladder at every tier above 1, with the food column
-- taking the difference (1/1, 1/2, 1/4, 2/4, 3/5, 4/5, 5/5). The floor of 1
-- gold is not cosmetic: desertion is a weighted draw in unitUpkeepGold
-- (units.ts's desertTroopsByCost) and a gold bill of zero would make an unfed
-- Ironmark army weightless -- it would starve and never desert. Food is
-- charged from the warehouse / the hero's larder, so this is the roster that
-- has to keep growing something.
WITH base AS (
  SELECT id,
         (COALESCE(tier, 8) + LEAST(3, GREATEST(1, CEIL(COALESCE(tier, 8) / 2.0))))::int AS bill,
         GREATEST(1, COALESCE(tier, 8) - 2)::int AS gold
    FROM unit_types
   WHERE faction_id = 'ironmark'
     AND tier IS NOT NULL
)
UPDATE unit_types u
   SET upkeep_gold = base.gold,
       upkeep_food = base.bill - base.gold
  FROM base
 WHERE u.id = base.id
   AND (u.upkeep_gold IS DISTINCT FROM base.gold
        OR u.upkeep_food IS DISTINCT FROM base.bill - base.gold);

-- ── Verdant: moves first, and pays for it in coin ──
-- One food cheaper than the ladder at every tier above 2, with the gold column
-- taking the difference (1/1, 2/1, 4/1, 5/1, 6/2, 7/2, 8/2): the lightest
-- larder of the four at every tier 3 and up, and the second-dearest purse.
-- The food floor of 1 keeps Ashen the only food-free faction -- a shared "eats
-- nothing" would blur the two.
WITH base AS (
  SELECT id,
         (COALESCE(tier, 8) + LEAST(3, GREATEST(1, CEIL(COALESCE(tier, 8) / 2.0))))::int AS bill,
         GREATEST(1, LEAST(3, GREATEST(1, CEIL(COALESCE(tier, 8) / 2.0)))::int - 1) AS food
    FROM unit_types
   WHERE faction_id = 'verdant'
     AND tier IS NOT NULL
)
UPDATE unit_types u
   SET upkeep_gold = base.bill - base.food,
       upkeep_food = base.food
  FROM base
 WHERE u.id = base.id
   AND (u.upkeep_gold IS DISTINCT FROM base.bill - base.food
        OR u.upkeep_food IS DISTINCT FROM base.food);

-- Human and neutral are deliberately absent above: Human stays the 1/1-and-up
-- ladder (the control every faction proposal is measured against) and the four
-- free monsters keep 021's 8 gold / 3 food. Leaving them alone is also what
-- keeps every existing upkeep fixture in test/engine and test/screens exact --
-- those fixtures all build Human armies.
