import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { PoolClient } from "pg";
import { hydrateGameState } from "@heroes/engine";
import type { HeroId, HeroState, SettlementId, SettlementState } from "@heroes/contracts";
import { withRollback } from "../helpers/pgTestTx";
import { pool } from "../../server/persistence/db";
import { createGameRepo } from "../../server/persistence/repositories/gameRepo";
import { createHeroRepo } from "../../server/persistence/repositories/heroRepo";
import { createSettlementRepo } from "../../server/persistence/repositories/settlementRepo";
import { createCharterRepo } from "../../server/persistence/repositories/charterRepo";
import { hydrateGame } from "../../server/persistence/hydrate";
import { makeCharter, makeHero, makeSettlement } from "../charter/_helpers";

// withRollback pulls in the shared pg pool; close it once this file's tests
// are done so node:test's process can exit promptly instead of waiting out
// the pool's idle timeout -- same convention as test/persistence/*.test.ts
// and test/migrations/migration.test.ts.
after(() => pool.end());

// Round-trip equivalence check for Phase 4 Track A's read-path cutover
// (plan/2026-08-17-phase-4-db-deblobbing-dev-plan.md, "Dual-write &
// read-path design"): hydrateGame() must hydrate a byte-identical
// GameState from the granular tables as @heroes/engine's own
// hydrateGameState() produces from the legacy JSONB row, for the same
// underlying data. test/migrations/migration.test.ts already covers this
// equivalence at the repo layer (heroRepo/settlementRepo round-trip); this
// file covers it one layer up, at the GameState the server actually
// operates on -- including the fallback branch and activeCharters, neither
// of which that file's scope touches.

