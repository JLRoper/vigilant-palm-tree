// Per-faction troop upkeep (server/migrations/037_faction_upkeep.sql) is DATA,
// and the only honest way to pin data is to read it back out of a schema the
// migration pipeline itself built. This file therefore runs initSchema() --
// schema.sql plus every migration in filename order, the same order a fresh
// database gets at boot -- and asserts the result, because the bug class this
// migration sits next to is ORDER-DEPENDENT: 006's backfill list, renumbered
// from 023, now runs before the migrations that INSERT four of the units it
// backfills, and 021's tier recompute sits at position 21 while 024/025/026/033
// insert their units after it. Both are visible only on a first boot. A run
// against an already-migrated, many-boots-old database proves nothing about
// either, which is why the last three tests below put the boot-time states
// back by hand and assert 037 repairs them.
//
// The expected numbers are written as LITERALS, read off 037's own header
// table, never re-derived from the SQL's arithmetic: a test that recomputes
// the migration's formula would pass for any formula, including a wrong one.
// The two must be kept in step by hand, which is the point -- the literals are
// the contract and the migration is one implementation of it.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { PoolClient } from "pg";
import { pool } from "../../server/persistence/db";
import { initSchema } from "../../server/db";
import { withRollback } from "../helpers/pgTestTx";

before(async () => {
  await initSchema();
});

after(() => pool.end());

const FACTION_UPKEEP_SQL = await readFile(
  new URL("../../server/migrations/037_faction_upkeep.sql", import.meta.url),
  "utf8",
);

// 021's own recompute, verbatim -- the state a long-lived database is in when
// 037 runs, because 021 re-runs unconditionally at every boot and 037 sorts
// after it.
const LADDER_SQL = `
UPDATE unit_types SET upkeep_gold = COALESCE(tier, 8);
UPDATE unit_types SET upkeep_food = LEAST(3, GREATEST(1, CEIL(COALESCE(tier, 8) / 2.0)));`;

// The column defaults a unit carries when its INSERT runs AFTER 021 (anything
// from 024/025/026/033 on a fresh database): 1 gold, 1 food, per 015.
const DEFAULT_1_1_SQL = `
UPDATE unit_types SET upkeep_gold = 1, upkeep_food = 1
 WHERE faction_id IN ('ashen', 'ironmark', 'verdant');`;

type Row = readonly [tier: number, gold: number, food: number];

// 037's header table, tier by tier: human is 021's ladder untouched, ashen
// pays the whole bill in gold, ironmark in stores, verdant a coin-heavy split.
const EXPECTED: Record<string, readonly Row[]> = {
  human: [
    [1, 1, 1],
    [2, 2, 1],
    [3, 3, 2],
    [4, 4, 2],
    [5, 5, 3],
    [6, 6, 3],
    [7, 7, 3],
  ],
  ashen: [
    [1, 2, 0],
    [2, 3, 0],
    [3, 5, 0],
    [4, 6, 0],
    [5, 8, 0],
    [6, 9, 0],
    [7, 10, 0],
  ],
  ironmark: [
    [1, 1, 1],
    [2, 1, 2],
    [3, 1, 4],
    [4, 2, 4],
    [5, 3, 5],
    [6, 4, 5],
    [7, 5, 5],
  ],
  verdant: [
    [1, 1, 1],
    [2, 2, 1],
    [3, 4, 1],
    [4, 5, 1],
    [5, 6, 2],
    [6, 7, 2],
    [7, 8, 2],
  ],
};

const SHAPED_FACTIONS = ["ashen", "ironmark", "verdant"] as const;
const ALL_FACTIONS = ["human", ...SHAPED_FACTIONS] as const;

// One unit of each tier 1..7 is the comparable set: same power band, so the
// bills are comparable where a whole roster's are not (the rosters hold
// different numbers of tier-6 and tier-7 units, which is also why their
// one-of-each-unit purchase prices differ by 7%).
function tierTotal(tier: number): number {
  return tier + Math.min(3, Math.max(1, Math.ceil(tier / 2)));
}

function totalsOverOneOfEachTier(rows: readonly Row[]): { gold: number; food: number } {
  let gold = 0;
  let food = 0;
  for (const [, g, f] of rows) {
    gold += g;
    food += f;
  }
  return { gold, food };
}

