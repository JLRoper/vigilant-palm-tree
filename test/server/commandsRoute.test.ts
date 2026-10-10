import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { normalizePlatoons } from "@heroes/engine";
import type { HeroId, HeroState, SettlementId, SettlementState } from "@heroes/contracts";
import { pool } from "../../server/persistence/db";
import { createSettlementRepo } from "../../server/persistence/repositories/settlementRepo";
import { router } from "../../server/routes";
import { errorHandler } from "../../server/errorHandler";
import { getPresence } from "../../server/app/dropPolicy";
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
  opts?: { players?: Player[]; extraSettlements?: SettlementState[]; heroes?: Record<HeroId, HeroState> },
): Promise<string> {
  const { heroId } = ids(name);
  const heroes = opts?.heroes ?? { [heroId]: makeHero(heroId, 0, 2, 2) };
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

test("POST /games/:name/commands accepts a style-less PlaceBuildings entry and resolves the style server-side", async () => {
  const name = uniqueName();
  const { settlementId } = ids(name);
  const token = await seedGame(name, placeBuildingsSettlement(name));
  try {
    const res = await postCommand(name, {
      kind: "PlaceBuildings",
      actor: 0,
      settlementId,
      buildings: [{ gx: 2, gy: 2, kind: "goldMine", level: 1 }],
    }, token);
    assert.equal(res.status, 200, await res.clone().text());
    // style is optional on the wire now; the still-NOT NULL
    // settlement_buildings.style column is fed by the engine resolver at the
    // repo write boundary, never by trusting the client's value.
    const repo = createSettlementRepo(pool);
    const [loaded] = await repo.loadAllForGame(name);
    const mine = loaded?.buildings.find((b) => b.kind === "goldMine");
    assert.ok(mine, "the placed mine round-trips through the granular read path");
    assert.equal(mine.style, "pixel", "an absent style is resolved, not written NULL");
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
      from: { kind: "settlement", id: ids0.settlementId },
      to: { kind: "settlement", id: "s1" },
      payload: { kind: "resource", resource: "wood" },
      wagons: 2,
    }, token);
    assert.equal(res.status, 200, await res.clone().text());
    const body = (await res.json()) as {
      tradeRoutes?: Array<{
        id: string;
        wagons: number;
        from: { kind: string; id: string };
        to: { kind: string; id: string };
        payload: { kind: string; resource?: string };
      }>;
    };
    assert.equal(body.tradeRoutes?.length, 1);
    assert.equal(body.tradeRoutes[0].wagons, 2);
    assert.deepEqual(body.tradeRoutes[0].from, { kind: "settlement", id: ids0.settlementId });
    assert.deepEqual(body.tradeRoutes[0].to, { kind: "settlement", id: "s1" });
    assert.deepEqual(body.tradeRoutes[0].payload, { kind: "resource", resource: "wood" });
  } finally {
    await cleanupGame(name);
  }
});

test("CreateTradeRoute to a hero endpoint with a gold payload rides the same HTTP path", async () => {
  const name = uniqueName();
  const { heroId, settlementId } = ids(name);
  const players = [
    { ...makePlayer(0, "player" as const, [heroId], [settlementId]), wagonsOwned: 2, wagonsUnassigned: 2 },
    makePlayer(1, "ai" as const, ["h1"], []),
  ];
  const token = await seedGame(name, makeSettlement(settlementId, 0, 2, 2, { gold: 2500 }), {
    players,
    // Off the settlement tile: a hero standing ON the origin settlement is a
    // same-tile pair, rejected at create (the L1 stall guard).
    heroes: { [heroId]: makeHero(heroId, 0, 4, 2) },
  });
  try {
    const res = await postCommand(name, {
      kind: "CreateTradeRoute",
      actor: 0,
      from: { kind: "settlement", id: settlementId },
      to: { kind: "hero", id: heroId },
      payload: { kind: "gold" },
      wagons: 1,
    }, token);
    assert.equal(res.status, 200, await res.clone().text());
    const body = (await res.json()) as {
      tradeRoutes?: Array<{ to: { kind: string; id: string }; payload: { kind: string } }>;
    };
    assert.deepEqual(body.tradeRoutes?.[0]?.to, { kind: "hero", id: heroId }, "the hero endpoint survives the round-trip");
    assert.deepEqual(body.tradeRoutes?.[0]?.payload, { kind: "gold" }, "a treasure caravan is creatable over the wire");
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
      from: { kind: "settlement", id: ids0.settlementId },
      to: { kind: "settlement", id: "s1" },
      payload: { kind: "resource", resource: "wood" },
      wagons: 2,
    }, token);
    assert.equal(res.status, 409);
    assert.equal(((await res.json()) as { error: string }).error, "not_enough_wagons_unassigned");
  } finally {
    await cleanupGame(name);
  }
});

