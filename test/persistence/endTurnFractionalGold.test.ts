import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { PoolClient } from "pg";
import type { Player, SettlementState } from "@heroes/contracts";
import { pool } from "../../server/persistence/db";
import { createGameRepo } from "../../server/persistence/repositories/gameRepo";
import { withRollback } from "../helpers/pgTestTx";
import { handleCommandTransactional, createLiveCommandDeps } from "../../server/app/commandHandler";
import { makeHero, makeSettlement } from "../charter/_helpers";

// End-to-end proof that EndTurn survives a game whose gold is fractional.
//
// The bug: `games.gold` (and every other numeric game column) is INTEGER, but
// gold in the engine is deliberately a 2-decimal float. One food-producing
// settlement is enough -- producerTurnOutput rounds a farmField's yield to
// hundredths, runAutoTrade pays that fractional food amount out of a treasury,
// and the legacy games.gold total becomes fractional. Postgres then rejects the
// whole statement ("invalid input syntax for type integer"), the command's
// transaction rolls back, and EVERY EndTurn returns HTTP 500.
//
// This drives the real command against a real row (not the repo mocks every
// other commandHandler test uses) because the failure lives in the SQL type
// layer, which no in-memory double can reproduce.

after(() => pool.end());

const HOUSE_A = { gx: 2, gy: 1, kind: "house", level: 1, style: "classic" };
const HOUSE_B = { gx: 3, gy: 1, kind: "house", level: 1, style: "classic" };
const GOLD_MINE = { gx: 1, gy: 1, kind: "goldMine", level: 1, style: "classic" };

const PLAYERS: Player[] = [
  { id: 0, faction: "player", name: "Player 1", color: "#ff0000", heroIds: ["h0"], settlementIds: ["s0", "s1"] },
];

