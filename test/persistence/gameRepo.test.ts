import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { PoolClient } from "pg";
import { withRollback } from "../helpers/pgTestTx";
import { pool } from "../../server/persistence/db";
import { createGameRepo, GameNotFoundError } from "../../server/persistence/repositories/gameRepo";
import { emptyWarehouse, makeHero, makePlayer, makeSettlement, makeTradeRoute } from "../charter/_helpers";

// withRollback pulls in the shared pg pool; close it once this file's tests
// are done so node:test's process can exit promptly instead of waiting out
// the pool's idle timeout.
after(() => pool.end());

async function seedGame(client: PoolClient, name: string): Promise<number> {
  const r = await client.query(
    `INSERT INTO games (name, seed, hero_q, hero_r) VALUES ($1, $2, $3, $4) RETURNING id`,
    [name, 1, 0, 0],
  );
  return r.rows[0].id as number;
}

function uniqueName(): string {
  return `test-game-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

test("gameRepo.load returns the full row for an existing game", async () => {
  await withRollback(async (client) => {
    const name = uniqueName();
    await seedGame(client, name);
    const repo = createGameRepo(client);

    const row = await repo.load(name);

    assert.equal(row.name, name);
    assert.deepEqual(row.heroes, {});
    assert.deepEqual(row.settlements, {});
  });
});

test("gameRepo.load throws GameNotFoundError for a missing game", async () => {
  await withRollback(async (client) => {
    const repo = createGameRepo(client);

    await assert.rejects(() => repo.load("does-not-exist"), GameNotFoundError);
  });
});

test("gameRepo.saveHeroesAndSettlements persists heroes and settlements", async () => {
  await withRollback(async (client) => {
    const name = uniqueName();
    await seedGame(client, name);
    const repo = createGameRepo(client);
    const hero = makeHero("h0", 0, 3, 4);
    const settlement = makeSettlement("s0", 0, 3, 4);

    await repo.saveHeroesAndSettlements(name, { h0: hero }, { s0: settlement });
    const row = await repo.load(name);

    assert.deepEqual(row.heroes, { h0: hero });
    assert.deepEqual(row.settlements, { s0: settlement });
  });
});

test("gameRepo.saveHeroesAndSettlements round-trips trade-route ownerId through the trade_routes JSONB", async () => {
  // Logistics interface fixes §5.1/§5.7: routes are persisted whole (this
  // extra field), so a stamped ownerId must come back verbatim -- both the
  // present-number shape createTradeRoute writes and the explicit null a
  // dead-both-ends hydration backfills. The engine-side hydrate pins live
  // in test/engine/logistics.test.ts; this is the storage half of the
  // round trip.
  await withRollback(async (client) => {
    const name = uniqueName();
    await seedGame(client, name);
    const repo = createGameRepo(client);
    const stamped = makeTradeRoute({
      id: "route0",
      from: { kind: "settlement", id: "s0" },
      to: { kind: "settlement", id: "s1" },
      payload: { kind: "resource", resource: "wood" },
      ownerId: 0,
    });
    const ownerless = makeTradeRoute({
      id: "route1",
      from: { kind: "settlement", id: "s0" },
      to: { kind: "hero", id: "h0" },
      payload: { kind: "gold" },
      wagons: 1,
      ownerId: null,
    });

    await repo.saveHeroesAndSettlements(name, {}, {}, { trade_routes: [stamped, ownerless] });
    const row = await repo.load(name);

    assert.deepEqual(row.trade_routes, [stamped, ownerless], "ownerId survives the JSONB round trip verbatim");
  });
});

test("gameRepo.saveHeroesAndSettlements optionally updates players and gold", async () => {
  await withRollback(async (client) => {
    const name = uniqueName();
    await seedGame(client, name);
    const repo = createGameRepo(client);
    const players = [makePlayer(0, "player", ["h0"], ["s0"])];

    await repo.saveHeroesAndSettlements(name, {}, {}, { players, gold: 42 });
    const row = await repo.load(name);

    assert.deepEqual(row.players, players);
    assert.equal(row.gold, 42);
  });
});

test("gameRepo.saveHeroesAndSettlements round-trips a fractional gold total at full precision", async () => {
  // Migration 027 made games.gold NUMERIC, so the sumPlayerGold total keeps
  // its fraction end to end -- the old INTEGER column rejected 4171.6
  // outright, and its interim Math.round fix persisted 4172 instead.
  await withRollback(async (client) => {
    const name = uniqueName();
    await seedGame(client, name);
    const repo = createGameRepo(client);
    const players = [makePlayer(0, "player", ["h0"], ["s0"])];

    await repo.saveHeroesAndSettlements(name, {}, {}, { players, gold: 4171.6 });
    const row = await repo.load(name);

    assert.equal(row.gold, 4171.6);
  });
});

test("gameRepo.saveHeroesAndSettlements leaves players/gold untouched when extra is omitted", async () => {
  await withRollback(async (client) => {
    const name = uniqueName();
    await seedGame(client, name);
    const repo = createGameRepo(client);
    const players = [makePlayer(0, "player", ["h0"], ["s0"])];
    await repo.saveHeroesAndSettlements(name, {}, {}, { players, gold: 42 });

    await repo.saveHeroesAndSettlements(name, { h0: makeHero("h0", 0, 1, 1) }, {});
    const row = await repo.load(name);

    assert.deepEqual(row.players, players);
    assert.equal(row.gold, 42);
  });
});

test("gameRepo.saveHeroesAndSettlements throws GameNotFoundError for a missing game", async () => {
  await withRollback(async (client) => {
    const repo = createGameRepo(client);

    await assert.rejects(
      () => repo.saveHeroesAndSettlements("does-not-exist", {}, {}),
      GameNotFoundError,
    );
  });
});

// Coverage for #89: EndTurn's port stopped writing these two tables, since
// commandHandler.ts's EndTurn case only calls saveHeroesAndSettlements/
// eventRepo.append today. These tests cover the repo methods that restore
// the write path (server-side wiring into EndTurn itself is tracked
// separately in #89, not part of this repo-layer change).

test("gameRepo.insertSettlementSnapshots writes one row per settlement", async () => {
  await withRollback(async (client) => {
    const name = uniqueName();
    const gameId = await seedGame(client, name);
    const repo = createGameRepo(client);

    await repo.insertSettlementSnapshots(name, [
      { settlementId: "s0", day: 3, gold: 120, warehouse: emptyWarehouse({ wood: 5 }), morale: 80, effectiveIncome: 40 },
      { settlementId: "s1", day: 3, gold: 60, warehouse: emptyWarehouse(), morale: 100, effectiveIncome: 10 },
    ]);

    const r = await client.query(
      `SELECT settlement_id, day, gold, warehouse, morale, effective_income
       FROM settlement_snapshots WHERE game_id = $1 ORDER BY settlement_id ASC`,
      [gameId],
    );
    assert.equal(r.rowCount, 2);
    assert.equal(r.rows[0].settlement_id, "s0");
    assert.equal(r.rows[0].gold, 120);
    assert.deepEqual(r.rows[0].warehouse, emptyWarehouse({ wood: 5 }));
    assert.equal(r.rows[0].morale, 80);
    assert.equal(r.rows[0].effective_income, 40);
  });
});

test("gameRepo.insertSettlementSnapshots is idempotent for the same game/settlement/day", async () => {
  await withRollback(async (client) => {
    const name = uniqueName();
    const gameId = await seedGame(client, name);
    const repo = createGameRepo(client);
    const snapshot = { settlementId: "s0", day: 3, gold: 120, warehouse: emptyWarehouse(), morale: 80, effectiveIncome: 40 };

    await repo.insertSettlementSnapshots(name, [snapshot]);
    await repo.insertSettlementSnapshots(name, [{ ...snapshot, gold: 999 }]);

    const r = await client.query(
      `SELECT gold FROM settlement_snapshots WHERE game_id = $1 AND settlement_id = 's0' AND day = 3`,
      [gameId],
    );
    assert.equal(r.rowCount, 1);
    assert.equal(r.rows[0].gold, 120);
  });
});

test("gameRepo.insertSettlementSnapshots is a no-op for an empty array (doesn't throw for a missing game)", async () => {
  await withRollback(async (client) => {
    const repo = createGameRepo(client);
    await repo.insertSettlementSnapshots("does-not-exist", []);
  });
});

test("gameRepo.insertSettlementSnapshots throws GameNotFoundError for a missing game", async () => {
  await withRollback(async (client) => {
    const repo = createGameRepo(client);

    await assert.rejects(
      () => repo.insertSettlementSnapshots("does-not-exist", [
        { settlementId: "s0", day: 1, gold: 0, warehouse: emptyWarehouse(), morale: 100, effectiveIncome: 0 },
      ]),
      GameNotFoundError,
    );
  });
});

test("gameRepo.insertSettlementSnapshots round-trips fractional gold/morale/effective_income at full precision", async () => {
  // Migration 027 made all three snapshot columns NUMERIC: a fractional
  // snapshot (what auto-trade + a hundredths-rounded producer output leave
  // behind) comes back exactly instead of losing up to half a coin per
  // quantity per save.
  await withRollback(async (client) => {
    const name = uniqueName();
    const gameId = await seedGame(client, name);
    const repo = createGameRepo(client);

    await repo.insertSettlementSnapshots(name, [
      { settlementId: "s0", day: 3, gold: 120.5, warehouse: emptyWarehouse({ food: 6.45 }), morale: 80.25, effectiveIncome: 40.75 },
    ]);

    const r = await client.query(
      `SELECT gold, warehouse, morale, effective_income
       FROM settlement_snapshots WHERE game_id = $1 AND settlement_id = 's0' AND day = 3`,
      [gameId],
    );
    assert.equal(r.rowCount, 1);
    assert.equal(r.rows[0].gold, 120.5);
    assert.equal(r.rows[0].morale, 80.25);
    assert.equal(r.rows[0].effective_income, 40.75);
  });
});

test("gameRepo.insertResourceTransactions writes one row per transfer", async () => {
  await withRollback(async (client) => {
    const name = uniqueName();
    const gameId = await seedGame(client, name);
    const repo = createGameRepo(client);

    await repo.insertResourceTransactions(name, [
      { fromSettlementId: "s0", toSettlementId: "s1", resource: "wood", amount: 10, goldPaid: 5 },
    ]);

    const r = await client.query(
      `SELECT from_settlement_id, to_settlement_id, resource, amount, gold_paid, reason
       FROM resource_transactions WHERE game_id = $1`,
      [gameId],
    );
    assert.equal(r.rowCount, 1);
    assert.equal(r.rows[0].from_settlement_id, "s0");
    assert.equal(r.rows[0].to_settlement_id, "s1");
    assert.equal(r.rows[0].resource, "wood");
    assert.equal(r.rows[0].amount, 10);
    assert.equal(r.rows[0].gold_paid, 5);
    assert.equal(r.rows[0].reason, "auto_trade");
  });
});

test("gameRepo.insertResourceTransactions round-trips fractional amount/gold_paid at full precision", async () => {
  // Migration 027: runAutoTrade pays a fractional food amount out of a
  // fractional treasury, and both sides of the row keep the fraction now.
  await withRollback(async (client) => {
    const name = uniqueName();
    const gameId = await seedGame(client, name);
    const repo = createGameRepo(client);

    await repo.insertResourceTransactions(name, [
      { fromSettlementId: "s0", toSettlementId: "s1", resource: "food", amount: 1.45, goldPaid: 0.55 },
    ]);

    const r = await client.query(
      `SELECT amount, gold_paid FROM resource_transactions WHERE game_id = $1`,
      [gameId],
    );
    assert.equal(r.rowCount, 1);
    assert.equal(r.rows[0].amount, 1.45);
    assert.equal(r.rows[0].gold_paid, 0.55);
  });
});

test("gameRepo.insertResourceTransactions is a no-op for an empty array (doesn't throw for a missing game)", async () => {
  await withRollback(async (client) => {
    const repo = createGameRepo(client);
    await repo.insertResourceTransactions("does-not-exist", []);
  });
});

test("gameRepo.insertResourceTransactions throws GameNotFoundError for a missing game", async () => {
  await withRollback(async (client) => {
    const repo = createGameRepo(client);

    await assert.rejects(
      () => repo.insertResourceTransactions("does-not-exist", [
        { fromSettlementId: "s0", toSettlementId: "s1", resource: "wood", amount: 1, goldPaid: 1 },
      ]),
      GameNotFoundError,
    );
  });
});
