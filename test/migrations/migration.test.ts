import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { HeroId, HeroState, SettlementId, SettlementState } from "@heroes/contracts";
import { pool } from "../../server/persistence/db";
import { initSchema } from "../../server/db";
import { createHeroRepo } from "../../server/persistence/repositories/heroRepo";
import { createSettlementRepo } from "../../server/persistence/repositories/settlementRepo";
import { backfillGame } from "../../scripts/migrate-jsonb-to-tables";
import { makeHero, makeSettlement } from "../charter/_helpers";

// Close the shared pg pool once this file's tests are done so node:test's
// process can exit promptly instead of waiting out the pool's idle timeout
// -- same convention as test/persistence/*.test.ts.
after(() => pool.end());

// Round-trip integrity check for the Phase 4 backfill (plan/2026-08-17-
// phase-4-db-deblobbing-dev-plan.md): a representative game's heroes/
// settlements, written the old (pre-Phase-4) way as games.heroes/
// games.settlements JSONB, should come back byte-for-byte identical after
// running through backfillGame() and reading back via the new granular
// repos. This is what "the migration doesn't lose data" actually means at
// Track B's layer -- server/persistence/hydrate.ts (Track A, not built yet)
// is the next consumer, assembling these into a full GameState; that's a
// separate, later check once that file exists, not this one's job.
//
// Doesn't use test/helpers/pgTestTx.ts's withRollback: backfillGame() opens
// its own pool connection per game (by design -- see the script's own
// comment on why it's one transaction per game, not a global one), which
// can't see another connection's uncommitted rows. So this test commits a
// real row and cleans it up itself instead.

