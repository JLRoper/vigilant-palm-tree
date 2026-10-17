import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { PoolClient } from "pg";
import type { Player, SettlementState } from "@heroes/contracts";
import { pool } from "../../server/persistence/db";
import { createGameRepo } from "../../server/persistence/repositories/gameRepo";
import { withRollback } from "../helpers/pgTestTx";
import { handleCommandTransactional, createLiveCommandDeps } from "../../server/app/commandHandler";
import { makeHero, makeSettlement } from "../charter/_helpers";

// End-to-end proof that EndTurn stores WHOLE-INTEGER gold and warehouse
// amounts, and that games.gold still equals the recomputed sum exactly.
//
// History: `games.gold` (and every other numeric game column) used to be
// INTEGER, while gold in the engine was a 2-decimal float. One food-producing
// settlement was enough -- producerTurnOutput rounds a farmField's yield to
// hundredths -- to make the legacy games.gold total fractional, which
// Postgres rejected outright ("invalid input syntax for type integer") and
// turned every EndTurn into an HTTP 500. Migration 027_numeric_columns.sql
// widened every numeric game column to NUMERIC (with the OID-1700 parser in
// server/persistence/pgTypes.ts) so the storage layer round-trips any value
// at full precision.
//
// The engine economy layer now rounds everything it WRITES BACK to state --
// settlement treasuries (applyEffectiveIncome, produceSettlementResources)
// and warehouse stock (produceSettlementResources, applySettlementConsumption)
// -- to whole numbers via Math.round (exact half-up for this economy's
// non-negative values) BEFORE it reaches persistence. Producer yields, cell
// multipliers, and per-turn display rates stay 2-decimal floats internally;
// only the accumulated stock/purse/treasury is rounded at the write point.
// The NUMERIC columns remain full-precision/identity (server/persistence is
// untouched) -- the rounding is the ENGINE's, not the persistence boundary's.
//
// What this suite now proves: a fractional seed or a fractional producer
// yield never persists fractional. After EndTurn every settlement gold and
// warehouse amount is a whole integer (granular mirrors and JSONB source
// alike), and games.gold equals the same-order recomputed sum with STRICT
// equality.
//
// These tests drive the real command against a real row (not the repo mocks
// every other commandHandler test uses) because the old failure lived in the
// SQL type layer, which no in-memory double can reproduce.

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
  lobby?: Record<string, unknown>,
): Promise<void> {
  await db.query(
    `INSERT INTO games (name, seed, hero_q, hero_r, round, day, active_player_id,
                        players, heroes, settlements, map_size, lobby)
     VALUES ($1, 4242, 0, 0, 1, 1, 0, $2::jsonb, $3::jsonb, $4::jsonb, 'standard',
             $5::jsonb)`,
    [
      name,
      JSON.stringify(PLAYERS),
      JSON.stringify({ h0: makeHero("h0", 0, 5, 5, { gold: 500 }) }),
      JSON.stringify(settlements),
      JSON.stringify(lobby ?? {}),
    ],
  );
}

function warehouse(o: Partial<SettlementState["warehouse"]>): SettlementState["warehouse"] {
  return { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0, ...o };
}

