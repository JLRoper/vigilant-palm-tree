import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { PoolClient } from "pg";
import { hydrateGameState, GameMap, makeInitialStatePayload, mulberry32 } from "@heroes/engine";
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

test("hydrateGame falls back to the legacy JSONB row when the granular tables are empty, and logs a telemetry marker", async (t) => {
  await withRollback(async (client) => {
    const name = uniqueName();
    const heroes: Record<HeroId, HeroState> = { h0: makeHero("h0", 0, 2, 2, { gold: 15 }) };
    const settlements: Record<SettlementId, SettlementState> = { s0: makeSettlement("s0", 0, 2, 2) };
    await seedLegacyGame(client, name, heroes, settlements);

    // node:test's per-test mock API: scoped to this test and
    // auto-restored afterward, unlike a manual global console.info
    // reassignment (which can leak across concurrently-running tests).
    const info = t.mock.method(console, "info", () => {});
    const result = await hydrateGame(client, name);

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

    assert.equal(info.mock.callCount(), 1, "expected exactly one telemetry log call");
    const [message] = info.mock.calls[0].arguments;
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

test("backfillHero passes wagons/resources/treasuryWagons through BOTH hydration paths (Phase 1a data-loss regression)", async () => {
  // The pre-Phase-1 bug: backfillHero rebuilt each hero from an explicit
  // field list that OMITTED wagons and resources, so a persisted
  // `wagons: 3` silently re-defaulted to 5 and real cargo read as
  // all-zero on BOTH read paths (legacy JSONB directly; granular via
  // server/persistence/hydrate.ts feeding heroRepo-loaded heroes back
  // through hydrateGameState). Phase 1 adds treasuryWagons to the same
  // passthrough, so a 2-cart hero (a 1,000g purse cap) must survive too.
  await withRollback(async (client) => {
    const name = uniqueName();
    const persisted = makeHero("h0", 0, 2, 2, {
      gold: 15,
      wagons: 3,
      treasuryWagons: 2,
      resources: { wood: 40, stone: 0, iron: 0, arcane: 7, food: 0 },
    });
    const legacy = makeHero("h1", 1, 8, 8);
    delete legacy.wagons;
    delete legacy.resources;
    delete legacy.treasuryWagons;
    const heroes: Record<HeroId, HeroState> = { h0: persisted, h1: legacy };
    const settlements: Record<SettlementId, SettlementState> = { s0: makeSettlement("s0", 0, 2, 2) };
    await seedLegacyGame(client, name, heroes, settlements);

    // Path 1: legacy JSONB row -> hydrateGameState directly.
    const row = await createGameRepo(client).load(name);
    const fromJsonb = hydrateGameState(row);
    assert.equal(fromJsonb.heroes.h0.wagons, 3, "JSONB path: persisted wagons survive backfillHero");
    assert.equal(fromJsonb.heroes.h0.treasuryWagons, 2, "JSONB path: persisted treasury carts survive backfillHero");
    assert.deepEqual(
      fromJsonb.heroes.h0.resources,
      { wood: 40, stone: 0, iron: 0, arcane: 7, food: 0 },
      "JSONB path: real cargo survives backfillHero",
    );
    assert.equal("treasuryWagons" in fromJsonb.heroes.h1, false, "absent stays absent -- the soft default is applied by the accessors, never materialized here");

    // Path 2: granular tables -> heroRepo -> hydrateFromRepos -> hydrateGameState.
    await createHeroRepo(client).upsertMany(name, heroes);
    await createSettlementRepo(client).upsertMany(name, settlements);
    const granular = await hydrateGame(client, name);
    assert.equal(granular.source, "granular");
    assert.equal(granular.state.heroes.h0.wagons, 3, "granular path: persisted wagons survive backfillHero");
    assert.equal(granular.state.heroes.h0.treasuryWagons, 2, "granular path: persisted treasury carts survive backfillHero");
    assert.deepEqual(
      granular.state.heroes.h0.resources,
      { wood: 40, stone: 0, iron: 0, arcane: 7, food: 0 },
      "granular path: real cargo survives backfillHero",
    );
    assert.deepEqual(granular.state.heroes.h0, fromJsonb.heroes.h0, "both hydration paths agree on the loaded hero byte-for-byte");
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

test("hydrateGame round-trips next_charter_id/next_settlement_id once they're persisted, alongside the charter they gate", async () => {
  await withRollback(async (client) => {
    const name = uniqueName();
    const heroes: Record<HeroId, HeroState> = {
      h0: makeHero("h0", 0, 2, 2, { isChartering: true, charterId: "ch3" }),
    };
    const settlements: Record<SettlementId, SettlementState> = { s0: makeSettlement("s0", 0, 2, 2) };
    await seedLegacyGame(client, name, heroes, settlements);
    // Phase 1-5 track map §5.1 R5's counter-persistence fix: before
    // GAME_COLUMNS/saveHeroesAndSettlements carried these two, this call
    // would silently no-op them and the assertions below would see 0/1
    // (the settlementCount-derived floor) instead of the real values.
    await createGameRepo(client).saveHeroesAndSettlements(name, heroes, settlements, {
      next_charter_id: 4,
      next_settlement_id: 7,
    });
    await createHeroRepo(client).upsertMany(name, heroes);
    await createSettlementRepo(client).upsertMany(name, settlements);
    const charter = makeCharter({ id: "ch3", heroId: "h0", ownerId: 0, settlementId: "s7" });
    await createCharterRepo(client).upsertMany(name, [charter]);

    const result = await hydrateGame(client, name);

    assert.equal(result.source, "granular");
    assert.equal(result.state.nextCharterId, 4);
    assert.equal(result.state.nextSettlementId, 7);
    assert.deepEqual(result.state.activeCharters, [charter]);

    // Round-trip equivalence still holds directly against the row too.
    const row = await createGameRepo(client).load(name);
    assert.equal(hydrateGameState(row).nextCharterId, 4);
    assert.equal(hydrateGameState(row).nextSettlementId, 7);
  });
});

// A row shaped just well enough for hydrateGameState's own reads (players is
// indexed for the AI_TURN check); every other field is defaulted by the
// function itself, which is exactly the point here.
function hydrateRow(
  heroes: Record<HeroId, Partial<HeroState>>,
  settlements: Record<SettlementId, Partial<SettlementState>>,
): Parameters<typeof hydrateGameState>[0] {
  return {
    round: 1,
    day: 1,
    active_player_id: 0,
    players: [{ id: 0, faction: "player", name: "Player 1", color: "#000000", heroIds: [], settlementIds: [] }],
    heroes,
    settlements,
  } as unknown as Parameters<typeof hydrateGameState>[0];
}

test("hydrateGameState defaults the weekly-upkeep shortfall fields for a legacy row that predates them", () => {
  // A pre-migration row: the heroes/settlements JSONB carries no morale /
  // unpaid-upkeep keys at all (021 added them), so hydrateGameState's
  // defensive `?? ` defaults are what keeps such a game playable.
  const legacyHero = makeHero("h0", 0, 2, 2);
  delete (legacyHero as unknown as Record<string, unknown>).morale;
  delete (legacyHero as unknown as Record<string, unknown>).upkeepUnpaidSinceDay;
  delete (legacyHero as unknown as Record<string, unknown>).upkeepUnpaidTroops;
  delete (legacyHero as unknown as Record<string, unknown>).upkeepUnpaidGold;
  const legacySettlement = makeSettlement("s0", 0, 2, 2);
  delete (legacySettlement as unknown as Record<string, unknown>).garrisonUnpaidSinceDay;
  delete (legacySettlement as unknown as Record<string, unknown>).garrisonUnpaidTroops;
  delete (legacySettlement as unknown as Record<string, unknown>).garrisonUnpaidGold;

  const state = hydrateGameState(hydrateRow({ h0: legacyHero }, { s0: legacySettlement }));

  assert.equal(state.heroes["h0"].morale, 100);
  assert.equal(state.heroes["h0"].upkeepUnpaidSinceDay, null);
  assert.equal(state.heroes["h0"].upkeepUnpaidTroops, 0);
  assert.equal(state.heroes["h0"].upkeepUnpaidGold, 0);
  assert.equal(state.settlements["s0"].garrisonUnpaidSinceDay, null);
  assert.equal(state.settlements["s0"].garrisonUnpaidTroops, 0);
  assert.equal(state.settlements["s0"].garrisonUnpaidGold, 0);
});

test("hydrateGameState preserves real upkeep-shortfall values when the row carries them", () => {
  const state = hydrateGameState(
    hydrateRow(
      {
        h0: makeHero("h0", 0, 2, 2, {
          morale: 55,
          upkeepUnpaidSinceDay: 19,
          upkeepUnpaidTroops: 7,
          upkeepUnpaidGold: 49,
        }),
      },
      {
        s0: makeSettlement("s0", 0, 2, 2, {
          garrisonUnpaidSinceDay: 19,
          garrisonUnpaidTroops: 11,
          garrisonUnpaidGold: 88,
        }),
      },
    ),
  );

  assert.equal(state.heroes["h0"].morale, 55);
  assert.equal(state.heroes["h0"].upkeepUnpaidSinceDay, 19);
  assert.equal(state.heroes["h0"].upkeepUnpaidTroops, 7);
  assert.equal(state.heroes["h0"].upkeepUnpaidGold, 49);
  assert.equal(state.settlements["s0"].garrisonUnpaidSinceDay, 19);
  assert.equal(state.settlements["s0"].garrisonUnpaidTroops, 11);
  assert.equal(state.settlements["s0"].garrisonUnpaidGold, 88);
});

test("hydrateGame floors next_settlement_id at the real settlement count for a game that predates the counter", async () => {
  await withRollback(async (client) => {
    const name = uniqueName();
    const heroes: Record<HeroId, HeroState> = { h0: makeHero("h0", 0, 2, 2) };
    const settlements: Record<SettlementId, SettlementState> = {
      s0: makeSettlement("s0", 0, 2, 2),
      s1: makeSettlement("s1", 1, 10, 10),
    };
    await seedLegacyGame(client, name, heroes, settlements);
    // Deliberately never persists next_charter_id/next_settlement_id --
    // simulates a row created before this counter was wired anywhere
    // (server/migrations/009_granular_entities.sql's ADD COLUMN ...
    // DEFAULT 0 leaves next_settlement_id at a real 0 in the DB despite 2
    // settlements already existing). A plain `row.next_settlement_id ?? x`
    // read would allocate the next charter's settlementId as "s0",
    // colliding with the settlement that already exists.

    const result = await hydrateGame(client, name);
    assert.equal(result.state.nextSettlementId, 2, "must floor at the real settlement count, not the raw column default of 0");
    assert.equal(result.state.nextCharterId, 0);
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

test("a newly created game's seeded starter set reaches hydrated live state on BOTH read paths", async () => {
  // The real creation payload (POST /games -> makeInitialStatePayload ->
  // games.settlements JSONB), for the 1-player game whose level-2 town hosts
  // the farm pool sized against the keep+town food bill (20/turn) and whose
  // level-1 keep is seeded with the base set rather than left empty. Path 1 is a
  // brand-new game, read from JSONB because the granular tables are still empty;
  // path 2 is the same game after the first persist has written
  // settlement_buildings. Both settlements' sets must survive both -- a seeded
  // settlement skips the city view's free starter commit, so losing them here
  // would leave it with no town hall forever.
  const payload = makeInitialStatePayload(new GameMap(424242, "small"), mulberry32(424242), {
    castleSeed: 424242,
    enemyCount: 0,
    humanSeatCount: 1,
  });
  const town = Object.values(payload.settlements).find((s) => s.level === 2);
  const keep = Object.values(payload.settlements).find((s) => s.ownerId === 0 && s.level === 1);
  assert.ok(town && keep, "the 1-player payload has a keep and a level-2 town");

  await withRollback(async (client) => {
    const name = uniqueName();
    await seedLegacyGame(client, name, payload.heroes, payload.settlements);

    const assertLiveState = (source: "jsonb" | "granular", settlements: Record<SettlementId, SettlementState>): void => {
      const live = settlements[town.id];
      assert.equal(live.buildings.filter((b) => b.kind === "townHall").length, 1, `${source}: the town keeps its town hall`);
      assert.ok(
        live.buildings.filter((b) => b.kind === "farmField").length >= 2,
        `${source}: the town keeps its farmland (${live.buildings.filter((b) => b.kind === "farmField").length} fields)`,
      );
      assert.deepEqual(live.buildings, town.buildings, `${source}: buildings are byte-identical to the created payload`);
      assert.deepEqual(
        settlements[keep.id].buildings,
        keep.buildings,
        `${source}: the keep's starter set survives too (it is seeded, not free-committed)`,
      );
      assert.ok(
        settlements[keep.id].buildings.length > 0,
        `${source}: the keep is not empty -- the free city-view commit is not what gives it a city`,
      );
      assert.equal(
        settlements[keep.id].buildings.filter((b) => b.kind === "townHall").length,
        1,
        `${source}: the keep keeps its town hall`,
      );
    };

    const fresh = await hydrateGame(client, name);
    assert.equal(fresh.source, "jsonb", "a brand-new game reads from the JSONB payload");
    assertLiveState(fresh.source, fresh.state.settlements);

    await createHeroRepo(client).upsertMany(name, payload.heroes);
    await createSettlementRepo(client).upsertMany(name, payload.settlements);

    const persisted = await hydrateGame(client, name);
    assert.equal(persisted.source, "granular", "after the first persist the granular tables win");
    assertLiveState(persisted.source, persisted.state.settlements);
  });
});

// ---------------------------------------------------------------------------
// C-BLOCKER-1: the charter round-trip. A charter lives in its own table with no
// JSONB fallback, while `isChartering`/`charterId` persist on the hero, so a
// read path that loses the charters hands back a hero nothing can ever unlock.
// ---------------------------------------------------------------------------

test("hydrateGame surfaces the charters table as activeCharters, and the payload path carries the same charter (C-BLOCKER-1)", async () => {
  await withRollback(async (client) => {
    const name = uniqueName();
    const heroes: Record<HeroId, HeroState> = {
      h0: makeHero("h0", 0, 12, 7, { isChartering: true, charterId: "ch0", gold: 0 }),
    };
    const settlements: Record<SettlementId, SettlementState> = { s0: makeSettlement("s0", 0, 4, 2) };
    await seedLegacyGame(client, name, heroes, settlements);
    await createHeroRepo(client).upsertMany(name, heroes);
    await createSettlementRepo(client).upsertMany(name, settlements);
    const charter = makeCharter({
      id: "ch0",
      heroId: "h0",
      ownerId: 0,
      phase: "traveling",
      daysRemaining: 10,
      targetQ: 12,
      targetR: 4,
      settlementId: "s7",
    });
    await createCharterRepo(client).upsertMany(name, [charter]);

    // Path 1: the granular server-side hydration (what every command runs on).
    const hydrated = await hydrateGame(client, name);
    assert.equal(hydrated.source, "granular");
    assert.deepEqual(hydrated.state.activeCharters, [charter], "the in-flight charter survives the reload");
    assert.equal(hydrated.state.activeCharters.length, 1, "activeCharters length after reload");
    assert.equal(hydrated.state.activeCharters[0].phase, "traveling");
    assert.equal(hydrated.state.heroes.h0.isChartering, true, "a hero with a real charter row stays chartering");

    // Path 2: the CLIENT payload path -- GET /games/:name attaches the same
    // rows as `charters`, and hydrateClientGame passes them in as
    // `activeCharters`. Same charter, same hero flag.
    const row = await createGameRepo(client).load(name);
    const viaPayload = hydrateGameState({
      ...row,
      heroes: { h0: { ...heroes.h0 } },
      activeCharters: [charter],
    });
    assert.deepEqual(viaPayload.activeCharters, [charter]);
    assert.equal(viaPayload.heroes.h0.isChartering, true);
  });
});

test("a hero left flagged isChartering with no charter row behind it is unlocked by hydration, not left locked forever (C-BLOCKER-1)", async (t) => {
  // This is the state C-BLOCKER-1 measured (day 37 in the DB: `charters` still
  // says traveling, the client hydrated activeCharters: []): nothing can ever
  // advance or complete that charter, so the flag is bookkeeping with no
  // backing fact. Left alone the hero can never be selected again
  // (turnController.selectHero bails on isChartering) and starves.
  t.mock.method(console, "warn", () => {});
  await withRollback(async (client) => {
    const name = uniqueName();
    const heroes: Record<HeroId, HeroState> = {
      h0: makeHero("h0", 0, 12, 7, { isChartering: true, charterId: "ch0" }),
    };
    const settlements: Record<SettlementId, SettlementState> = { s0: makeSettlement("s0", 0, 4, 2) };
    await seedLegacyGame(client, name, heroes, settlements);
    await createHeroRepo(client).upsertMany(name, heroes);
    await createSettlementRepo(client).upsertMany(name, settlements);
    // Note the absence: no charterRepo row for ch0.

    const hydrated = await hydrateGame(client, name);
    assert.equal(hydrated.source, "granular");
    assert.deepEqual(hydrated.state.activeCharters, []);
    assert.equal(hydrated.state.heroes.h0.isChartering, false, "the orphaned flag is cleared");
    assert.equal(hydrated.state.heroes.h0.charterId, null);

    // The JSONB fallback path (which can never see the charters table at all)
    // must reach the same conclusion.
    const held = await createHeroRepo(client).loadAllForGame(name);
    assert.equal(held[0].isChartering, true, "the hero row itself still carries the flag");
    const row = await createGameRepo(client).load(name);
    const viaJsonb = hydrateGameState({ ...row, heroes: { h0: held[0] } });
    assert.equal(viaJsonb.heroes.h0.isChartering, false);
    assert.equal(viaJsonb.heroes.h0.charterId, null);
  });
});

// ---------------------------------------------------------------------------
// M-MAJOR-2: `games.settlements` JSONB must be a fixed point across a save +
// reload. The read path is granular (settlementRepo) while the write path is
// the JSONB column, so hydrate -> persist -> hydrate -> persist has to converge:
// otherwise every combat save rewrites the column into a slightly different
// shape, which is what the playthrough measured by comparing the column before
// the fight and after the reload.
// ---------------------------------------------------------------------------

async function readSettlementsJsonb(client: PoolClient, name: string): Promise<unknown> {
  const r = await client.query<{ settlements: unknown }>("SELECT settlements FROM games WHERE name = $1", [name]);
  return r.rows[0].settlements;
}

test("games.settlements JSONB is byte-identical across a save + reload cycle (M-MAJOR-2)", async () => {
  // The real creation payload: seeded buildings, districts, garrisons, spots and
  // rates -- the shapes the reporter's game actually carried into the fight.
  const payload = makeInitialStatePayload(new GameMap(424242, "small"), mulberry32(424242), {
    castleSeed: 424242,
    enemyCount: 0,
    humanSeatCount: 1,
  });

  await withRollback(async (client) => {
    const name = uniqueName();
    await seedLegacyGame(client, name, payload.heroes, payload.settlements);
    await createHeroRepo(client).upsertMany(name, payload.heroes);
    await createSettlementRepo(client).upsertMany(name, payload.settlements);

    // Cycle 1: hydrate (granular) and persist -- exactly what a combat command
    // does to the row.
    const first = await hydrateGame(client, name);
    assert.equal(first.source, "granular");
    await createGameRepo(client).saveHeroesAndSettlements(name, first.state.heroes, first.state.settlements);
    const afterFirstSave = await readSettlementsJsonb(client, name);

    // Cycle 2: reload what cycle 1 wrote and persist again.
    const second = await hydrateGame(client, name);
    await createGameRepo(client).saveHeroesAndSettlements(name, second.state.heroes, second.state.settlements);
    const afterSecondSave = await readSettlementsJsonb(client, name);

    assert.deepEqual(
      afterSecondSave,
      afterFirstSave,
      "the settlements JSONB must not drift between a save and the next reload",
    );
  });
});

test("a combat save that touches no settlement leaves games.settlements JSONB byte-identical (M-MAJOR-2)", async () => {
  // The reporter's own comparison: the column before the fight vs after the
  // reload. Before this fix the combat persist rewrote the column from the
  // GRANULAR read path, whose shape is normalized on the way in -- a settlement
  // the fight never touched came back with its platoon array padded to
  // ARMY_STACK_SLOTS, so the two reads of the column disagreed.
  const payload = makeInitialStatePayload(new GameMap(424242, "small"), mulberry32(424242), {
    castleSeed: 424242,
    enemyCount: 0,
    humanSeatCount: 1,
  });
  const id = Object.keys(payload.settlements)[0];

  await withRollback(async (client) => {
    const name = uniqueName();
    await seedLegacyGame(client, name, payload.heroes, payload.settlements);

    // A garrison in the column that the granular read path will normalize: a
    // four-slot platoon array (the padding to 8 happens inside hydrate).
    const column = {
      ...payload.settlements,
      [id]: {
        ...payload.settlements[id],
        stacks: [
          { entries: [{ unitTypeId: "swordsman", count: 3 }] },
          { entries: [] },
          { entries: [] },
          { entries: [] },
        ],
      },
    };
    await client.query("UPDATE games SET settlements = $1::jsonb WHERE name = $2", [JSON.stringify(column), name]);
    const beforeCombat = await readSettlementsJsonb(client, name);
    assert.equal(
      ((beforeCombat as Record<string, { stacks: unknown[] }>)[id].stacks ?? []).length,
      4,
      "the column starts with a four-slot platoon array",
    );

    await createHeroRepo(client).upsertMany(name, payload.heroes);
    await createSettlementRepo(client).upsertMany(name, column);

    // The combat: the hero record changes, the settlement record does not (the
    // handler signals that with reference equality -> skipSettlements).
    const hydrated = await hydrateGame(client, name);
    assert.equal(hydrated.source, "granular");
    const heroId = Object.keys(hydrated.state.heroes)[0];
    const afterCombat = {
      ...hydrated.state.heroes,
      [heroId]: { ...hydrated.state.heroes[heroId], gold: 123 },
    };
    await createGameRepo(client).saveHeroesAndSettlements(name, afterCombat, hydrated.state.settlements, {
      skipSettlements: true,
    });

    const afterCombatColumn = await readSettlementsJsonb(client, name);
    assert.deepEqual(
      afterCombatColumn,
      beforeCombat,
      "games.settlements JSONB equality across the combat save",
    );

    // And a reload of that row still describes the same settlements.
    const reloaded = await hydrateGame(client, name);
    assert.equal(reloaded.state.settlements[id].name, column[id].name);
    assert.deepEqual(reloaded.state.settlements[id].buildings, column[id].buildings);
  });
});

test("the settlements JSONB a hydrate+persist cycle writes still describes the same settlements", async () => {
  const payload = makeInitialStatePayload(new GameMap(424242, "small"), mulberry32(424242), {
    castleSeed: 424242,
    enemyCount: 0,
    humanSeatCount: 1,
  });

  await withRollback(async (client) => {
    const name = uniqueName();
    await seedLegacyGame(client, name, payload.heroes, payload.settlements);
    await createHeroRepo(client).upsertMany(name, payload.heroes);
    await createSettlementRepo(client).upsertMany(name, payload.settlements);

    const hydrated = await hydrateGame(client, name);
    await createGameRepo(client).saveHeroesAndSettlements(name, hydrated.state.heroes, hydrated.state.settlements);

    const reloaded = await hydrateGame(client, name);
    // Load-bearing fields survive the round trip: identity, position, owner,
    // level, and the built city (a starter set must not be lost by a save).
    for (const [id, before] of Object.entries(hydrated.state.settlements)) {
      const after = reloaded.state.settlements[id];
      assert.ok(after, `settlement ${id} survived the save + reload`);
      assert.equal(after.name, before.name);
      assert.equal(after.ownerId, before.ownerId);
      assert.equal(after.q, before.q);
      assert.equal(after.r, before.r);
      assert.equal(after.level, before.level);
      assert.equal(after.population, before.population);
      assert.equal(after.goldTax, before.goldTax);
      assert.equal(after.gold, before.gold);
      assert.equal(after.morale, before.morale);
      assert.deepEqual(after.warehouse, before.warehouse);
      assert.deepEqual(after.buildings, before.buildings, `settlement ${id}: buildings survive byte-for-byte`);
      assert.deepEqual(after.citySpots, before.citySpots, `settlement ${id}: city spots survive`);
    }
  });
});