function uniqueName(): string {
  return `test-frac-gold-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function seedGame(
  db: Pick<PoolClient, "query">,
  name: string,
  settlements: Record<string, SettlementState>,
): Promise<void> {
  await db.query(
    `INSERT INTO games (name, seed, hero_q, hero_r, round, day, active_player_id,
                        players, heroes, settlements, map_size)
     VALUES ($1, 4242, 0, 0, 1, 1, 0, $2::jsonb, $3::jsonb, $4::jsonb, 'standard')`,
    [
      name,
      JSON.stringify(PLAYERS),
      JSON.stringify({ h0: makeHero("h0", 0, 5, 5, { gold: 500 }) }),
      JSON.stringify(settlements),
    ],
  );
}

function warehouse(o: Partial<SettlementState["warehouse"]>): SettlementState["warehouse"] {
  return { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0, ...o };
}

// A game whose numeric state is fractional in EVERY column shape EndTurn writes,
// deterministically (seeded from literal values rather than from a producer's
// randomised cellMultiplier, so the fixture cannot silently stop exercising the
// bug when the multiplier hash changes):
//
//   gold    500.55 -- a purse that already carries a fraction, which is exactly
//            what auto-trade leaves behind when it pays out a fractional food
//            amount, and what produceResources' round2 gold leaves behind after
//            a mine's hundredths-rounded yield.
//   food     6.45 with population 500, so the reservation leaves 1.45 of
//            tradeable surplus for the hungry neighbour.
//   morale   fractional: goldMine + two houses cost 3 wood, and s0 holds 1, so
//            suppliesDeficitRatio is (3-1)/3 and the decay is 6.67, not a whole
//            number -- applyMoraleDecay rounds that to 7, so morale lands at 93.
//
// s1 is a 5000-population town with an empty larder: a 50-unit deficit that no
// surplus can cover, so s0 exports everything it is allowed to.
function fractionalGoldPair(): Record<string, SettlementState> {
  return {
    s0: makeSettlement("s0", 0, 2, 2, {
      population: 500,
      goldTax: 1,
      gold: 500.55,
      warehouse: warehouse({ wood: 1, stone: 2, food: 6.45 }),
      buildings: [
        GOLD_MINE as SettlementState["buildings"][number],
        HOUSE_A as SettlementState["buildings"][number],
        HOUSE_B as SettlementState["buildings"][number],
      ],
    }),
    s1: makeSettlement("s1", 0, 8, 8, { population: 5000, goldTax: 1, gold: 500, warehouse: warehouse({}) }),
  };
}

test("saveHeroesAndSettlements coerces the fractional legacy gold total at the column boundary", async () => {
  // The exact shape of the original failure, one layer up: 4171.6 is the value
  // Postgres rejected with `invalid input syntax for type integer`, handed here
  // by sumPlayerGold's unrounded sum of hero + settlement purses.
  await withRollback(async (client) => {
    const name = uniqueName();
    await seedGame(client, name, {});
    const repo = createGameRepo(client);

    await repo.saveHeroesAndSettlements(name, {}, {}, { gold: 4171.6 });

    const row = await repo.load(name);
    assert.equal(row.gold, 4172);
  });
});

test("saveHeroesAndSettlements leaves an integral gold total untouched", async () => {
  await withRollback(async (client) => {
    const name = uniqueName();
    await seedGame(client, name, {});
    const repo = createGameRepo(client);

    await repo.saveHeroesAndSettlements(name, {}, {}, { gold: 4171 });

    const row = await repo.load(name);
    assert.equal(row.gold, 4171);
  });
});

test("EndTurn no longer aborts when a settlement's purse is fractional", async () => {
  const name = uniqueName();
  await seedGame(pool, name, fractionalGoldPair());
  try {
    const deps = await createLiveCommandDeps();

    const first = await handleCommandTransactional({ kind: "EndTurn", gameName: name, actor: 0 }, deps);
    assert.equal(first.ok, true, `turn 1 rejected: ${first.reason}`);

    // The scenario must genuinely be fractional after turn 1, or this test
    // silently stops covering the bug. games.settlements JSONB keeps full
    // precision, so this is where the fraction is still visible after the
    // INTEGER columns rounded it. (Checked after ONE turn deliberately: the
    // treasury cap pins a full purse to exactly 1500 by turn 3, which is an
    // integer.)
    const row = await pool.query<{
      gold: number;
      settlements: Record<string, SettlementState>;
      heroes: Record<string, { gold: number }>;
    }>(`SELECT gold, settlements, heroes FROM games WHERE name = $1`, [name]);
    const fractionalGold = [
      ...Object.values(row.rows[0].settlements).map((s) => s.gold),
      ...Object.values(row.rows[0].heroes).map((h) => h.gold),
    ].filter((g) => Number.isFinite(g) && !Number.isInteger(g));
    assert.ok(
      fractionalGold.length > 0,
      "no fractional gold reached persistence -- the fixture stopped exercising the bug",
    );
    const fractionalMorale = Object.values(row.rows[0].settlements)
      .map((s) => s.morale)
      .filter((m) => Number.isFinite(m) && !Number.isInteger(m));
    assert.deepEqual(
      fractionalMorale,
      [],
      "morale is rounded at the engine write (applyMoraleDecay), so it never reaches persistence fractional",
    );
    assert.ok(Number.isInteger(row.rows[0].gold), "games.gold must be an integer");
    assert.equal(row.rows[0].gold, Math.round(row.rows[0].gold));

    // Repeated turns must keep working -- the original failure aborted every one.
    // Single-player game, so each turn end also wraps the round.
    let previousRound = first.round;
    for (let turn = 2; turn <= 4; turn++) {
      const result = await handleCommandTransactional({ kind: "EndTurn", gameName: name, actor: 0 }, deps);
      assert.equal(result.ok, true, `turn ${turn} rejected: ${result.reason}`);
      assert.equal(result.round, previousRound + 1, `turn ${turn} did not advance the round`);
      previousRound = result.round;
    }
  } finally {
    await pool.query(`DELETE FROM games WHERE name = $1`, [name]);
  }
});

test("EndTurn leaves every INTEGER game column holding an integer", async () => {
  // Rounding is enforced at the write boundary, so this walks every INTEGER
  // column EndTurn touches -- the JSONB write, the granular mirror dual-write,
  // and the two #89 tables. Rounding only games.gold moved the 500 one statement
  // later: settlementRepo.upsertMany, then settlement_snapshots /
  // resource_transactions.
  const name = uniqueName();
  await seedGame(pool, name, fractionalGoldPair());
  try {
    const deps = await createLiveCommandDeps();
    const result = await handleCommandTransactional({ kind: "EndTurn", gameName: name, actor: 0 }, deps);
    assert.equal(result.ok, true);

    const id = (await pool.query<{ id: number }>(`SELECT id FROM games WHERE name = $1`, [name])).rows[0].id;

    const settlements = await pool.query<{ gold: number; morale: number }>(
      `SELECT gold, morale FROM settlements WHERE game_id = $1`,
      [id],
    );
    assert.ok(settlements.rows.length > 0, "granular mirror empty -- the dual-write never ran");
    for (const s of settlements.rows) {
      assert.ok(Number.isInteger(s.gold), `settlements.gold = ${s.gold}`);
      assert.ok(Number.isInteger(s.morale), `settlements.morale = ${s.morale}`);
    }

    const resources = await pool.query<{ amount: number }>(
      `SELECT amount FROM settlement_resources WHERE game_id = $1`,
      [id],
    );
    for (const r of resources.rows) {
      assert.ok(Number.isInteger(r.amount), `settlement_resources.amount = ${r.amount}`);
    }

    const snapshots = await pool.query<{ gold: number; morale: number; effective_income: number }>(
      `SELECT gold, morale, effective_income FROM settlement_snapshots WHERE game_id = $1`,
      [id],
    );
    assert.ok(snapshots.rows.length > 0, "no snapshot rows -- the insert never ran");
    for (const s of snapshots.rows) {
      assert.ok(Number.isInteger(s.gold), `settlement_snapshots.gold = ${s.gold}`);
      assert.ok(Number.isInteger(s.morale), `settlement_snapshots.morale = ${s.morale}`);
      assert.ok(Number.isInteger(s.effective_income), `settlement_snapshots.effective_income = ${s.effective_income}`);
    }

    const txns = await pool.query<{ amount: number; gold_paid: number }>(
      `SELECT amount, gold_paid FROM resource_transactions WHERE game_id = $1`,
      [id],
    );
    assert.ok(txns.rows.length > 0, "no auto-trade transfer rows -- the insert never ran");
    for (const t of txns.rows) {
      assert.ok(Number.isInteger(t.amount), `resource_transactions.amount = ${t.amount}`);
      assert.ok(Number.isInteger(t.gold_paid), `resource_transactions.gold_paid = ${t.gold_paid}`);
    }
  } finally {
    await pool.query(`DELETE FROM games WHERE name = $1`, [name]);
  }
});