function uniqueName(): string {
  return `test-hydrate-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function seedLegacyGame(
  client: PoolClient,
  name: string,
  heroes: Record<HeroId, HeroState>,
  settlements: Record<SettlementId, SettlementState>,
): Promise<void> {
  await client.query(
    `INSERT INTO games (name, seed, hero_q, hero_r, heroes, settlements)
     VALUES ($1, 1, 0, 0, $2::jsonb, $3::jsonb)`,
    [name, JSON.stringify(heroes), JSON.stringify(settlements)],
  );
}

test("hydrateGame falls back to the legacy JSONB row when the granular tables are empty, and logs a telemetry marker", async () => {
  await withRollback(async (client) => {
    const name = uniqueName();
    const heroes: Record<HeroId, HeroState> = { h0: makeHero("h0", 0, 2, 2, { gold: 15 }) };
    const settlements: Record<SettlementId, SettlementState> = { s0: makeSettlement("s0", 0, 2, 2) };
    await seedLegacyGame(client, name, heroes, settlements);

    // Plain manual monkey-patch (not node:test's mock API) -- consistent
    // with how the rest of the test suite has no prior mock.method usage,
    // and this only needs to capture what console.info was called with.
    const originalInfo = console.info;
    const infoCalls: unknown[][] = [];
    console.info = (...args: unknown[]) => {
      infoCalls.push(args);
    };
    let result;
    try {
      result = await hydrateGame(client, name);
    } finally {
      console.info = originalInfo;
    }

    assert.equal(result.source, "jsonb");
    // Not compared against the raw `heroes`/`settlements` objects directly:
    // hydrateGameState() always runs normalizePlatoons() on every hero's
    // stacks (packages/engine/src/hydrate.ts's backfillHero), which pads an
    // empty [] out to ARMY_STACK_SLOTS (8) empty platoons -- a pre-existing
    // behavior of the (unchanged) JSONB path, not something this fallback
    // branch does differently. The round-trip-equivalence assertion below,
    // against hydrateGameState(row) directly, is the meaningful check.
    assert.deepEqual(result.state.activeCharters, []);

    // Round-trip equivalence: identical to calling @heroes/engine's own
    // hydrateGameState() directly against the same row.
    const row = await createGameRepo(client).load(name);
    assert.deepEqual(result.state, hydrateGameState(row));

    assert.equal(infoCalls.length, 1, "expected exactly one telemetry log call");
    const [message] = infoCalls[0];
    assert.match(String(message), /\[hydrate\]/);
    assert.match(String(message), new RegExp(name));
  });
});

test("hydrateGame reads from the granular tables once populated, matching the JSONB-derived GameState for the same data", async () => {
  await withRollback(async (client) => {
    const name = uniqueName();
    const heroes: Record<HeroId, HeroState> = {
      h0: makeHero("h0", 0, 2, 2, {
        gold: 40,
        stacks: [{ entries: [{ unitTypeId: "archer", count: 5 }] }],
      }),
    };
    const settlements: Record<SettlementId, SettlementState> = {
      s0: makeSettlement("s0", 0, 2, 2, { resourceRates: { wood: 15, gold: 20 } }),
      s1: makeSettlement("s1", null, 10, 10, { level: 2 }),
    };
    await seedLegacyGame(client, name, heroes, settlements);
    // No telemetry-marker assertion needed here -- that's covered by the
    // fallback test above, and this game's granular tables are populated
    // below, so hydrateFromRepos() never takes the logging branch.

    await createHeroRepo(client).upsertMany(name, heroes);
    await createSettlementRepo(client).upsertMany(name, settlements);

    const result = await hydrateGame(client, name);

    assert.equal(result.source, "granular");
    const row = await createGameRepo(client).load(name);
    // Same underlying heroes/settlements either path, so the resulting
    // GameState must be identical regardless of which table it came from.
    assert.deepEqual(result.state, hydrateGameState(row));
  });
});

test("hydrateGame's granular path surfaces real charters, which the legacy JSONB path can never produce", async () => {
  await withRollback(async (client) => {
    const name = uniqueName();
    const heroes: Record<HeroId, HeroState> = {
      h0: makeHero("h0", 0, 2, 2, { isChartering: true, charterId: "c0" }),
    };
    const settlements: Record<SettlementId, SettlementState> = { s0: makeSettlement("s0", 0, 2, 2) };
    await seedLegacyGame(client, name, heroes, settlements);

    await createHeroRepo(client).upsertMany(name, heroes);
    await createSettlementRepo(client).upsertMany(name, settlements);
    const charter = makeCharter({ id: "c0", heroId: "h0", ownerId: 0 });
    await createCharterRepo(client).upsertMany(name, [charter]);

    const result = await hydrateGame(client, name);

    assert.equal(result.source, "granular");
    assert.deepEqual(result.state.activeCharters, [charter]);

    // packages/engine/src/hydrate.ts's own hydrateGameState() has no
    // charters table to read from -- it always defaults activeCharters to
    // [] (see its own comment on why). This is the one field where the two
    // paths are EXPECTED to diverge until the legacy row itself carries
    // charter data (it never will -- see server/migrations/
    // 009_granular_entities.sql's note on why `charters` is Phase 4-only).
    const row = await createGameRepo(client).load(name);
    assert.deepEqual(hydrateGameState(row).activeCharters, []);
  });
});

test("hydrateGame falls back to the JSONB path when only one granular table has been populated (partial/inconsistent state)", async () => {
  // Shouldn't be reachable via any real code path today -- dual-write
  // (server/app/commandHandler.ts's dualWriteEntities) and the backfill
  // script (scripts/migrate-jsonb-to-tables.ts's backfillGame) both upsert
  // heroRepo and settlementRepo together inside the same DB transaction as
  // the JSONB write. This test documents hydrateFromRepos()'s defensive
  // choice anyway: falling back the moment EITHER table is empty, not only
  // when both are, so a hypothetical partial write never silently returns
  // a GameState missing every hero or every settlement.
  await withRollback(async (client) => {
    const name = uniqueName();
    const heroes: Record<HeroId, HeroState> = { h0: makeHero("h0", 0, 2, 2) };
    const settlements: Record<SettlementId, SettlementState> = { s0: makeSettlement("s0", 0, 2, 2) };
    await seedLegacyGame(client, name, heroes, settlements);
    await createHeroRepo(client).upsertMany(name, heroes);
    // settlementRepo deliberately left empty.

    const result = await hydrateGame(client, name);

    assert.equal(result.source, "jsonb");
    // See the first test's comment on why this compares against
    // hydrateGameState(row) rather than the raw pre-hydration objects
    // (normalizePlatoons pads stacks to 8 slots either way).
    const row = await createGameRepo(client).load(name);
    assert.deepEqual(result.state, hydrateGameState(row));
  });
});
