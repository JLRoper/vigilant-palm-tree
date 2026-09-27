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
import { loginAndClaim, authHeader } from "../helpers/authFlow";

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
// Returns a bearer token for seat 0, already claimed. Sign-in is optional
// (issue #179 follow-up) -- commands would work fine anonymously too (see
// the dedicated test below) -- but driving the tests through a real claimed
// session also exercises the actor-vs-seat check's signed-in path: every
// command below (all actor: 0) needs a token bound to that exact seat, or
// it 403s, so this is the stricter path to keep covered by default.
async function seedGame(
  name: string,
  settlement: SettlementState,
  opts?: { players?: Player[]; extraSettlements?: SettlementState[] },
): Promise<string> {
  const { heroId } = ids(name);
  const heroes: Record<HeroId, HeroState> = { [heroId]: makeHero(heroId, 0, 2, 2) };
  const all = [settlement, ...(opts?.extraSettlements ?? [])];
  const settlements: Record<SettlementId, SettlementState> = Object.fromEntries(
    all.map((s) => [s.id, s]),
  );
  const players = opts?.players ?? [makePlayer(0, "player", [heroId], all.map((s) => s.id))];
  await pool.query(
    `INSERT INTO games (name, seed, hero_q, hero_r, active_player_id, players, heroes, settlements, map_size)
     VALUES ($1, 1, 2, 2, 0, $2::jsonb, $3::jsonb, $4::jsonb, 'small')`,
    [name, JSON.stringify(players), JSON.stringify(heroes), JSON.stringify(settlements)],
  );
  return loginAndClaim(baseUrl, name, 0);
}

// Cascades to game_events / heroes / settlements (all ON DELETE CASCADE off
// games.id -- schema.sql and migration 009).
async function cleanupGame(name: string): Promise<void> {
  await pool.query(`DELETE FROM games WHERE name = $1`, [name]);
}

async function postCommand(name: string, body: unknown, token: string): Promise<Response> {
  return fetch(`${baseUrl}/games/${name}/commands`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeader(token) },
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
  const token = await seedGame(name, buildingUpgradeSettlement(name));
  try {
    const res = await postCommand(name, {
      kind: "UpgradeBuilding",
      actor: 0,
      settlementId,
      requests: [{ gx: 1, gy: 1, kind: "market" }],
    }, token);
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
  const token = await seedGame(name, settlementUpgradeSettlement(name));
  try {
    const res = await postCommand(name, {
      kind: "UpgradeSettlement",
      actor: 0,
      settlementId,
      upgradePopulationGate: 0.85,
    }, token);
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
  const token = await seedGame(name, settlementUpgradeSettlement(name));
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
    }, token);
    assert.equal(res.status, 200, await res.clone().text());
    const body = (await res.json()) as { settlement?: SettlementState };
    assert.equal(body.settlement?.upgrade?.targetLevel, 2);
  } finally {
    await cleanupGame(name);
  }
});

test("POST /games/:name/commands accepts AdvanceCharterTravel over HTTP (was a 400 -- parseCommand had no branch for it)", async () => {
  // seedGame() only seeds the legacy JSONB columns (granular heroes/
  // settlements/charters tables stay empty), so hydrateFromRepos() falls
  // back to source="jsonb" here -- server/app/commandHandler.ts's
  // AdvanceCharterTravel case rejects that with "charters_persist_
  // unavailable" (409), same gate StartCharter uses. That 409 is exactly
  // the regression pin this file's other two tests use a 200 for: it proves
  // parseCommand recognized the kind and the request reached handleCommand,
  // rather than falling through to parseCommand's `return null` and a 400
  // "invalid command" that has nothing to do with charter persistence.
  const name = uniqueName();
  const { heroId } = ids(name);
  const token = await seedGame(name, buildingUpgradeSettlement(name));
  try {
    const res = await postCommand(name, {
      kind: "AdvanceCharterTravel",
      actor: 0,
      heroId,
      fromTile: { q: 2, r: 2 },
      toTile: { q: 3, r: 2 },
      cost: 1,
    }, token);
    assert.equal(res.status, 409, await res.clone().text());
    const body = (await res.json()) as { error?: string };
    assert.equal(body.error, "charters_persist_unavailable");
  } finally {
    await cleanupGame(name);
  }
});

