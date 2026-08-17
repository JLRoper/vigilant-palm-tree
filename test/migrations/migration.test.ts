import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { HeroId, HeroState, SettlementId, SettlementState } from "@heroes/contracts";
import { pool } from "../../server/persistence/db";
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

test("backfillGame round-trips a representative mix of heroes and settlements", async () => {
  const name = uniqueName();
  try {
    const heroes: Record<HeroId, HeroState> = {
      h0: makeHero("h0", 0, 2, 2, {
        gold: 40,
        troops: 12,
        stacks: [
          { entries: [{ unitTypeId: "archer", count: 5 }, { unitTypeId: "swordsman", count: 3 }] },
          { entries: [{ unitTypeId: "cavalry", count: 2 }] },
        ],
      }),
      h1: makeHero("h1", 0, 5, 5, { stacks: [] }),
      h2: makeHero("h2", 1, 8, 8, { isChartering: true, charterId: "c-outstanding" }),
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
    const heroes: Record<HeroId, HeroState> = { h0: makeHero("h0", 0, 1, 1, { gold: 10 }) };
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