test("CreateTradeRoute with a malformed endpoint or payload shape is a 400", async () => {
  const name = uniqueName();
  const { settlementId } = ids(name);
  const token = await seedGame(name, makeSettlement(settlementId, 0, 2, 2));
  const wellFormed = {
    kind: "CreateTradeRoute",
    actor: 0,
    from: { kind: "settlement", id: settlementId },
    to: { kind: "settlement", id: "s1" },
    payload: { kind: "resource", resource: "wood" },
    wagons: 2,
  };
  try {
    const badEndpointKind = await postCommand(name, {
      ...wellFormed,
      from: { kind: "village", id: settlementId },
    }, token);
    assert.equal(badEndpointKind.status, 400, "endpoint kind must be one of the two literals");

    const missingEndpointId = await postCommand(name, {
      ...wellFormed,
      from: { kind: "settlement" },
    }, token);
    assert.equal(missingEndpointId.status, 400, "endpoint ids must be non-empty strings");

    const endpointNotAnObject = await postCommand(name, {
      ...wellFormed,
      to: "s1",
    }, token);
    assert.equal(endpointNotAnObject.status, 400);

    const badPayloadKind = await postCommand(name, {
      ...wellFormed,
      payload: { kind: "silver" },
    }, token);
    assert.equal(badPayloadKind.status, 400, "payload kind must be gold or resource");

    const badPayloadResource = await postCommand(name, {
      ...wellFormed,
      payload: { kind: "resource", resource: "unobtanium" },
    }, token);
    assert.equal(badPayloadResource.status, 400);

    const legacyBody = await postCommand(name, {
      kind: "CreateTradeRoute",
      actor: 0,
      fromSettlementId: settlementId,
      toSettlementId: "s1",
      resource: "wood",
      wagons: 2,
    }, token);
    assert.equal(legacyBody.status, 400, "the legacy flat body is malformed on the wire -- only persisted rows normalize");

    const badWagons = await postCommand(name, {
      ...wellFormed,
      wagons: 0,
    }, token);
    assert.equal(badWagons.status, 400);
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

test("UpgradeSettlement ignores a stale/spoofed upgradePopulationGate field (issue #153)", async () => {
  const name = uniqueName();
  const { settlementId } = ids(name);
  const token = await seedGame(name, settlementUpgradeSettlement(name));
  try {
    // The population requirement is server-owned now (UPGRADE_POPULATION_GATE
    // in the engine), so the former client-supplied gate is just an extra
    // body field: ignored, not validated, not honored. No value may 400
    // anymore; the first (a real upgrade command) proceeds on its merits and
    // the rest hit upgrade_in_progress once it has started.
    let first = true;
    for (const upgradePopulationGate of [1.5, -0.1, "0.85", 0]) {
      const res = await postCommand(name, {
        kind: "UpgradeSettlement",
        actor: 0,
        settlementId,
        upgradePopulationGate,
      }, token);
      assert.notEqual(
        res.status,
        400,
        `gate ${JSON.stringify(upgradePopulationGate)} should be ignored, not rejected`,
      );
      if (first) {
        assert.equal(res.status, 200, await res.clone().text());
        first = false;
      }
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

// Regression pin (2026-09-29 hero-outcomes follow-up): the route's response
// mapping whitelisted fields and dropped attackerVerdict/defenderVerdict --
// the handler returned them, but the client's resolve/submit merges
// (turnHooks/GameActions) never received them over HTTP. Drives the full
// path for SubmitBattleResult (which rides the same res.json mapping as
// ResolveBattle) through a real retreat over a seeded adjacent pair, and
// doubles as the HTTP-level pin for the denormalized `troops` counter being
// zeroed with the retreated stacks.
test("SubmitBattleResult over HTTP returns the per-hero verdicts and both heroes (retreat)", async () => {
  const name = uniqueName();
  const { heroId, settlementId } = ids(name);
  const defenderId: HeroId = `${name}-h1`;
  // Adjacent enemy pair (h0 at (2,2), h1 at (2,3)) with the owned settlement
  // s0 under the attacker -- the canonical collision shape, seeded through
  // the legacy JSONB columns like the rest of this file.
  const token = await seedGame(name, makeSettlement(settlementId, 0, 2, 2), {
    players: [
      makePlayer(0, "player", [heroId], [settlementId]),
      makePlayer(1, "ai", [defenderId], []),
    ],
    heroes: {
      [heroId]: makeHero(heroId, 0, 2, 2, {
        gold: 100,
        troops: 5,
        stacks: [{ entries: [{ unitTypeId: "swordsman", count: 5 }] }],
      }),
      [defenderId]: makeHero(defenderId, 1, 2, 3, {
        gold: 250,
        troops: 4,
        stacks: [{ entries: [{ unitTypeId: "swordsman", count: 4 }] }],
      }),
    },
  });
  try {
    const res = await postCommand(name, {
      kind: "SubmitBattleResult",
      actor: 0,
      attackerId: heroId,
      defenderId,
      outcome: "retreat",
      attackerStacks: [{ entries: [{ unitTypeId: "swordsman", count: 3 }] }],
      defenderStacks: [{ entries: [{ unitTypeId: "swordsman", count: 2 }] }],
      rounds: 5,
      obstacleSeed: 42,
    }, token);
    assert.equal(res.status, 200, await res.clone().text());
    const body = (await res.json()) as {
      attackerVerdict?: string;
      defenderVerdict?: string;
      attackerHero?: HeroState;
      defenderHero?: HeroState;
      events?: Array<{ type: string }>;
    };
    assert.equal(body.attackerVerdict, "retreated");
    assert.equal(body.defenderVerdict, "stood");
    assert.equal(body.events?.[0]?.type, "BattleResolved");
    assert.equal(body.attackerHero?.q, 2, "the retreated attacker relocated to the nearest owned settlement");
    assert.equal(body.attackerHero?.r, 2);
    assert.deepEqual(body.attackerHero?.stacks, normalizePlatoons([]), "retreat empties the stacks server-side");
    assert.equal(body.attackerHero?.troops, 0, "the denormalized troops counter is zeroed with the stacks");
    assert.deepEqual(
      body.defenderHero?.stacks,
      normalizePlatoons([{ entries: [{ unitTypeId: "swordsman", count: 2 }] }]),
      "the standing defender keeps their submitted survivors",
    );
  } finally {
    await cleanupGame(name);
  }
});

// ---------------------------------------------------------------------------
// D10 (plan/2026-09-30-server-side-ai-actor.md): the ai-seat route block.
// A server-driven game's AI seats are driven exclusively by the in-process
// aiDriver (server/app/aiDriver.ts); client-origin commands naming such a
// seat are 403'd BEFORE touchSeat, so AI seats never enter the presence
// map. These pins drive the real Express + real Postgres harness above.
// ---------------------------------------------------------------------------

const ROUTE_TEST_PLAYERS = [
  { id: 0, faction: "player", name: "P0", color: "#000000", heroIds: [], settlementIds: [] },
  { id: 1, faction: "ai", name: "AI", color: "#111111", heroIds: [], settlementIds: [] },
];

async function seedAiDriverGame(
  name: string,
  opts: { aiDriver: boolean; activePlayerId: number },
): Promise<void> {
  const { heroId, settlementId } = ids(name);
  const heroes = { [heroId]: makeHero(heroId, 0, 2, 2) };
  const settlement = makeSettlement(settlementId, 0, 2, 2);
  await pool.query(
    `INSERT INTO games (name, seed, hero_q, hero_r, active_player_id, players, heroes, settlements, map_size, lobby)
     VALUES ($1, 1, 2, 2, $2, $3::jsonb, $4::jsonb, $5::jsonb, 'small', $6::jsonb)`,
    [
      name,
      opts.activePlayerId,
      JSON.stringify(ROUTE_TEST_PLAYERS),
      JSON.stringify(heroes),
      JSON.stringify({ [settlementId]: settlement }),
      JSON.stringify(opts.aiDriver ? { aiDriver: "server" } : {}),
    ],
  );
}

test("D10: an AI-seat command on a server-driven game is 403 ai_seat_command_forbidden before any presence write", async () => {
  const name = uniqueName();
  await seedAiDriverGame(name, { aiDriver: true, activePlayerId: 1 });
  try {
    const res = await fetch(`${baseUrl}/games/${name}/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "EndTurn", actor: 1 }),
    });
    assert.equal(res.status, 403, await res.clone().text());
    assert.deepEqual(await res.json(), { error: "ai_seat_command_forbidden" });
    // The block sits BEFORE touchSeat: the AI seat never entered the
    // presence map, so the drop-policy skip machinery never sees it.
    assert.equal(getPresence(name)["1"], undefined, "no presence entry for the AI seat");
    assert.equal(getPresence(name)["0"], undefined, "no presence entry for any seat");
    const events = await pool.query(
      `SELECT 1 FROM game_events WHERE kind = 'TurnEnded'
        AND game_id = (SELECT id FROM games WHERE name = $1)`,
      [name],
    );
    assert.equal(events.rowCount, 0, "the command never reached the handler");
  } finally {
    await cleanupGame(name);
  }
});

// Gold above every pot cap so the BankGold shape gate is the only thing under
// test here (not affordability), and a bank with a pot so the pot-preservation
// test below has something to preserve.
function bankSettlement(name: string): SettlementState {
  return makeSettlement(ids(name).settlementId, 0, 2, 2, {
    gold: 100000,
    warehouse: emptyWarehouse({ wood: 100, stone: 100 }),
    buildings: [
      { gx: 1, gy: 1, kind: "bank", level: 2, style: "classic", bank: { gold: 1234, pendingOut: [{ gold: 200, maturesOnDay: 17 }] } },
    ],
  });
}

test("POST /games/:name/commands accepts BankGold over HTTP (was a 400 -- parseCommand had no branch for it)", async () => {
  const name = uniqueName();
  const { settlementId } = ids(name);
  const token = await seedGame(name, bankSettlement(name));
  try {
    const res = await postCommand(name, {
      kind: "BankGold",
      actor: 0,
      settlementId,
      gx: 1,
      gy: 1,
      amount: 500,
      direction: "deposit",
    }, token);
    assert.equal(res.status, 200, await res.clone().text());
    const body = (await res.json()) as { settlement?: SettlementState; events?: { type: string }[] };
    assert.equal(body.settlement?.gold, 100000 - 500);
    assert.equal(body.settlement?.buildings[0].bank?.gold, 1234 + 500);
    assert.deepEqual(body.settlement?.buildings[0].bank?.pendingOut, [{ gold: 200, maturesOnDay: 17 }]);

    // The event row the command appended must exist under its own kind, so a
    // poller picking it up by kind sees it.
    const events = await pool.query<{ kind: string; payload: { amount: number; direction: string } }>(
      `SELECT kind, payload FROM game_events WHERE game_id = (SELECT id FROM games WHERE name = $1) AND kind = 'BankGoldMoved'`,
      [name],
    );
    assert.equal(events.rowCount, 1);
    assert.equal(events.rows[0].payload.amount, 500);
    assert.equal(events.rows[0].payload.direction, "deposit");

    // ...and the withdraw direction of the same command kind.
    const withdraw = await postCommand(name, {
      kind: "BankGold",
      actor: 0,
      settlementId,
      gx: 1,
      gy: 1,
      amount: 500,
      direction: "withdraw",
    }, token);
    assert.equal(withdraw.status, 200, await withdraw.clone().text());
    const wbody = (await withdraw.json()) as { settlement?: SettlementState };
    assert.equal(wbody.settlement?.buildings[0].bank?.gold, 1234);
    assert.equal(wbody.settlement?.buildings[0].bank?.pendingOut?.length, 2);
  } finally {
    await cleanupGame(name);
  }
});

test("BankGold with a malformed field is a 400, not a handler-level crash", async () => {
  const name = uniqueName();
  const { settlementId } = ids(name);
  const token = await seedGame(name, bankSettlement(name));
  const base = {
    kind: "BankGold",
    actor: 0,
    settlementId,
    gx: 1,
    gy: 1,
    amount: 100,
    direction: "deposit",
  };
  const bad: unknown[] = [
    { ...base, settlementId: 7 },
    { ...base, gx: -1 },
    { ...base, gy: 1.5 },
    { ...base, amount: 0 },
    { ...base, amount: -100 },
    { ...base, amount: 12.5 },
    { ...base, amount: 2_000_000 },
    { ...base, direction: "drip" },
    { ...base, direction: undefined },
  ];
  try {
    for (const body of bad) {
      const res = await postCommand(name, body, token);
      assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(body)}`);
    }
  } finally {
    await cleanupGame(name);
  }
});

test("PlaceBuildings keeps a bank pot through an unrelated commit (bank must not be stripped)", async () => {
  const name = uniqueName();
  const { settlementId } = ids(name);
  const token = await seedGame(name, bankSettlement(name));
  try {
    const res = await postCommand(name, {
      kind: "PlaceBuildings",
      actor: 0,
      settlementId,
      buildings: [
        // The same bank, untouched -- its pot must round-trip verbatim.
        { gx: 1, gy: 1, kind: "bank", level: 2, style: "classic", bank: { gold: 1234, pendingOut: [{ gold: 200, maturesOnDay: 17 }] } },
        // ...plus a brand-new pot-less bank.
        { gx: 3, gy: 3, kind: "bank", level: 1, style: "classic" },
      ],
    }, token);
    assert.equal(res.status, 200, await res.clone().text());
    const body = (await res.json()) as { settlement?: SettlementState };
    assert.equal(body.settlement?.buildings.length, 2);
    assert.deepEqual(body.settlement?.buildings[0].bank, {
      gold: 1234,
      pendingOut: [{ gold: 200, maturesOnDay: 17 }],
    });
    assert.equal(body.settlement?.buildings[1].bank, undefined);

    // ...and it survives the DB round-trip too (settlement_buildings.bank JSONB).
    const stored = await pool.query<{ bank: { gold: number } | null }>(
      `SELECT bank FROM settlement_buildings WHERE settlement_id = $1 AND gx = 1 AND gy = 1`,
      [settlementId],
    );
    assert.equal(stored.rows[0]?.bank?.gold, 1234);
  } finally {
    await cleanupGame(name);
  }
});

test("PlaceBuildings rejects a malformed bank pot with a 400", async () => {
  const name = uniqueName();
  const { settlementId } = ids(name);
  const token = await seedGame(name, bankSettlement(name));
  const mk = (bank: unknown) => ({
    kind: "PlaceBuildings",
    actor: 0,
    settlementId,
    buildings: [{ gx: 1, gy: 1, kind: "bank", level: 2, style: "classic", bank }],
  });
  try {
    for (const bank of [{ gold: -1 }, { gold: 1.5 }, { gold: 10, pendingOut: "soon" }, { gold: 10, pendingOut: [{ gold: -1, maturesOnDay: 3 }] }, { pendingOut: [] }]) {
      const res = await postCommand(name, mk(bank), token);
      assert.equal(res.status, 400, `expected 400 for pot ${JSON.stringify(bank)}`);
    }
  } finally {
    await cleanupGame(name);
  }
});

test("D10: the same AI-seat command on an unflagged game keeps today's behavior (accepted)", async () => {
  const name = uniqueName();
  await seedAiDriverGame(name, { aiDriver: false, activePlayerId: 1 });
  try {
    const res = await fetch(`${baseUrl}/games/${name}/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "EndTurn", actor: 1 }),
    });
    assert.equal(res.status, 200, await res.clone().text());
    const active = await pool.query<{ active_player_id: number }>(
      `SELECT active_player_id FROM games WHERE name = $1`,
      [name],
    );
    assert.equal(active.rows[0].active_player_id, 0, "the EndTurn ran the real pipeline");
  } finally {
    await cleanupGame(name);
  }
});

test("D10: a human actor on a server-driven game is accepted", async () => {
  const name = uniqueName();
  await seedAiDriverGame(name, { aiDriver: true, activePlayerId: 0 });
  try {
    const res = await fetch(`${baseUrl}/games/${name}/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "EndTurn", actor: 0 }),
    });
    assert.equal(res.status, 200, await res.clone().text());
    const active = await pool.query<{ active_player_id: number }>(
      `SELECT active_player_id FROM games WHERE name = $1`,
      [name],
    );
    assert.equal(active.rows[0].active_player_id, 1, "the human's EndTurn ran and advanced to the AI seat");
  } finally {
    await cleanupGame(name);
  }
});