// Gold/warehouse above PlaceBuildings' net cost for a goldMine placement
// (300g 6w 4s) minus the destroy refund for the seeded house (ceil(100/2)g,
// ceil(5/2)w) -- the happy path's exact expected deltas.
function placeBuildingsSettlement(name: string): SettlementState {
  return makeSettlement(ids(name).settlementId, 0, 2, 2, {
    gold: 1000,
    warehouse: emptyWarehouse({ wood: 20, stone: 10, iron: 5, arcane: 2 }),
    buildings: [{ gx: 1, gy: 1, kind: "house", level: 1, style: "classic" }],
  });
}

test("POST /games/:name/commands accepts PlaceBuildings over HTTP and stamps the build timer server-side", async () => {
  const name = uniqueName();
  const { settlementId } = ids(name);
  const token = await seedGame(name, placeBuildingsSettlement(name));
  try {
    const res = await postCommand(name, {
      kind: "PlaceBuildings",
      actor: 0,
      settlementId,
      buildings: [{ gx: 2, gy: 2, kind: "goldMine", level: 1, style: "classic" }],
    }, token);
    assert.equal(res.status, 200, await res.clone().text());
    const body = (await res.json()) as { settlement?: SettlementState };
    const after = body.settlement;
    assert.ok(after);
    assert.equal(after.buildings.length, 1, "the house was destroyed in the same commit");
    assert.equal(after.buildings[0].kind, "goldMine");
    assert.equal(after.buildings[0].construction?.daysRemaining, 4, "build timer recomputed server-side");
    assert.equal(after.gold, 1000 - (300 - 50));
    assert.equal(after.warehouse.wood, 20 - (6 - 3));
    assert.equal(after.warehouse.stone, 10 - 4);
  } finally {
    await cleanupGame(name);
  }
});

test("PlaceBuildings with a malformed buildings payload is a 400", async () => {
  const name = uniqueName();
  const { settlementId } = ids(name);
  const token = await seedGame(name, placeBuildingsSettlement(name));
  try {
    const missingKind = await postCommand(name, {
      kind: "PlaceBuildings",
      actor: 0,
      settlementId,
      buildings: [{ gx: 2, gy: 2, level: 1, style: "classic" }],
    }, token);
    assert.equal(missingKind.status, 400);

    const levelTooHigh = await postCommand(name, {
      kind: "PlaceBuildings",
      actor: 0,
      settlementId,
      buildings: [{ gx: 2, gy: 2, kind: "goldMine", level: 4, style: "classic" }],
    }, token);
    assert.equal(levelTooHigh.status, 400);
  } finally {
    await cleanupGame(name);
  }
});

test("PlaceBuildings the settlement cannot afford is a 409, not a silent placement", async () => {
  const name = uniqueName();
  const { settlementId } = ids(name);
  const broke = makeSettlement(ids(name).settlementId, 0, 2, 2, {
    gold: 100,
    warehouse: emptyWarehouse({ wood: 20, stone: 10 }),
    buildings: [],
  });
  const token = await seedGame(name, broke);
  try {
    const res = await postCommand(name, {
      kind: "PlaceBuildings",
      actor: 0,
      settlementId,
      buildings: [{ gx: 2, gy: 2, kind: "goldMine", level: 1, style: "classic" }],
    }, token);
    assert.equal(res.status, 409);
    assert.equal(((await res.json()) as { error: string }).error, "not_enough_gold");
  } finally {
    await cleanupGame(name);
  }
});

test("POST /games/:name/commands accepts CreateTradeRoute over HTTP and returns the routes array", async () => {
  const name = uniqueName();
  const ids0 = ids(name);
  const settlements = [
    makeSettlement(ids0.settlementId, 0, 2, 2, {
      gold: 1000,
      warehouse: emptyWarehouse({ wood: 100 }),
      buildings: [{ gx: 1, gy: 1, kind: "house", level: 1, style: "classic" }],
    }),
    makeSettlement("s1", 0, 6, 2, { warehouse: emptyWarehouse({ wood: 10 }) }),
  ];
  const players = [
    { ...makePlayer(0, "player" as const, ["h0"], [ids0.settlementId, "s1"]), wagonsOwned: 4, wagonsUnassigned: 4 },
    makePlayer(1, "ai" as const, ["h1"], []),
  ];
  const token = await seedGame(name, settlements[0], { players, extraSettlements: [settlements[1]] });
  try {
    const res = await postCommand(name, {
      kind: "CreateTradeRoute",
      actor: 0,
      fromSettlementId: ids0.settlementId,
      toSettlementId: "s1",
      resource: "wood",
      wagons: 2,
    }, token);
    assert.equal(res.status, 200, await res.clone().text());
    const body = (await res.json()) as { tradeRoutes?: Array<{ id: string; wagons: number; resource: string }> };
    assert.equal(body.tradeRoutes?.length, 1);
    assert.equal(body.tradeRoutes[0].wagons, 2);
    assert.equal(body.tradeRoutes[0].resource, "wood");
  } finally {
    await cleanupGame(name);
  }
});