// A game whose numeric state is fractional in the SEED so EndTurn exercises the
// rounding path, deterministically (seeded from literal values rather than from
// a producer's randomised cellMultiplier, so the fixture cannot silently stop
// exercising the rounding when the multiplier hash changes):
//
//   gold    500.55 -- a fractional treasury seed. produceSettlementResources
//            writes the treasury as Math.round(purse + producer yield), so the
//            half coin is rounded away at the engine write and the purse
//            persists as a whole integer.
//   food     6.45 with population 500: foodRequired is 5, so the pre-
//            consumption surplus is 1.45. The unchanged auto-trade layer moves
//            that fractional surplus (resource_transactions.amount carries the
//            float artifact -- trade.ts is out of the rounding scope), but the
//            warehouse food the engine next WRITES is rounded: consumption's
//            clampWarehouseNonNegative half-up rounds every remaining food to a
//            whole integer.
//   iron     3 -- the warehouse values the engine writes are whole integers.
//            Iron/arcane are never written by produceSettlementResources or
//            applySettlementConsumption (consumption clamps only food/wood/
//            stone), so unlike the old suite this fixture seeds iron WHOLE:
//            a fractional iron seed would survive untouched and contradict the
//            whole-integer contract this suite now pins.
//   morale   fractional: goldMine + two houses cost 3 wood, and s0 holds 1, so
//            suppliesDeficitRatio is (3-1)/3 and the decay is 6.67, not a whole
//            number -- applyMoraleDecay rounds that to 7, so morale lands at 93.
//
// s1 is a 5000-population town with an empty larder: a 50-unit deficit that no
// surplus can cover, so auto-trade drains s0's fractional food surplus.
function fractionalGoldPair(): Record<string, SettlementState> {
  return {
    s0: makeSettlement("s0", 0, 2, 2, {
      population: 500,
      goldTax: 1,
      gold: 500.55,
      warehouse: warehouse({ wood: 1, stone: 2, iron: 3, food: 6.45 }),
      buildings: [
        GOLD_MINE as SettlementState["buildings"][number],
        HOUSE_A as SettlementState["buildings"][number],
        HOUSE_B as SettlementState["buildings"][number],
      ],
    }),
    s1: makeSettlement("s1", 0, 8, 8, { population: 5000, goldTax: 1, gold: 500, warehouse: warehouse({}) }),
  };
}

// Mirrors commandHandler.ts's sumPlayerGold exactly (heroes first, then
// settlements, filtered by the row's player ids) so the recomputed total can
// be pinned against the persisted games.gold with STRICT equality -- the
// full-precision claim, not a tolerance.
function recomputeLegacyGold(
  row: {
    players: Array<{ id: number }>;
    heroes: Record<string, { ownerId: number; gold: number }>;
    settlements: Record<string, { ownerId: number | null; gold: number }>;
  },
): number {
  const playerIds = new Set(row.players.map((p) => p.id));
  let total = 0;
  for (const h of Object.values(row.heroes)) {
    if (playerIds.has(h.ownerId) && Number.isFinite(h.gold)) total += h.gold;
  }
  for (const s of Object.values(row.settlements)) {
    if (s.ownerId !== null && playerIds.has(s.ownerId) && Number.isFinite(s.gold)) total += s.gold;
  }
  return total;
}

