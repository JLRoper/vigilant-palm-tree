import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { PoolClient } from "pg";
import type { SettlementState } from "@heroes/contracts";
import { settlementProductionRates } from "@heroes/engine";
import { withRollback } from "../helpers/pgTestTx";
import { pool } from "../../server/persistence/db";
import { createSettlementRepo } from "../../server/persistence/repositories/settlementRepo";
import { emptyWarehouse, makeSettlement } from "../charter/_helpers";

// withRollback pulls in the shared pg pool; close it once this file's tests
// are done so node:test's process can exit promptly instead of waiting out
// the pool's idle timeout.
after(() => pool.end());

async function seedGame(client: PoolClient, name: string): Promise<void> {
  await client.query(
    `INSERT INTO games (name, seed, hero_q, hero_r) VALUES ($1, $2, $3, $4)`,
    [name, 1, 0, 0],
  );
}

function uniqueName(): string {
  return `test-game-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

test("settlementRepo.loadAllForGame returns [] for a game with no settlements", async () => {
  await withRollback(async (client) => {
    const name = uniqueName();
    await seedGame(client, name);
    const repo = createSettlementRepo(client);

    assert.deepEqual(await repo.loadAllForGame(name), []);
  });
});

test("settlementRepo.upsertMany writes a settlement and loadAllForGame reads it back", async () => {
  await withRollback(async (client) => {
    const name = uniqueName();
    await seedGame(client, name);
    const repo = createSettlementRepo(client);
    const settlement = makeSettlement("s0", 0, 3, 4, {
      warehouse: emptyWarehouse({ wood: 12, food: 5 }),
      gold: 200,
    });

    await repo.upsertMany(name, { s0: settlement });
    const loaded = await repo.loadAllForGame(name);

    assert.equal(loaded.length, 1);
    assert.deepEqual(loaded[0], settlement);
  });
});

test("settlementRepo.upsertMany round-trips fractional gold/morale/warehouse at full precision (migration 027 NUMERIC columns)", async () => {
  await withRollback(async (client) => {
    const name = uniqueName();
    await seedGame(client, name);
    const repo = createSettlementRepo(client);
    // The fractional shapes the engine actually produces: round2'd gold
    // production (500.55), a continuous foodDeficitRatio morale (90.4), and a
    // hundredths-rounded food output in the warehouse (6.45). Under the old
    // INTEGER columns the write boundary rounded all three; the granular read
    // is what hydrateFromRepos PREFERS, so that rounding was a recurring
    // per-command loss.
    const settlement = makeSettlement("s0", 0, 3, 4, {
      gold: 500.55,
      morale: 90.4,
      warehouse: emptyWarehouse({ wood: 12.25, food: 6.45 }),
    });

    await repo.upsertMany(name, { s0: settlement });
    const loaded = await repo.loadAllForGame(name);

    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].gold, 500.55);
    assert.equal(loaded[0].morale, 90.4);
    assert.equal(loaded[0].warehouse.wood, 12.25);
    assert.equal(loaded[0].warehouse.food, 6.45);
    assert.deepEqual(loaded[0], settlement);
  });
});

test("settlementRepo.upsertMany round-trips a partial resourceRates including gold", async () => {
  await withRollback(async (client) => {
    const name = uniqueName();
    await seedGame(client, name);
    const repo = createSettlementRepo(client);
    // Deliberately partial (only wood + gold have a rate) -- resourceRates
    // is Partial<Record<ResourceType, number>>, and ResourceType includes
    // "gold" even though Warehouse doesn't track it (see the note on
    // settlements.gold_rate in server/migrations/009_granular_entities.sql).
    const settlement = makeSettlement("s0", 0, 3, 4, {
      resourceRates: { wood: 15, gold: 20 },
    });

    await repo.upsertMany(name, { s0: settlement });
    const [loaded] = await repo.loadAllForGame(name);

    // The rate read-back has no stone key at all. Asserted BEFORE the
    // deepEqual below: assert.deepEqual narrows `loaded.resourceRates` to the
    // expected literal, so a `.stone` access after it is a type error.
    assert.equal(loaded.resourceRates.stone, undefined);
    assert.deepEqual(loaded.resourceRates, { wood: 15, gold: 20 });
  });
});

test("settlementRepo.upsertMany round-trips buildings", async () => {
  await withRollback(async (client) => {
    const name = uniqueName();
    await seedGame(client, name);
    const repo = createSettlementRepo(client);
    const settlement = makeSettlement("s0", 0, 3, 4, {
      buildings: [
        { gx: 1, gy: 2, kind: "house", level: 1, style: "classic" },
        { gx: 3, gy: 4, kind: "market", level: 2, style: "blocky", w: 2, h: 2, construction: { daysRemaining: 3 } },
      ],
    });

    await repo.upsertMany(name, { s0: settlement });
    const [loaded] = await repo.loadAllForGame(name);

    assert.deepEqual(loaded.buildings, settlement.buildings, "construction state must round-trip; finished buildings must not gain a key");
  });
});

test("settlementRepo round-trips a per-building bank pot (and absent stays absent)", async () => {
  await withRollback(async (client) => {
    const name = uniqueName();
    await seedGame(client, name);
    const repo = createSettlementRepo(client);
    const settlement = makeSettlement("s0", 0, 3, 4, {
      buildings: [
        {
          gx: 1,
          gy: 1,
          kind: "bank",
          level: 2,
          style: "classic",
          bank: {
            gold: 1234,
            pendingOut: [
              { gold: 100, maturesOnDay: 12 },
              { gold: 250, maturesOnDay: 19 },
            ],
          },
        },
        // No pot: the key must be absent on the way back out, never
        // `undefined` -- an explicit undefined key is not deepStrictEqual to
        // an omitted one, which is the same trap `construction` documents.
        { gx: 4, gy: 4, kind: "treasury", level: 1, style: "classic" },
        // Empty pot (0 gold, nothing pending) is NOT the same as absent and
        // must still round-trip -- `bank: {}` is falsy-adjacent but truthy.
        { gx: 6, gy: 6, kind: "bank", level: 1, style: "classic", bank: { gold: 0, pendingOut: [] } },
      ],
    });

    await repo.upsertMany(name, { s0: settlement });
    const [loaded] = await repo.loadAllForGame(name);

    assert.deepEqual(loaded.buildings, settlement.buildings, "pot state must round-trip byte-for-byte");
    assert.equal(loaded.buildings[0]?.bank?.gold, 1234);
    assert.equal(loaded.buildings[0]?.bank?.pendingOut.length, 2);
    assert.ok(
      !("bank" in (loaded.buildings[1] as object)),
      "a building with no pot must come back without the key at all",
    );
    assert.ok("bank" in (loaded.buildings[2] as object), "an opened-but-empty pot still carries the key");
  });
});

test("settlementRepo.upsertMany is a full sync: a settlement missing from the record is deleted", async () => {
  await withRollback(async (client) => {
    const name = uniqueName();
    await seedGame(client, name);
    const repo = createSettlementRepo(client);
    await repo.upsertMany(name, {
      s0: makeSettlement("s0", 0, 1, 1),
      s1: makeSettlement("s1", 0, 2, 2),
    });

    await repo.upsertMany(name, { s0: makeSettlement("s0", 0, 1, 1) });
    const loaded = await repo.loadAllForGame(name);

    assert.deepEqual(loaded.map((s) => s.id), ["s0"]);
  });
});

test("settlementRepo.upsertMany replaces buildings on update rather than merging them", async () => {
  await withRollback(async (client) => {
    const name = uniqueName();
    await seedGame(client, name);
    const repo = createSettlementRepo(client);
    await repo.upsertMany(name, {
      s0: makeSettlement("s0", 0, 1, 1, {
        buildings: [{ gx: 1, gy: 1, kind: "house", level: 1, style: "classic" }],
      }),
    });

    const updated = makeSettlement("s0", 0, 1, 1, {
      buildings: [{ gx: 5, gy: 5, kind: "tower", level: 1, style: "classic" }],
    });
    await repo.upsertMany(name, { s0: updated });
    const [loaded] = await repo.loadAllForGame(name);

    assert.deepEqual(loaded.buildings, updated.buildings);
  });
});

test("settlementRepo.upsertMany round-trips the garrison unpaid-upkeep shortfall counters", async () => {
  await withRollback(async (client) => {
    const name = uniqueName();
    await seedGame(client, name);
    const repo = createSettlementRepo(client);
    // Non-default values on all three: the paid-up default is already
    // exercised by every other round-trip in this file.
    const settlement = makeSettlement("s0", 0, 3, 4, {
      garrisonUnpaidSinceDay: 21,
      garrisonUnpaidTroops: 14,
      garrisonUnpaidGold: 112,
    });

    await repo.upsertMany(name, { s0: settlement });
    const [loaded] = await repo.loadAllForGame(name);

    assert.equal(loaded.garrisonUnpaidSinceDay, 21);
    assert.equal(loaded.garrisonUnpaidTroops, 14);
    assert.equal(loaded.garrisonUnpaidGold, 112);
    assert.deepEqual(loaded, settlement);
  });
});

test("settlementRepo.upsertMany clears the garrison upkeep streak back to paid up on update", async () => {
  await withRollback(async (client) => {
    const name = uniqueName();
    await seedGame(client, name);
    const repo = createSettlementRepo(client);
    await repo.upsertMany(name, {
      s0: makeSettlement("s0", 0, 1, 1, {
        garrisonUnpaidSinceDay: 8,
        garrisonUnpaidTroops: 6,
        garrisonUnpaidGold: 48,
      }),
    });

    const paidUp = makeSettlement("s0", 0, 1, 1);
    await repo.upsertMany(name, { s0: paidUp });
    const [loaded] = await repo.loadAllForGame(name);

    assert.equal(loaded.garrisonUnpaidSinceDay, null);
    assert.equal(loaded.garrisonUnpaidTroops, 0);
    assert.equal(loaded.garrisonUnpaidGold, 0);
  });
});

// ---------------------------------------------------------------------------
// E8 (playthrough round 2b, district section 4c): the granular per-building
// ledger could not hold a district building at all.
//
// settlement_buildings was keyed (game_id, settlement_id, gx, gy) and described
// only the main city's grid. A district's buildings sit on the district's OWN
// 5x5 grid, so a district building at (0,0) collided with the city's (0,0) and
// the row could not be written: the ledger held 11 rows for a town whose state
// held 14 buildings, and a sum of its own rows came up short by exactly the
// districts' output (3.12 stone + 3.75 food on the reporter's Stone mark).
// ---------------------------------------------------------------------------

/** A settlement with two districts whose local coordinates overlap the city's. */
function settlementWithDistricts(): SettlementState {
  return {
    ...makeSettlement("s0", 0, 5, 5, {
      warehouse: emptyWarehouse({ wood: 30, stone: 10, food: 20 }),
      buildings: [
        { gx: 0, gy: 0, kind: "stoneMine", level: 1, style: "pixel" },
        { gx: 2, gy: 0, kind: "woodcutterHut", level: 1, style: "pixel" },
      ],
    }),
    districts: {
      "20,12": {
        q: 20,
        r: 12,
        citySpots: [],
        buildings: [
          { gx: 0, gy: 0, kind: "farmField", level: 1, style: "pixel" },
          { gx: 2, gy: 0, kind: "house", level: 1, style: "pixel" },
          { gx: 3, gy: 0, kind: "stoneMine", level: 1, style: "pixel", bank: { gold: 120, pendingOut: [] }, workers: 2 },
        ],
      },
      "20,13": {
        q: 20,
        r: 13,
        citySpots: [],
        buildings: [{ gx: 1, gy: 1, kind: "farmhouse", level: 1, style: "pixel" }],
      },
    },
  };
}

test("settlementRepo.upsertMany writes a district's buildings as rows attributed to their district hex (E8)", async () => {
  await withRollback(async (client) => {
    const name = uniqueName();
    await seedGame(client, name);
    const repo = createSettlementRepo(client);

    await repo.upsertMany(name, { s0: settlementWithDistricts() });

    const rows = await client.query<{
      district_q: number | null;
      district_r: number | null;
      gx: number;
      gy: number;
      kind: string;
      bank: unknown;
      workers: number | null;
    }>(
      `SELECT district_q, district_r, gx, gy, kind, bank, workers FROM settlement_buildings
        WHERE game_id = (SELECT id FROM games WHERE name = $1) AND settlement_id = 's0'
        ORDER BY id`,
      [name],
    );

    // Every building of the settlement, main city first: six rows where the
    // pre-035 ledger could hold only two.
    assert.deepEqual(
      rows.rows.map((r) => `${r.district_q ?? "city"},${r.district_r ?? "-"}:${r.gx},${r.gy} ${r.kind}`),
      [
        "city,-:0,0 stoneMine",
        "city,-:2,0 woodcutterHut",
        "20,12:0,0 farmField",
        "20,12:2,0 house",
        "20,12:3,0 stoneMine",
        "20,13:1,1 farmhouse",
      ],
    );
    // The columns a district building carries beyond its address survive the
    // write: the 035 backfill and this writer both have to keep a district bank
    // pot and its staffing, or an existing game would lose them at cutover.
    const mine = rows.rows.find((r) => r.district_q === 20 && r.gx === 3);
    assert.deepEqual(mine?.bank, { gold: 120, pendingOut: [] });
    assert.equal(mine?.workers, 2);
  });
});

test("a settlement read back from the ledger round-trips its districts, buildings and all (E8)", async () => {
  await withRollback(async (client) => {
    const name = uniqueName();
    await seedGame(client, name);
    const repo = createSettlementRepo(client);
    const settlement = settlementWithDistricts();

    await repo.upsertMany(name, { s0: settlement });
    const [loaded] = await repo.loadAllForGame(name);

    assert.deepEqual(loaded, settlement);
  });
});

test("the ledger's own rows add up to the panel's aggregate, and dropping one district row leaves the sum short (E8)", async () => {
  // The rate the settlement panel shows is settlementProductionRates() over the
  // settlement the read path returns (src/screens/settlements/panelRates.ts), so
  // running the SAME function over the settlement loaded from the ledger is the
  // panel's aggregate: if a district building has no row, the number on screen
  // and the number the ledger can explain disagree -- which is the finding.
  const castleSeed = 1683192952;
  await withRollback(async (client) => {
    const name = uniqueName();
    await seedGame(client, name);
    const repo = createSettlementRepo(client);
    await repo.upsertMany(name, { s0: settlementWithDistricts() });

    const [loaded] = await repo.loadAllForGame(name);
    const fromLedger = settlementProductionRates(loaded, castleSeed, []);
    const panel = settlementProductionRates(settlementWithDistricts(), castleSeed, []);
    assert.deepEqual(fromLedger, panel, "the ledger explains the whole panel aggregate");
    assert.ok(
      panel.rates.some((r) => r.resource === "stone" && r.perTurn > 0),
      "the fixture really does have a district producer in the sum",
    );

    // Drop the district's stone mine -- the row the pre-035 ledger could not
    // write at all. The granular sum MUST go short: a ledger that rounds a
    // missing producer away is worse than one that admits it cannot hold it.
    await client.query(
      `DELETE FROM settlement_buildings
        WHERE game_id = (SELECT id FROM games WHERE name = $1)
          AND settlement_id = 's0' AND district_q = 20 AND district_r = 12 AND gx = 3 AND gy = 0`,
      [name],
    );
    const [afterDrop] = await repo.loadAllForGame(name);
    assert.deepEqual(
      afterDrop.districts?.["20,12"]?.buildings.map((b) => `${b.kind}@${b.gx},${b.gy}`),
      ["farmField@0,0", "house@2,0"],
      "the dropped building is gone from the district the ledger rebuilds",
    );
    assert.notDeepEqual(
      settlementProductionRates(afterDrop, castleSeed, []),
      panel,
      "with a district building missing the ledger no longer explains the panel's rate",
    );
  });
});

test("a district with no ledger rows at all still reads the buildings its JSONB row carries", async () => {
  // The deliberate other half: missing rows for a WHOLE district (a game whose
  // rows predate migration 035, or a district the backfill's malformed-shape
  // guards skipped) fall back to the `districts` column, exactly as hydrate.ts
  // falls back per game. A district the ledger is silent about must not read as
  // an empty district -- that would delete a player's buildings on load.
  await withRollback(async (client) => {
    const name = uniqueName();
    await seedGame(client, name);
    const repo = createSettlementRepo(client);
    await repo.upsertMany(name, { s0: settlementWithDistricts() });
    await client.query(
      `DELETE FROM settlement_buildings
        WHERE game_id = (SELECT id FROM games WHERE name = $1) AND settlement_id = 's0' AND district_q = 20 AND district_r = 13`,
      [name],
    );

    const [loaded] = await repo.loadAllForGame(name);

    assert.deepEqual(loaded.districts?.["20,13"]?.buildings, [
      { gx: 1, gy: 1, kind: "farmhouse", level: 1, style: "pixel" },
    ]);
  });
});
