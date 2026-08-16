import { test } from "node:test";
import assert from "node:assert/strict";
import type { PoolClient } from "pg";
import { withRollback } from "../helpers/pgTestTx";
import { createGameRepo, GameNotFoundError } from "../../server/persistence/repositories/gameRepo";
import { makeHero, makePlayer, makeSettlement } from "../charter/_helpers";

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