function uniqueName(): string {
  return `test-migration-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function seedLegacyGame(
  name: string,
  heroes: Record<HeroId, HeroState>,
  settlements: Record<SettlementId, SettlementState>,
): Promise<void> {
  await pool.query(
    `INSERT INTO games (name, seed, hero_q, hero_r, heroes, settlements)
     VALUES ($1, 1, 0, 0, $2::jsonb, $3::jsonb)`,
    [name, JSON.stringify(heroes), JSON.stringify(settlements)],
  );
}

function byId<T extends { id: string }>(rows: T[]): Record<string, T> {
  return Object.fromEntries(rows.map((r) => [r.id, r]));
}

// Migration 014's hero columns carry defaults (wagons 5, empty cargo), so
// loadAllForGame adds these keys to every loaded hero even when the seeded
// JSONB omitted them. Migration 023's treasury_wagons is deliberately
// NULLABLE (no DB-side default): the key below is present only because the
// makeHero fixture emits it (value-neutral with init); an ABSENT field
// round-trips absent so the engine's soft default (5 carts / a 2,500g
// purse) keeps applying -- pinned in test/persistence/heroRepo.test.ts and
// by the pre-split-hero test at the bottom of this file.
function withWagonDefaults(h: HeroState): HeroState {
  return { ...h, wagons: 5, treasuryWagons: 5, resources: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 } };
}

test("migration 027 leaves every numeric game column NUMERIC and re-applies cleanly against a populated DB", async () => {
  // initSchema() is what the server runs at every boot and what fresh
  // environments get on first boot, so re-running it here against this
  // already-populated database proves two things at once: the INTEGER ->
  // NUMERIC widening applies cleanly over existing rows, and a second pass is
  // an accepted no-op (ALTER COLUMN TYPE to the type it already has).
  await initSchema();

  const r = await pool.query<{ table_name: string; column_name: string; data_type: string }>(
    `SELECT table_name, column_name, data_type
       FROM information_schema.columns
      WHERE (table_name = 'games' AND column_name = 'gold')
         OR (table_name = 'settlements' AND column_name IN ('gold', 'morale'))
         OR (table_name = 'settlement_resources' AND column_name = 'amount')
         OR (table_name = 'heroes' AND column_name IN ('gold', 'morale'))
         OR (table_name = 'settlement_snapshots' AND column_name IN ('gold', 'morale', 'effective_income'))
         OR (table_name = 'resource_transactions' AND column_name IN ('amount', 'gold_paid'))`,
  );
  const byColumn = new Map(r.rows.map((row) => [`${row.table_name}.${row.column_name}`, row.data_type]));
  const expected = [
    "games.gold",
    "settlements.gold",
    "settlements.morale",
    "settlement_resources.amount",
    "heroes.gold",
    "heroes.morale",
    "settlement_snapshots.gold",
    "settlement_snapshots.morale",
    "settlement_snapshots.effective_income",
    "resource_transactions.amount",
    "resource_transactions.gold_paid",
  ];
  assert.equal(r.rowCount, expected.length, `expected exactly the migrated columns, got: ${[...byColumn.keys()].join(", ")}`);
  for (const column of expected) {
    assert.equal(byColumn.get(column), "numeric", `${column} must be NUMERIC after migration 027`);
  }
});

test("backfillGame round-trips fractional engine values through the granular tables at full precision", async () => {
  // The rounding-shadow regression, at the layer it lived: a legacy JSONB
  // blob holding the engine's 2-decimal floats must survive backfillGame()
  // (the granular dual-write) WITHOUT losing its fraction. Under the old
  // INTEGER columns the write boundary rounded here -- the shadow that made
  // every granular-read game shed up to half a coin per quantity per command.
  const name = uniqueName();
  try {
    const heroes: Record<HeroId, HeroState> = {
      h0: withWagonDefaults(makeHero("h0", 0, 2, 2, { gold: 499.55, morale: 93.4 })),
    };
    const settlements: Record<SettlementId, SettlementState> = {
      s0: makeSettlement("s0", 0, 2, 2, {
        gold: 500.55,
        morale: 90.4,
        resourceRates: { wood: 15 },
        warehouse: { wood: 12.25, stone: 0, iron: 0, arcane: 0, food: 6.45 },
      }),
    };
    await seedLegacyGame(name, heroes, settlements);

    await backfillGame(name);

    const [loadedHero] = await createHeroRepo(pool).loadAllForGame(name);
    const [loadedSettlement] = await createSettlementRepo(pool).loadAllForGame(name);
    assert.equal(loadedHero.gold, 499.55);
    assert.equal(loadedHero.morale, 93.4);
    assert.equal(loadedSettlement.gold, 500.55);
    assert.equal(loadedSettlement.morale, 90.4);
    assert.equal(loadedSettlement.warehouse.wood, 12.25);
    assert.equal(loadedSettlement.warehouse.food, 6.45);
  } finally {
    await pool.query("DELETE FROM games WHERE name = $1", [name]);
  }
});

test("backfillGame round-trips a representative mix of heroes and settlements", async () => {
  const name = uniqueName();
  try {
    const heroes: Record<HeroId, HeroState> = {
      // wagons/resources: the granular columns carry defaults (migration
      // 014), so the round-trip adds these keys to every loaded hero.
      h0: withWagonDefaults(makeHero("h0", 0, 2, 2, {
        gold: 40,
        troops: 12,
        stacks: [
          { entries: [{ unitTypeId: "archer", count: 5 }, { unitTypeId: "swordsman", count: 3 }] },
          { entries: [{ unitTypeId: "cavalry", count: 2 }] },
        ],
      })),
      h1: withWagonDefaults(makeHero("h1", 0, 5, 5, { stacks: [] })),
      h2: withWagonDefaults(makeHero("h2", 1, 8, 8, { isChartering: true, charterId: "c-outstanding" })),
    };
    const settlements: Record<SettlementId, SettlementState> = {
      s0: makeSettlement("s0", 0, 2, 2, {
        level: 1,
        resourceRates: { wood: 15, gold: 20 },
      }),
      s1: makeSettlement("s1", 0, 10, 10, {
        level: 2,
        buildings: [{ gx: 1, gy: 1, kind: "house", level: 1, style: "classic" }],
      }),
      s2: makeSettlement("s2", null, 20, 20, { level: 3 }),
    };
    await seedLegacyGame(name, heroes, settlements);

    await backfillGame(name);

    const loadedHeroes = byId(await createHeroRepo(pool).loadAllForGame(name));
    const loadedSettlements = byId(await createSettlementRepo(pool).loadAllForGame(name));

    assert.deepEqual(loadedHeroes, heroes);
    assert.deepEqual(loadedSettlements, settlements);
  } finally {
    // Cascades to heroes/hero_platoons/settlements/settlement_resources/
    // settlement_buildings via their game_id/settlement_id/hero_id FKs.
    await pool.query("DELETE FROM games WHERE name = $1", [name]);
  }
});

test("backfillGame is idempotent: running it twice converges to the same rows", async () => {
  const name = uniqueName();
  try {
    const heroes: Record<HeroId, HeroState> = { h0: withWagonDefaults(makeHero("h0", 0, 1, 1, { gold: 10 })) };
    const settlements: Record<SettlementId, SettlementState> = { s0: makeSettlement("s0", 0, 1, 1) };
    await seedLegacyGame(name, heroes, settlements);

    await backfillGame(name);
    await backfillGame(name);

    const loadedHeroes = byId(await createHeroRepo(pool).loadAllForGame(name));
    const loadedSettlements = byId(await createSettlementRepo(pool).loadAllForGame(name));

    assert.deepEqual(loadedHeroes, heroes);
    assert.deepEqual(loadedSettlements, settlements);
  } finally {
    await pool.query("DELETE FROM games WHERE name = $1", [name]);
  }
});

test("backfillGame handles a game with no heroes or settlements", async () => {
  const name = uniqueName();
  try {
    await seedLegacyGame(name, {}, {});

    await backfillGame(name);

    assert.deepEqual(await createHeroRepo(pool).loadAllForGame(name), []);
    assert.deepEqual(await createSettlementRepo(pool).loadAllForGame(name), []);
  } finally {
    await pool.query("DELETE FROM games WHERE name = $1", [name]);
  }
});

test("migration 023 keeps a pre-split hero's treasury carts ABSENT (NULL, never a backfilled 0)", async () => {
  // The treasury-wagons split's legacy contract: a hero persisted before
  // 023 has no treasuryWagons key, and the ENGINE soft-defaults absent to
  // 5 carts (a 2,500g purse cap). If the migration had backfilled
  // NOT NULL DEFAULT 0, every live hero row would read treasuryWagons: 0
  // and every existing save's purse cap would silently drop to 0 -- the
  // exact churn the soft default exists to prevent. The column stays
  // NULLable so absence round-trips as absence (an explicit 0 is a real
  // value and round-trips as 0 -- pinned in heroRepo.test.ts).
  const name = uniqueName();
  try {
    const preSplit = makeHero("h0", 0, 2, 2, { wagons: 3 });
    delete preSplit.treasuryWagons;
    // Seed the pre-split hero AS-IS, not through withWagonDefaults: that
    // helper mirrors what 014's DB-side defaults materialize on load
    // (wagons 5, empty cargo) and re-adds the treasuryWagons key makeHero
    // emits -- both would defeat this test's fixture (wagons 3, no key).
    const heroes: Record<HeroId, HeroState> = {
      h0: { ...preSplit },
    };
    const settlements: Record<SettlementId, SettlementState> = { s0: makeSettlement("s0", 0, 2, 2) };
    await seedLegacyGame(name, heroes, settlements);

    await backfillGame(name);

    const [loaded] = await createHeroRepo(pool).loadAllForGame(name);
    assert.ok(loaded, "the pre-split hero backfilled");
    assert.equal("treasuryWagons" in loaded, false, "absent stays absent across the 023 column -- the soft default keeps serving 5");
    assert.equal(loaded.wagons, 3, "the neighboring cargo fields are untouched");
  } finally {
    await pool.query("DELETE FROM games WHERE name = $1", [name]);
  }
});