test("CreateTradeRoute with no unassigned wagons is a 409", async () => {
  const name = uniqueName();
  const ids0 = ids(name);
  const settlements = [
    makeSettlement(ids0.settlementId, 0, 2, 2),
    makeSettlement("s1", 0, 6, 2),
  ];
  const players = [
    makePlayer(0, "player" as const, ["h0"], [ids0.settlementId, "s1"]),
    makePlayer(1, "ai" as const, ["h1"], []),
  ];
  const token = await seedGame(name, settlements[0], { players, extraSettlements: [settlements[1]] });
  try {
    const res = await postCommand(name, {
      kind: "CreateTradeRoute",
      actor: 0,
      fromSettlementId: ids0.settlementId,
      toSettlementId: "s1",
      resource: "wood",
      wagons: 2,
    }, token);
    assert.equal(res.status, 409);
    assert.equal(((await res.json()) as { error: string }).error, "not_enough_wagons_unassigned");
  } finally {
    await cleanupGame(name);
  }
});

test("CreateTradeRoute with a malformed payload is a 400", async () => {
  const name = uniqueName();
  const { settlementId } = ids(name);
  const token = await seedGame(name, makeSettlement(settlementId, 0, 2, 2));
  try {
    const res = await postCommand(name, {
      kind: "CreateTradeRoute",
      actor: 0,
      fromSettlementId: settlementId,
      toSettlementId: settlementId,
      resource: "unobtanium",
      wagons: 2,
    }, token);
    assert.equal(res.status, 400);
  } finally {
    await cleanupGame(name);
  }
});

test("UpgradeBuilding with a malformed requests payload is a 400, not a handler-level crash", async () => {  const name = uniqueName();
  const { settlementId } = ids(name);
  const token = await seedGame(name, buildingUpgradeSettlement(name));
  try {
    const missingKind = await postCommand(name, {
      kind: "UpgradeBuilding",
      actor: 0,
      settlementId,
      requests: [{ gx: 1, gy: 1 }],
    }, token);
    assert.equal(missingKind.status, 400);

    const notAnArray = await postCommand(name, {
      kind: "UpgradeBuilding",
      actor: 0,
      settlementId,
      requests: { gx: 1, gy: 1, kind: "market" },
    }, token);
    assert.equal(notAnArray.status, 400);
  } finally {
    await cleanupGame(name);
  }
});

test("UpgradeBuilding with an empty requests array reaches the reducer as a 409, not a 400", async () => {
  const name = uniqueName();
  const { settlementId } = ids(name);
  const token = await seedGame(name, buildingUpgradeSettlement(name));
  try {
    const res = await postCommand(name, {
      kind: "UpgradeBuilding",
      actor: 0,
      settlementId,
      requests: [],
    }, token);
    assert.equal(res.status, 409);
    assert.equal(((await res.json()) as { error: string }).error, "no_buildings");
  } finally {
    await cleanupGame(name);
  }
});

test("UpgradeSettlement with an out-of-domain upgradePopulationGate is a 400", async () => {
  const name = uniqueName();
  const { settlementId } = ids(name);
  const token = await seedGame(name, settlementUpgradeSettlement(name));
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
      }, token);
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

test("POST /games/:name/commands succeeds with no Authorization header at all -- sign-in is optional", async () => {
  const name = uniqueName();
  const { settlementId } = ids(name);
  // seedGame() logs in and claims seat 0 for setup convenience, but this
  // test's whole point is that an anonymous caller doesn't need any of
  // that: it never sends the resulting token.
  await seedGame(name, buildingUpgradeSettlement(name));
  try {
    const res = await fetch(`${baseUrl}/games/${name}/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "UpgradeBuilding",
        actor: 0,
        settlementId,
        requests: [{ gx: 1, gy: 1, kind: "market" }],
      }),
    });
    assert.equal(res.status, 200, await res.clone().text());
  } finally {
    await cleanupGame(name);
  }
});
