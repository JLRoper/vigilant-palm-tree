import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import type { HeroId, HeroState, SettlementId, SettlementState } from "@heroes/contracts";
import { pool } from "../../server/persistence/db";
import { router } from "../../server/routes";
import { errorHandler } from "../../server/errorHandler";
import { emptyWarehouse, makeHero, makePlayer, makeSettlement } from "../charter/_helpers";

// Route-level coverage for POST /games/:name/commands, over real Express +
// real Postgres (same harness pattern as eventsRoute.test.ts).
//
// Why these two commands specifically: test/server/commandHandler.test.ts
// calls handleCommand() directly against test/helpers/mockRepos.ts, which
// never runs parseCommand() -- so UpgradeBuilding/UpgradeSettlement passed
// every unit test while parseCommand() had no branch for either kind and
// fell through to `return null`, i.e. a 400 "invalid command" on every real
// HTTP request the client ever made (src/io/commands.ts's upgradeBuilding()/
// upgradeSettlement(), fired from src/game/turnHooks.ts). The 200 assertions
// below are the regression pin: they fail with 400 if either branch is ever
// dropped again.
let server: Server;
let baseUrl: string;

before(async () => {
  const app = express();
  // Mirrors server/index.ts's own wiring -- without the JSON body parser
  // every POST here would arrive with an undefined req.body and 400 for a
  // reason that has nothing to do with what's under test.
  app.use(express.json());
  app.use("/api", router);
  app.use(errorHandler);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}/api`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

function uniqueName(): string {
  return `test-commands-route-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// The granular `heroes`/`settlements` tables (migration 009) key on a
// globally unique id, not (game_id, id) -- so entity ids are namespaced by
// game name here, otherwise the dual-write step of one test would collide
// with another's rows.
function ids(gameName: string): { heroId: HeroId; settlementId: SettlementId } {
  return { heroId: `${gameName}-h0`, settlementId: `${gameName}-s0` };
}

// Seeded through the legacy JSONB columns only: with the granular tables
// empty, server/persistence/hydrate.ts falls back to hydrating from the row
// itself (its "jsonb" source), which is all these tests need -- they're
// about the request-parsing layer, not the read path.
async function seedGame(name: string, settlement: SettlementState): Promise<void> {
  const { heroId } = ids(name);
  const heroes: Record<HeroId, HeroState> = { [heroId]: makeHero(heroId, 0, 2, 2) };
  const settlements: Record<SettlementId, SettlementState> = { [settlement.id]: settlement };
  const players = [makePlayer(0, "player", [heroId], [settlement.id])];
  await pool.query(
    `INSERT INTO games (name, seed, hero_q, hero_r, active_player_id, players, heroes, settlements, map_size)
     VALUES ($1, 1, 2, 2, 0, $2::jsonb, $3::jsonb, $4::jsonb, 'small')`,
    [name, JSON.stringify(players), JSON.stringify(heroes), JSON.stringify(settlements)],
  );
}

// Cascades to game_events / heroes / settlements (all ON DELETE CASCADE off
// games.id -- schema.sql and migration 009).
async function cleanupGame(name: string): Promise<void> {
  await pool.query(`DELETE FROM games WHERE name = $1`, [name]);
}

async function postCommand(name: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/games/${name}/commands`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Level-1 market plus enough gold/wood/stone for buildingUpgradeCost() to
// clear -- the happy path for startBuildingUpgrade().
function buildingUpgradeSettlement(name: string): SettlementState {
  return makeSettlement(ids(name).settlementId, 0, 2, 2, {
    gold: 999999,
    warehouse: emptyWarehouse({ wood: 999999, stone: 999999 }),
    buildings: [{ gx: 1, gy: 1, kind: "market", level: 1, style: "classic" }],
  });
}

// Level 1 + a level-2 town hall + population and resources above
// SETTLEMENT_UPGRADE_COSTS[1] -- the happy path for startSettlementUpgrade()
// at targetLevel 2.
function settlementUpgradeSettlement(name: string): SettlementState {
  return makeSettlement(ids(name).settlementId, 0, 2, 2, {
    level: 1,
    population: 100000,
    gold: 999999,
    warehouse: emptyWarehouse({ wood: 999999, stone: 999999, iron: 999999, arcane: 999999 }),
    buildings: [{ gx: 0, gy: 0, kind: "townHall", level: 2, style: "classic" }],
  });
}

test("POST /games/:name/commands accepts UpgradeBuilding over HTTP (was a 400 -- parseCommand had no branch for it)", async () => {
  const name = uniqueName();
  const { settlementId } = ids(name);
  await seedGame(name, buildingUpgradeSettlement(name));
  try {
    const res = await postCommand(name, {
      kind: "UpgradeBuilding",
      actor: 0,
      settlementId,
      requests: [{ gx: 1, gy: 1, kind: "market" }],
    });
    assert.equal(res.status, 200, await res.clone().text());
    const body = (await res.json()) as { settlement?: SettlementState };
    assert.equal(body.settlement?.upgrade?.kind, "buildings");
    assert.deepEqual(body.settlement?.upgrade?.buildingRefs, [{ gx: 1, gy: 1, kind: "market" }]);
  } finally {
    await cleanupGame(name);
  }
});

test("POST /games/:name/commands accepts UpgradeSettlement over HTTP (was a 400 -- parseCommand had no branch for it)", async () => {
  const name = uniqueName();
  const { settlementId } = ids(name);
  await seedGame(name, settlementUpgradeSettlement(name));
  try {
    const res = await postCommand(name, {
      kind: "UpgradeSettlement",
      actor: 0,
      settlementId,
      upgradePopulationGate: 0.85,
    });
    assert.equal(res.status, 200, await res.clone().text());
    const body = (await res.json()) as { settlement?: SettlementState };
    assert.equal(body.settlement?.upgrade?.kind, "settlement");
    assert.equal(body.settlement?.upgrade?.targetLevel, 2);
  } finally {
    await cleanupGame(name);
  }
});

test("UpgradeSettlement ignores a client-supplied targetLevel and derives it server-side", async () => {
  const name = uniqueName();
  const { settlementId } = ids(name);
  await seedGame(name, settlementUpgradeSettlement(name));
  try {
    // If targetLevel were read off the body, startSettlementUpgrade() would
    // reject this level-1 settlement with "invalid_level" (a 409); the
    // server-derived level + 1 = 2 is what actually gets used.
    const res = await postCommand(name, {
      kind: "UpgradeSettlement",
      actor: 0,
      settlementId,
      upgradePopulationGate: 0.85,
      targetLevel: 3,
    });
    assert.equal(res.status, 200, await res.clone().text());
    const body = (await res.json()) as { settlement?: SettlementState };
    assert.equal(body.settlement?.upgrade?.targetLevel, 2);
  } finally {
    await cleanupGame(name);
  }
});

test("UpgradeBuilding with a malformed requests payload is a 400, not a handler-level crash", async () => {
  const name = uniqueName();
  const { settlementId } = ids(name);
  await seedGame(name, buildingUpgradeSettlement(name));
  try {
    const missingKind = await postCommand(name, {
      kind: "UpgradeBuilding",
      actor: 0,
      settlementId,
      requests: [{ gx: 1, gy: 1 }],
    });
    assert.equal(missingKind.status, 400);

    const notAnArray = await postCommand(name, {
      kind: "UpgradeBuilding",
      actor: 0,
      settlementId,
      requests: { gx: 1, gy: 1, kind: "market" },
    });
    assert.equal(notAnArray.status, 400);
  } finally {
    await cleanupGame(name);
  }
});

test("UpgradeBuilding with an empty requests array reaches the reducer as a 409, not a 400", async () => {
  const name = uniqueName();
  const { settlementId } = ids(name);
  await seedGame(name, buildingUpgradeSettlement(name));
  try {
    const res = await postCommand(name, {
      kind: "UpgradeBuilding",
      actor: 0,
      settlementId,
      requests: [],
    });
    assert.equal(res.status, 409);
    assert.equal(((await res.json()) as { error: string }).error, "no_buildings");
  } finally {
    await cleanupGame(name);
  }
});

test("UpgradeSettlement with an out-of-domain upgradePopulationGate is a 400", async () => {
  const name = uniqueName();
  const { settlementId } = ids(name);
  await seedGame(name, settlementUpgradeSettlement(name));
  try {
    // The gate is a fraction of the level's population cap, so anything
    // outside 0..1 (or not a number at all) is malformed rather than merely
    // unfavorable.
    for (const upgradePopulationGate of [1.5, -0.1, "0.85"]) {
      const res = await postCommand(name, {
        kind: "UpgradeSettlement",
        actor: 0,
        settlementId,
        upgradePopulationGate,
      });
      assert.equal(
        res.status,
        400,
        `gate ${JSON.stringify(upgradePopulationGate)} should be rejected`,
      );
    }
  } finally {
    await cleanupGame(name);
  }
});