async function upkeepByFactionTier(
  client: PoolClient,
): Promise<Array<{ faction: string; tier: number; gold: number[]; food: number[]; count: number }>> {
  const result = await client.query<{
    faction_id: string;
    tier: number;
    golds: number[];
    foods: number[];
    count: string;
  }>(
    `SELECT faction_id,
            tier,
            array_agg(DISTINCT upkeep_gold ORDER BY upkeep_gold) AS golds,
            array_agg(DISTINCT upkeep_food ORDER BY upkeep_food) AS foods,
            count(*) AS count
       FROM unit_types
      WHERE faction_id = ANY($1::text[])
      GROUP BY faction_id, tier
      ORDER BY faction_id, tier`,
    [[...ALL_FACTIONS]],
  );
  return result.rows.map((r) => ({
    faction: r.faction_id,
    tier: r.tier,
    gold: r.golds,
    food: r.foods,
    count: Number(r.count),
  }));
}

async function shapedTable(
  client: PoolClient,
  faction: string,
): Promise<readonly Row[]> {
  const grouped = await upkeepByFactionTier(client);
  return grouped
    .filter((g) => g.faction === faction)
    .map((g) => [g.tier, g.gold[0], g.food[0]] as Row);
}

async function snapshot(client: PoolClient): Promise<Array<{ id: string; gold: number; food: number }>> {
  const rows = await client.query<{ id: string; upkeep_gold: number; upkeep_food: number }>(
    `SELECT id, upkeep_gold, upkeep_food FROM unit_types ORDER BY id`,
  );
  return rows.rows.map((r) => ({ id: r.id, gold: r.upkeep_gold, food: r.upkeep_food }));
}

function changedIds(
  before: Array<{ id: string; gold: number; food: number }>,
  after: Array<{ id: string; gold: number; food: number }>,
): string[] {
  const previous = new Map(before.map((r) => [r.id, `${r.gold}/${r.food}`]));
  return after
    .filter((r) => previous.get(r.id) !== `${r.gold}/${r.food}`)
    .map((r) => r.id)
    .sort();
}

test("the catalog bills every faction's roster from 037's table, tier by tier", async () => {
  await withRollback(async (client) => {
    const grouped = await upkeepByFactionTier(client);
    for (const faction of ALL_FACTIONS) {
      const rows = grouped.filter((g) => g.faction === faction);
      assert.deepEqual(
        rows.map((r) => r.tier),
        [1, 2, 3, 4, 5, 6, 7],
        `${faction} must have units at every tier 1..7`,
      );
      // One bill per (faction, tier), or the table in 037's header is a lie.
      for (const row of rows) {
        assert.equal(row.gold.length, 1, `${faction} tier ${row.tier} bills more than one gold value`);
        assert.equal(row.food.length, 1, `${faction} tier ${row.tier} bills more than one food value`);
      }
      assert.deepEqual(
        rows.map((r) => [r.tier, r.gold[0], r.food[0]]),
        EXPECTED[faction],
        `${faction}'s upkeep diverged from 037's header table`,
      );
      assert.equal(
        rows.reduce((n, r) => n + r.count, 0),
        12,
        `${faction} should field 12 catalog units`,
      );
    }
  });
});

test("an equal-strength roster bills the same total at every faction -- the split is the only difference", async () => {
  await withRollback(async (client) => {
    const perTier =
      tierTotal(1) +
      tierTotal(2) +
      tierTotal(3) +
      tierTotal(4) +
      tierTotal(5) +
      tierTotal(6) +
      tierTotal(7);
    assert.equal(perTier, 43);

    const seen = new Map<string, { gold: number; food: number }>();
    for (const faction of ALL_FACTIONS) {
      const totals = totalsOverOneOfEachTier(EXPECTED[faction]);
      seen.set(faction, totals);
      assert.equal(
        totals.gold + totals.food,
        perTier,
        `${faction} bills ${totals.gold}g + ${totals.food}f, not the shared ${perTier}`,
      );
    }
    // Stated as literals too: no faction is the cheap one.
    assert.deepEqual([...seen.entries()], [
      ["human", { gold: 28, food: 15 }],
      ["ashen", { gold: 43, food: 0 }],
      ["ironmark", { gold: 17, food: 26 }],
      ["verdant", { gold: 33, food: 10 }],
    ]);

    // ...and the database agrees with the table it was read from.
    for (const faction of ALL_FACTIONS) {
      const totals = totalsOverOneOfEachTier(await shapedTable(client, faction));
      assert.equal(totals.gold + totals.food, perTier, `${faction} in the DB is not sum-preserving`);
    }
  });
});

