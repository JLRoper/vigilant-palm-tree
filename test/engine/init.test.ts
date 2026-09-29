import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GameMap,
  MAX_PLAYERS,
  buildInitialGameState,
  createInitialState,
  demoPlatoonsForPlayer,
  makeInitialStatePayload,
  mulberry32,
} from "@heroes/engine";

function build(opts?: Parameters<typeof buildInitialGameState>[2]) {
  return buildInitialGameState(new GameMap(7, "small"), mulberry32(42), opts);
}

function troopSumOf(hero: { stacks: { entries: { count: number }[] }[] } | undefined): number {
  if (!hero) return 0;
  return hero.stacks.reduce(
    (sum, platoon) => sum + platoon.entries.reduce((s, e) => s + e.count, 0),
    0,
  );
}

function settlementsOwnedBy(state: ReturnType<typeof build>, ownerId: number): string[] {
  return Object.values(state.settlements)
    .filter((s) => s.ownerId === ownerId)
    .map((s) => s.id);
}

test("enemyCount 2 + humanSeatCount 1 builds 3 seats with AI factions, names, heroes, and castles", () => {
  const state = build({ enemyCount: 2, humanSeatCount: 1 });
  assert.equal(state.players.length, 3);
  assert.equal(state.players[0].faction, "player");
  assert.equal(state.players[0].name, "Player 1");
  assert.equal(state.players[1].faction, "ai");
  assert.equal(state.players[1].name, "AI 1");
  assert.equal(state.players[2].faction, "ai");
  assert.equal(state.players[2].name, "AI 2");

  const heroIds = state.players.map((p) => p.heroIds).flat();
  assert.equal(heroIds.length, 3);
  assert.deepEqual(heroIds, ["p0-hero", "p1-hero", "p2-hero"]);
  assert.equal(state.heroes["p0-hero"].name, "Commander");
  assert.equal(state.heroes["p1-hero"].name, "Warlord");
  assert.equal(state.heroes["p2-hero"].name, "Warlord");

  assert.equal(state.heroes["p0-hero"].ownerId, 0);
  assert.equal(state.heroes["p1-hero"].ownerId, 1);
  assert.equal(state.heroes["p2-hero"].ownerId, 2);

  assert.equal(settlementsOwnedBy(state, 1).length, 1);
  assert.equal(settlementsOwnedBy(state, 2).length, 1);
  assert.equal(state.settlements[state.players[1].settlementIds[0]].ownerId, 1);
  assert.equal(state.settlements[state.players[2].settlementIds[0]].ownerId, 2);
});

test("enemyCount absent produces the same snapshot as before the option existed", () => {
  const legacy = build();
  const withEmptyOpts = build({});
  assert.deepEqual(withEmptyOpts, legacy);
  assert.equal(legacy.players.length, 3);
  assert.equal(legacy.players[1].faction, "ai");
  assert.equal(legacy.players[2].faction, "ai");
});

test("enemyCount 0 ignores an explicit playerCount and yields only the human seats", () => {
  const state = build({ enemyCount: 0, humanSeatCount: 2, playerCount: 5 });
  assert.equal(state.players.length, 2);
  assert.equal(state.players[0].faction, "player");
  assert.equal(state.players[1].faction, "player");
});

test("enemyCount is clamped so human seats + enemies never exceed MAX_PLAYERS", () => {
  const a = build({ enemyCount: 4, humanSeatCount: 8 });
  assert.equal(a.players.length, MAX_PLAYERS);
  assert.equal(a.players.filter((p) => p.faction === "player").length, 8);
  assert.equal(a.players.filter((p) => p.faction === "ai").length, 2);

  const b = build({ enemyCount: 3, humanSeatCount: 10 });
  assert.equal(b.players.length, MAX_PLAYERS);
  assert.equal(b.players.filter((p) => p.faction === "ai").length, 0);
});