test("saveHeroesAndSettlements round-trips a fractional legacy gold total at full precision", async () => {
  // The exact shape of the original failure, one layer up: 4171.6 is the value
  // Postgres rejected with `invalid input syntax for type integer`, handed here
  // by sumPlayerGold's unrounded sum of hero + settlement purses. It must come
  // back EXACTLY -- the old INTEGER column rejected it outright, and the
  // interim Math.round fix persisted 4172 instead.
  await withRollback(async (client) => {
    const name = uniqueName();
    await seedGame(client, name, {});
    const repo = createGameRepo(client);

    await repo.saveHeroesAndSettlements(name, {}, {}, { gold: 4171.6 });

    const row = await repo.load(name);
    assert.equal(row.gold, 4171.6);
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

test("EndTurn rounds a fractional settlement purse to a whole integer", async () => {
  const name = uniqueName();
  await seedGame(pool, name, fractionalGoldPair());
  try {
    const deps = await createLiveCommandDeps();

    const first = await handleCommandTransactional({ kind: "EndTurn", gameName: name, actor: 0 }, deps);
    assert.equal(first.ok, true, `turn 1 rejected: ${first.reason}`);

    // The scenario must genuinely have STARTED fractional, or this test
    // silently stops exercising the rounding path. A purse seeded at 500.55
    // is read back whole only because produceSettlementResources rounds the
    // treasury write -- so the assertion the old suite made ("fractional
    // gold reached persistence") is now inverted: NO gold may reach
    // persistence fractional.
    const row = await pool.query<{
      gold: number;
      settlements: Record<string, SettlementState>;
      heroes: Record<string, { ownerId: number; gold: number }>;
      players: Array<{ id: number }>;
    }>(`SELECT gold, settlements, heroes, players FROM games WHERE name = $1`, [name]);
    const fractionalGold = [
      ...Object.values(row.rows[0].settlements).map((s) => s.gold),
      ...Object.values(row.rows[0].heroes).map((h) => h.gold),
    ].filter((g) => Number.isFinite(g) && !Number.isInteger(g));
    assert.deepEqual(
      fractionalGold,
      [],
      "fractional gold reached persistence -- the engine must round every settlement purse to a whole integer before EndTurn writes it",
    );
    const fractionalMorale = Object.values(row.rows[0].settlements)
      .map((s) => s.morale)
      .filter((m) => Number.isFinite(m) && !Number.isInteger(m));
    assert.deepEqual(
      fractionalMorale,
      [],
      "morale is rounded at the engine write (applyMoraleDecay), so it never reaches persistence fractional",
    );
    // The engine-rounded total still equals the same-order recomputed sum --
    // strict equality, not a tolerance, keeps a hidden rounding shadow honest.
    assert.equal(row.rows[0].gold, recomputeLegacyGold(row.rows[0]));

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

test("EndTurn writes whole-integer gold and warehouse amounts, mirrored exactly by every granular table", async () => {
  // The inverted premise of the old "round-trips fractional at full
  // precision" pin: the engine now rounds every stored value to a whole
  // integer at the write point, and that rounded value is what must equal
  // both the JSONB source and every granular mirror EXACTLY -- the identity
  // persistence layer (NUMERIC + the OID-1700 parser) is unchanged, so no
  // rounding shadow may reappear between the engine write and the columns.
  const name = uniqueName();
  await seedGame(pool, name, fractionalGoldPair());
  try {
    const deps = await createLiveCommandDeps();
    const result = await handleCommandTransactional({ kind: "EndTurn", gameName: name, actor: 0 }, deps);
    assert.equal(result.ok, true);

    const id = (await pool.query<{ id: number }>(`SELECT id FROM games WHERE name = $1`, [name])).rows[0].id;

    const blob = (
      await pool.query<{
        settlements: Record<string, SettlementState>;
        heroes: Record<string, { gold: number; morale: number }>;
      }>(`SELECT settlements, heroes FROM games WHERE name = $1`, [name])
    ).rows[0];

    const settlements = await pool.query<{ id: string; gold: number; morale: number }>(
      `SELECT id, gold, morale FROM settlements WHERE game_id = $1`,
      [id],
    );
    assert.ok(settlements.rows.length > 0, "granular mirror empty -- the dual-write never ran");
    for (const s of settlements.rows) {
      const source = blob.settlements[s.id];
      assert.ok(source, `granular settlement ${s.id} missing from the JSONB source`);
      assert.equal(s.gold, source.gold, `settlements.gold for ${s.id} must equal the JSONB source exactly`);
      assert.equal(s.morale, source.morale, `settlements.morale for ${s.id} must equal the JSONB source exactly`);
      assert.ok(
        Number.isInteger(s.gold),
        `settlements.gold for ${s.id} must be a whole integer after the engine rounds the treasury write`,
      );
    }

    const resources = await pool.query<{ settlement_id: string; resource: string; amount: number }>(
      `SELECT settlement_id, resource, amount FROM settlement_resources WHERE game_id = $1`,
      [id],
    );
    for (const r of resources.rows) {
      const source = blob.settlements[r.settlement_id]?.warehouse[
        r.resource as keyof SettlementState["warehouse"]
      ];
      assert.equal(
        r.amount,
        source,
        `settlement_resources.amount ${r.settlement_id}.${r.resource} must equal the JSONB warehouse exactly`,
      );
      assert.ok(
        Number.isInteger(r.amount),
        `settlement_resources.amount ${r.settlement_id}.${r.resource} must be a whole integer after the engine rounds the warehouse write`,
      );
    }

    const heroRows = await pool.query<{ id: string; gold: number; morale: number }>(
      `SELECT id, gold, morale FROM heroes WHERE game_id = $1`,
      [id],
    );
    for (const h of heroRows.rows) {
      const source = blob.heroes[h.id];
      assert.ok(source, `granular hero ${h.id} missing from the JSONB source`);
      assert.equal(h.gold, source.gold, `heroes.gold for ${h.id} must equal the JSONB source exactly`);
      assert.equal(h.morale, source.morale, `heroes.morale for ${h.id} must equal the JSONB source exactly`);
    }

    const snapshots = await pool.query<{ gold: number; morale: number; effective_income: number }>(
      `SELECT gold, morale, effective_income FROM settlement_snapshots WHERE game_id = $1`,
      [id],
    );
    assert.ok(snapshots.rows.length > 0, "no snapshot rows -- the insert never ran");
    for (const s of snapshots.rows) {
      for (const v of [s.gold, s.morale, s.effective_income]) {
        assert.equal(typeof v, "number", `snapshot column must parse back as a number, got ${typeof v}`);
        assert.ok(Number.isFinite(v), `snapshot column must be finite, got ${v}`);
      }
    }

    const txns = await pool.query<{ amount: number; gold_paid: number }>(
      `SELECT amount, gold_paid FROM resource_transactions WHERE game_id = $1`,
      [id],
    );
    assert.ok(txns.rows.length > 0, "no auto-trade transfer rows -- the insert never ran");
    for (const t of txns.rows) {
      for (const v of [t.amount, t.gold_paid]) {
        assert.equal(typeof v, "number", `transaction column must parse back as a number, got ${typeof v}`);
        assert.ok(Number.isFinite(v), `transaction column must be finite, got ${v}`);
      }
    }
    // Auto-trade (trade.ts) is deliberately OUT of the engine-rounding scope
    // and runs on the PRE-consumption surplus, so it may still move s0's
    // fractional food seed (6.45 - 5 = 1.45) into resource_transactions. That
    // is an audit row, not a stored stock value -- the whole-integer contract
    // pins gold and warehouse amounts, which the assertions above check.
  } finally {
    await pool.query(`DELETE FROM games WHERE name = $1`, [name]);
  }
});
test("EndTurn with lobby.legacyAutoTrade false writes zero resource_transactions and still rounds the purse to a whole integer", async () => {
  // The gate variant: the same fractional fixture, but the game row carries the
  // new-game flag (lobby '{"legacyAutoTrade": false}'), so runAutoTrade moves
  // nothing and resource_transactions stays empty. The rounding coverage is
  // NOT lost with it: the gold mine's hundredths-rounded yield still feeds a
  // fractional treasury sum that the engine rounds to a whole integer in both
  // the settlements JSONB and the granular NUMERIC mirror, and every EndTurn
  // must still commit.
  const name = uniqueName();
  await seedGame(pool, name, fractionalGoldPair(), { legacyAutoTrade: false });
  try {
    const deps = await createLiveCommandDeps();
    for (let turn = 1; turn <= 2; turn++) {
      const result = await handleCommandTransactional({ kind: "EndTurn", gameName: name, actor: 0 }, deps);
      assert.equal(result.ok, true, `turn ${turn} rejected: ${result.reason}`);
    }

    const id = (await pool.query<{ id: number }>(`SELECT id FROM games WHERE name = $1`, [name])).rows[0].id;

    const txns = await pool.query<{ amount: number }>(
      `SELECT amount FROM resource_transactions WHERE game_id = $1`,
      [id],
    );
    assert.deepEqual(txns.rows, [], "a gated game must not write auto-trade rows");

    const [blob, settlements] = await Promise.all([
      pool.query<{ settlements: Record<string, SettlementState> }>(
        `SELECT settlements FROM games WHERE name = $1`,
        [name],
      ),
      pool.query<{ id: string; gold: number; morale: number }>(
        `SELECT id, gold, morale FROM settlements WHERE game_id = $1`,
        [id],
      ),
    ]);
    assert.ok(settlements.rows.length > 0, "granular mirror empty -- the dual-write never ran");
    for (const s of settlements.rows) {
      const source = blob.rows[0].settlements[s.id];
      assert.ok(source, `granular settlement ${s.id} missing from the JSONB source`);
      assert.equal(s.gold, source.gold, `settlements.gold for ${s.id} must equal the JSONB source exactly`);
      assert.equal(s.morale, source.morale, `settlements.morale for ${s.id} must equal the JSONB source exactly`);
      assert.ok(
        Number.isInteger(s.gold),
        `settlements.gold for ${s.id} must be a whole integer after the engine rounds`,
      );
    }

    const legacyGold = (
      await pool.query<{ gold: number }>(`SELECT gold FROM games WHERE name = $1`, [name])
    ).rows[0];
    assert.equal(typeof legacyGold.gold, "number", "games.gold must parse back as a number");
  } finally {
    await pool.query(`DELETE FROM games WHERE name = $1`, [name]);
  }
});