test("human keeps 021's ladder and the neutral monsters keep 8 gold / 3 food", async () => {
  await withRollback(async (client) => {
    const human = await client.query<{ tier: number; upkeep_gold: number; upkeep_food: number; n: string }>(
      `SELECT tier, upkeep_gold, upkeep_food, count(*) AS n
         FROM unit_types WHERE faction_id = 'human'
        GROUP BY tier, upkeep_gold, upkeep_food ORDER BY tier`,
    );
    assert.equal(human.rowCount, 7);
    for (const row of human.rows) {
      // 021's rule, as its own header states it: tier N -> N gold / f(N) food.
      assert.equal(row.upkeep_gold, row.tier, `human tier ${row.tier} is no longer the control`);
      assert.equal(row.upkeep_food, Math.min(3, Math.max(1, Math.ceil(row.tier / 2))));
    }

    const monsters = await client.query<{ id: string; upkeep_gold: number; upkeep_food: number }>(
      `SELECT id, upkeep_gold, upkeep_food FROM unit_types WHERE faction_id = 'neutral' ORDER BY id`,
    );
    assert.equal(monsters.rowCount, 4);
    for (const row of monsters.rows) {
      assert.deepEqual(
        { id: row.id, gold: row.upkeep_gold, food: row.upkeep_food },
        { id: row.id, gold: 8, food: 3 },
      );
    }
  });
});

test("a fresh database's post-021 rows arrive at the column default, and 037 shapes them on the first boot", async () => {
  await withRollback(async (client) => {
    // What a first boot leaves behind: 021 re-ran at position 21, before
    // 024/025/026 inserted their units, so those rows still carry 015's
    // DEFAULT of 1 gold / 1 food. Measured on a real first boot: 23 rows
    // (ashen 7, ironmark 8, verdant 8 -- 021's recompute reached none of the
    // 21 rows 024/025/026 insert, and the 2 others are 033's tier-1 units,
    // which the ladder also bills 1/1). Human is unaffected -- all 12 of its
    // units predate 021 -- which is why this file's guards must not be written
    // against 021's ladder: a ladder-shaped guard would skip every one of
    // them and leave the fresh install mixed. The whole 36 are reset here so
    // the count below is about the guard, not about which migration inserted
    // what.
    await client.query(DEFAULT_1_1_SQL);
    for (const faction of SHAPED_FACTIONS) {
      const atDefault = await shapedTable(client, faction);
      assert.notDeepEqual(
        atDefault,
        EXPECTED[faction],
        `${faction} already matched 037's table at the 1/1 default -- 037 would be dead code`,
      );
    }

    const before = await snapshot(client);
    await client.query(FACTION_UPKEEP_SQL);
    const after = await snapshot(client);

    // 34, not 36: the two tier-1 units the table ALSO bills 1/1 (ironmark's
    // tunnel_levy, verdant's sproutling) already held the value 037 writes.
    assert.equal(changedIds(before, after).length, 34);
    for (const faction of SHAPED_FACTIONS) {
      assert.deepEqual(
        await shapedTable(client, faction),
        EXPECTED[faction],
        `${faction} was not repaired from the column default on the first boot`,
      );
    }
  });
});