test("castleCount below the derived playerCount still yields at least playerCount castles", () => {
  const state = build({ enemyCount: 2, humanSeatCount: 1, castleCount: 2 });
  assert.equal(state.players.length, 3);
  assert.ok(Object.keys(state.settlements).length >= 3);
  assert.ok(state.castleCount >= 3);
  for (const p of state.players) {
    assert.ok(settlementsOwnedBy(state, p.id).length >= 1, `player ${p.id} has no castle`);
  }
});

test("makeInitialStatePayload derives the same seat split from enemyCount", () => {
  const payload = makeInitialStatePayload(
    new GameMap(7, "small"),
    mulberry32(42),
    { enemyCount: 2, humanSeatCount: 1 },
  );
  assert.equal(payload.players.length, 3);
  assert.equal(payload.players[1].faction, "ai");
  assert.equal(payload.players[1].name, "AI 1");
  assert.equal(payload.players[2].faction, "ai");
  assert.equal(payload.players[2].name, "AI 2");
  assert.equal(Object.keys(payload.heroes).length, 3);
  assert.equal(payload.heroes["p2-hero"].name, "Warlord");
  assert.ok(Object.values(payload.settlements).some((s) => s.ownerId === 2));
});

test("makeInitialStatePayload keeps legacy behavior when enemyCount is absent", () => {
  const legacy = makeInitialStatePayload(new GameMap(7, "small"), mulberry32(42));
  const withEmptyOpts = makeInitialStatePayload(new GameMap(7, "small"), mulberry32(42), {});
  assert.deepEqual(withEmptyOpts, legacy);
  assert.equal(legacy.players.length, 3);
});

test("non-finite enemyCount falls back to legacy behavior", () => {
  const legacy = build();
  const nan = build({ enemyCount: NaN });
  assert.deepEqual(nan, legacy);
});

test("every spawned hero across 1 human + 3 AI seats has a non-empty starter army", () => {
  const state = build({ enemyCount: 3, humanSeatCount: 1 });
  assert.equal(state.players.length, 4);
  for (const p of state.players) {
    const hero = state.heroes[p.heroIds[0]];
    assert.ok(hero, `player ${p.id} has a hero`);
    const sum = troopSumOf(hero);
    assert.ok(sum > 0, `player ${p.id} (seat ${p.id}) spawns with troops, got ${sum}`);
    assert.equal(hero.troops, sum, `player ${p.id} troops field matches platoon sum`);
    assert.ok(
      hero.stacks.some((pl) => pl.entries.some((e) => e.count > 0)),
      `player ${p.id} has at least one non-empty platoon`,
    );
  }
});

test("seat 2 (the regression) spawns with the cycled seat-0 composition: 24 troops", () => {
  const state = build({ enemyCount: 2, humanSeatCount: 1 });
  const h2 = state.heroes["p2-hero"];
  assert.ok(h2);
  assert.equal(h2.troops, 24);
  assert.deepEqual(troopSumOf(h2), 24);
  assert.deepEqual(
    h2.stacks.filter((pl) => pl.entries.length > 0).map((pl) => pl.entries.map((e) => e.unitTypeId)),
    [["swordsman"], ["archer"], ["cavalry"]],
  );
});

test("demoPlatoonsForPlayer cycles deterministically for every seat up to MAX_PLAYERS", () => {
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const platoons = demoPlatoonsForPlayer(i);
    assert.ok(
      platoons.some((pl) => pl.entries.some((e) => e.count > 0)),
      `seat ${i} gets a non-empty demo army`,
    );
    const expected = demoPlatoonsForPlayer(i % 2);
    assert.deepEqual(
      platoons.map((pl) => pl.entries),
      expected.map((pl) => pl.entries),
      `seat ${i} matches the cycled composition of seat ${i % 2}`,
    );
  }
});

test("legacy default hero fixtures keep their exact starter armies", () => {
  const state = createInitialState();
  assert.equal(state.heroes["h0"].troops, 24);
  assert.equal(state.heroes["h1"].troops, 13);
  assert.equal(troopSumOf(state.heroes["h0"]), 24);
  assert.equal(troopSumOf(state.heroes["h1"]), 13);
});
