// Runs against the real dev Postgres (npm run db:up) -- same DB the dev
// environment already uses, per plan/2026-08-16-phase-3-parallel-dev-plan.md's
// Track 3.B exit criteria.
//
// Isolation note: the plan called for "each test isolated via transaction
// rollback," but GameRepo.saveHeroesAndSettlements opens and commits its
// own transaction internally (via withTransaction) rather than accepting an
// injected client -- there's no outer transaction to roll back around it
// without changing that interface. Each test instead seeds a uniquely-named
// row and deletes it in a finally block, which gives the same practical
// isolation (no cross-test interference, nothing left behind) without
// fighting the repo's own transaction ownership.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { HeroState, Player, SettlementState } from "@heroes/contracts";
import { pool } from "../../server/persistence/db";
import { makeEventRepo, makeGameRepo } from "../../server/persistence/repositories/gameRepo";

function uniqueName(label: string): string {
  return `test-gameRepo-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function insertTestGame(
  name: string,
  overrides: { players?: Player[]; heroes?: Record<string, HeroState>; settlements?: Record<string, SettlementState>; activePlayerId?: number } = {},
): Promise<number> {
  const players = overrides.players ?? [
    { id: 0, faction: "player" as const, name: "p0", color: "#000000", heroIds: [], settlementIds: [] },
  ];
  const heroes = overrides.heroes ?? {};
  const settlements = overrides.settlements ?? {};
  const r = await pool.query<{ id: number }>(
    `INSERT INTO games (name, seed, hero_q, hero_r, active_player_id, players, heroes, settlements)
     VALUES ($1, 0, 0, 0, $2, $3::jsonb, $4::jsonb, $5::jsonb)
     RETURNING id`,
    [name, overrides.activePlayerId ?? 0, JSON.stringify(players), JSON.stringify(heroes), JSON.stringify(settlements)],
  );
  return r.rows[0].id;
}

async function deleteTestGame(name: string): Promise<void> {
  await pool.query(`DELETE FROM games WHERE name = $1`, [name]);
}

test("gameRepo.load returns the seeded row", async () => {
  const name = uniqueName("load");
  const hero: HeroState = {
    id: "h0",
    name: "h0",
    ownerId: 0,
    q: 3,
    r: 4,
    movementRemaining: 7,
    previousQ: null,
    previousR: null,
    previousMovementRemaining: null,
    trail: [],
    gold: 12,
    troops: 1,
    stacks: [],
    isChartering: false,
    charterId: null,
    horseVariant: "bubbly",
  };
  await insertTestGame(name, { heroes: { h0: hero } });
  try {
    const repo = makeGameRepo();
    const row = await repo.load(name);
    assert.equal(row.name, name);
    assert.equal(row.heroes.h0.q, 3);
    assert.equal(row.heroes.h0.gold, 12);
  } finally {
    await deleteTestGame(name);
  }
});

test("gameRepo.load rejects an unknown game name", async () => {
  const repo = makeGameRepo();
  await assert.rejects(() => repo.load(uniqueName("missing")));
});

test("gameRepo.saveHeroesAndSettlements persists heroes/settlements and recomputes legacy gold", async () => {
  const name = uniqueName("save");
  await insertTestGame(name, {
    players: [{ id: 0, faction: "player", name: "p0", color: "#000000", heroIds: ["h0"], settlementIds: ["s0"] }],
  });
  try {
    const repo = makeGameRepo();
    const heroes: Record<string, HeroState> = {
      h0: {
        id: "h0",
        name: "h0",
        ownerId: 0,
        q: 1,
        r: 1,
        movementRemaining: 7,
        previousQ: null,
        previousR: null,
        previousMovementRemaining: null,
        trail: [],
        gold: 30,
        troops: 1,
        stacks: [],
        isChartering: false,
        charterId: null,
        horseVariant: "bubbly",
      },
    };
    const settlements: Record<string, SettlementState> = {
      s0: {
        id: "s0",
        name: "s0",
        ownerId: 0,
        q: 1,
        r: 1,
        level: 1,
        population: 0,
        goldTax: 0,
        resourceRates: {},
        foundedOnResource: null,
        gold: 20,
        warehouse: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 },
        citySpots: [],
        cityMines: [],
        morale: 100,
        autoTrade: true,
        castleVariant: 0,
        buildings: [],
      },
    };
    await repo.saveHeroesAndSettlements(name, heroes, settlements);

    const row = await repo.load(name);
    assert.equal(row.heroes.h0.gold, 30);
    assert.equal(row.settlements.s0.gold, 20);
    assert.equal(row.gold, 50); // sumPlayerGold: 30 (hero) + 20 (settlement)
  } finally {
    await deleteTestGame(name);
  }
});

test("eventRepo.append inserts a game_events row", async () => {
  const name = uniqueName("events");
  const gameId = await insertTestGame(name);
  try {
    const eventRepo = makeEventRepo();
    await eventRepo.append(gameId, "move_completed", { heroId: "h0" });
    const r = await pool.query<{ kind: string; payload: { heroId: string } }>(
      `SELECT kind, payload FROM game_events WHERE game_id = $1`,
      [gameId],
    );
    assert.equal(r.rowCount, 1);
    assert.equal(r.rows[0].kind, "move_completed");
    assert.equal(r.rows[0].payload.heroId, "h0");
  } finally {
    await deleteTestGame(name);
  }
});