test("021's ladder fails these assertions, and 037 repairs it -- so the test is sensitive to the migration", async () => {
  await withRollback(async (client) => {
    assert.deepEqual(await shapedTable(client, "ashen"), EXPECTED.ashen, "037 is not applied here at all");

    // Rewind to the much-boots-old state 037 actually meets at boot.
    await client.query(LADDER_SQL);
    const ladder = await shapedTable(client, "ashen");
    assert.notDeepEqual(
      ladder,
      EXPECTED.ashen,
      "021's own recompute already produced 037's table -- 037 would be dead code",
    );
    assert.deepEqual(ladder, EXPECTED.human, "a long-lived DB's pre-037 table is 021's ladder");

    // The pre-migration table is NOT cheaper, only differently shaped: 037 may
    // not claim it rebalanced a bill it actually resized. Both sets add to 43,
    // and the SPLIT is what moved.
    const ladderTotals = totalsOverOneOfEachTier(ladder);
    const ashenTotals = totalsOverOneOfEachTier(EXPECTED.ashen);
    assert.deepEqual(ladderTotals, { gold: 28, food: 15 });
    assert.deepEqual(ashenTotals, { gold: 43, food: 0 });
    assert.equal(ladderTotals.gold + ladderTotals.food, ashenTotals.gold + ashenTotals.food);

    await client.query(FACTION_UPKEEP_SQL);
    assert.deepEqual(await shapedTable(client, "ashen"), EXPECTED.ashen, "037 did not restore the Ashen bill");
  });
});

test("a unit added to a faction later inherits that faction's bill -- 037 holds no id list", async () => {
  await withRollback(async (client) => {
    await client.query(
      `INSERT INTO unit_types (id, name, attack, defence, health, speed, description, advantage_type, faction_id, tier)
       VALUES ('probe_ashen_t4', 'Probe', 1, 1, 1, 1, 'probe', 'infantry', 'ashen', 4),
              ('probe_verdant_t6', 'Probe', 1, 1, 1, 1, 'probe', 'infantry', 'verdant', 6)`,
    );
    await client.query(LADDER_SQL);
    await client.query(FACTION_UPKEEP_SQL);
    const rows = await client.query<{ id: string; upkeep_gold: number; upkeep_food: number }>(
      `SELECT id, upkeep_gold, upkeep_food FROM unit_types
        WHERE id IN ('probe_ashen_t4', 'probe_verdant_t6') ORDER BY id`,
    );
    assert.deepEqual(rows.rows, [
      { id: "probe_ashen_t4", upkeep_gold: 6, upkeep_food: 0 },
      { id: "probe_verdant_t6", upkeep_gold: 7, upkeep_food: 2 },
    ]);
  });
});

test("re-running 037 rewrites nothing, and a hand-tuned override is reverted by it -- as 021's own header rules", async () => {
  await withRollback(async (client) => {
    const before = await snapshot(client);
    await client.query(FACTION_UPKEEP_SQL);
    assert.deepEqual(changedIds(before, await snapshot(client)), [], "037 is not idempotent");

    // A manual retune is overwritten on the next boot -- exactly the trade 021
    // documents for its own unconditional recompute, so the two files behave
    // the same way and retuning a faction's bill means editing 037.
    await client.query(`UPDATE unit_types SET upkeep_gold = 99, upkeep_food = 9 WHERE id = 'ghoul'`);
    await client.query(FACTION_UPKEEP_SQL);
    const tuned = await client.query<{ upkeep_gold: number; upkeep_food: number }>(
      `SELECT upkeep_gold, upkeep_food FROM unit_types WHERE id = 'ghoul'`,
    );
    assert.deepEqual(tuned.rows[0], { upkeep_gold: 2, upkeep_food: 0 }, "a retune outlived a boot");

    // Retagging a unit drops it out of this file's scope entirely: 021's next
    // boot recomputes it to the ladder and 037 then leaves it alone, because
    // Human is not one of the three shapes. Both files in boot order, so the
    // assertion is about the pipeline and not about 037 in isolation.
    await client.query(`UPDATE unit_types SET faction_id = 'human' WHERE id = 'ghoul'`);
    await client.query(LADDER_SQL);
    await client.query(FACTION_UPKEEP_SQL);
    const retagged = await client.query<{ upkeep_gold: number; upkeep_food: number }>(
      `SELECT upkeep_gold, upkeep_food FROM unit_types WHERE id = 'ghoul'`,
    );
    assert.deepEqual(retagged.rows[0], { upkeep_gold: 1, upkeep_food: 1 }, "a retagged unit kept its old bill");
  });
});
