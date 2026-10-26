import { test } from "node:test";
import assert from "node:assert/strict";
import { hydrateClientGame } from "../../src/io/hydrateClientGame";
import type { Game } from "../../src/io/api";
import type { CharterState } from "@heroes/contracts";
import { makeCharter, makeHero, makePlayer, makeSettlement } from "../charter/_helpers";

// An API-shaped game row: the raw GET /games/:name response, whose
// pending-battle marker is nested under the untyped `lobby` jsonb bag.
// Distinct from test/engine/pendingBattle.test.ts's HydratableGameRow
// fixtures -- the point here is that hydrateClientGame maps
// `lobby.pendingBattle` onto the top-level field hydrateGameState reads.
// The `lobby` parameter goes through `unknown` because the wire delivers
// unvalidated jsonb; malformed shapes are exactly what these cases pin.
function apiGame(lobby: unknown, activeFaction: "player" | "ai" = "player"): Game {
  return {
    id: 1,
    name: "client-pending-battle",
    seed: 1,
    hero_q: 2,
    hero_r: 2,
    turn: 1,
    gold: 0,
    enemy_positions: [],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    round: 3,
    day: 9,
    active_player_id: activeFaction === "ai" ? 1 : 0,
    players: [makePlayer(0, "player", ["h0"], ["s0"]), makePlayer(1, "ai", ["h1"], [])],
    heroes: { h0: makeHero("h0", 0, 2, 2), h1: makeHero("h1", 1, 18, 4) },
    settlements: { s0: makeSettlement("s0", 0, 2, 2) },
    lobby: lobby as Game["lobby"],
  };
}

const validMarker = { attackerId: "h1", defenderId: "h0", since: 9 };

test("a well-formed lobby.pendingBattle hydrates to a BATTLE phase with the offered pair", () => {
  const state = hydrateClientGame(apiGame({ pendingBattle: validMarker }));
  assert.deepEqual(state.phase, { kind: "BATTLE", attackerId: "h1", defenderId: "h0" });
});

test("the nested marker overrides the faction-derived phase in either direction", () => {
  // AI active (the AI attacker's own turn): still BATTLE, not AI_TURN.
  assert.deepEqual(hydrateClientGame(apiGame({ pendingBattle: validMarker }, "ai")).phase, {
    kind: "BATTLE",
    attackerId: "h1",
    defenderId: "h0",
  });
  // Human active: still BATTLE, not PLAYER_TURN.
  assert.deepEqual(hydrateClientGame(apiGame({ pendingBattle: validMarker }, "player")).phase, {
    kind: "BATTLE",
    attackerId: "h1",
    defenderId: "h0",
  });
});

test("without the marker the phase stays faction-derived", () => {
  assert.deepEqual(hydrateClientGame(apiGame({})).phase, { kind: "PLAYER_TURN", playerId: 0 });
  assert.deepEqual(hydrateClientGame(apiGame({}, "ai")).phase, { kind: "AI_TURN", playerId: 1 });
  // Absent lobby entirely: same fallback.
  assert.deepEqual(hydrateClientGame(apiGame(undefined, "ai")).phase, {
    kind: "AI_TURN",
    playerId: 1,
  });
});

test("a malformed lobby.pendingBattle is ignored, falling back to the faction-derived phase", () => {
  const malformed: unknown[] = [
    { pendingBattle: { attackerId: "h1", defenderId: "h0" } }, // missing since
    { pendingBattle: { attackerId: 7, defenderId: "h0", since: 9 } }, // non-string attackerId
    { pendingBattle: { attackerId: "h1", defenderId: "h0", since: Number.NaN } }, // non-finite since
    { pendingBattle: "battle" }, // marker is not an object
    { pendingBattle: null }, // explicit null
  ];
  for (const lobby of malformed) {
    const state = hydrateClientGame(apiGame(lobby, "ai"));
    assert.deepEqual(
      state.phase,
      { kind: "AI_TURN", playerId: 1 },
      `lobby: ${JSON.stringify(lobby)}`,
    );
  }
});

// ---------------------------------------------------------------------------
// C-BLOCKER-1: the API's `charters` array is the client's only source for
// GameState.activeCharters (a charter lives in its own table, with no JSONB
// column behind it). Before this mapping a reload hydrated activeCharters: []
// while heroes.<id>.isChartering survived -- advanceAutoTravel() had nothing to
// walk, no settlement was ever founded, and the hero stayed locked for good.
// ---------------------------------------------------------------------------

function apiGameWithCharters(
  charters: CharterState[] | undefined,
  heroOverrides: Partial<ReturnType<typeof makeHero>> = {},
): Game {
  return {
    ...apiGame({}),
    heroes: { h0: makeHero("h0", 0, 2, 2, heroOverrides), h1: makeHero("h1", 1, 18, 4) },
    ...(charters === undefined ? {} : { charters }),
  } as Game;
}

test("the API's charters array hydrates into activeCharters, so a reload keeps an in-flight charter", () => {
  const charter = makeCharter({
    id: "ch0",
    heroId: "h0",
    ownerId: 0,
    phase: "traveling",
    daysRemaining: 10,
    targetQ: 12,
    targetR: 4,
    settlementName: "Ember pass",
    settlementId: "s7",
  });

  const state = hydrateClientGame(apiGameWithCharters([charter], { isChartering: true, charterId: "ch0" }));

  assert.deepEqual(state.activeCharters, [charter], "the in-flight charter survives the reload byte-for-byte");
  assert.equal(state.activeCharters.length, 1);
  assert.equal(state.heroes.h0.isChartering, true, "a hero with a real charter row stays chartering");
  assert.equal(state.heroes.h0.charterId, "ch0");
});

test("an absent charters field hydrates as [] and unlocks the hero it left flagged (the pre-fix reload state)", (t) => {
  // The exact shape C-BLOCKER-1 recorded: the hero carries isChartering: true,
  // the payload carries no charters at all. Left alone, that hero can never be
  // selected again (turnController.selectHero bails on isChartering) and
  // nothing can finish the charter -- so hydration unlocks it instead.
  t.mock.method(console, "warn", () => {});
  const state = hydrateClientGame(apiGameWithCharters(undefined, { isChartering: true, charterId: "ch0" }));

  assert.deepEqual(state.activeCharters, []);
  assert.equal(state.heroes.h0.isChartering, false, "the orphaned charter flag is cleared, not honoured");
  assert.equal(state.heroes.h0.charterId, null);
});
