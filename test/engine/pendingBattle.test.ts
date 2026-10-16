import { test } from "node:test";
import assert from "node:assert/strict";
import type { HydratableGameRow, PendingBattleMarker } from "@heroes/engine";
import { hydrateGameState, readPendingBattle } from "@heroes/engine";
import { makeHero, makePlayer, makeSettlement } from "../charter/_helpers";

// The marker rides games.lobby (an untyped jsonb bag) server-side; the
// hydrate row's pendingBattle field carries the same value, so the
// malformed shapes below are cast through unknown exactly as the wire
// would deliver them.
function rowWith(pendingBattle: unknown, activeFaction: "player" | "ai" = "player"): HydratableGameRow {
  return {
    name: "pending-battle",
    seed: 1,
    round: 3,
    day: 9,
    active_player_id: activeFaction === "ai" ? 1 : 0,
    players: [makePlayer(0, "player", ["h0"], ["s0"]), makePlayer(1, "ai", ["h1"], [])],
    heroes: { h0: makeHero("h0", 0, 2, 2), h1: makeHero("h1", 1, 18, 4) },
    settlements: { s0: makeSettlement("s0", 0, 2, 2) },
    pendingBattle: pendingBattle as PendingBattleMarker | null | undefined,
  };
}

const validMarker = { attackerId: "h1", defenderId: "h0", since: 9 };

test("a valid pendingBattle marker hydrates to a BATTLE phase with the offered pair", () => {
  const state = hydrateGameState(rowWith(validMarker));
  assert.deepEqual(state.phase, { kind: "BATTLE", attackerId: "h1", defenderId: "h0" });
});

test("the marker overrides the faction-derived phase in either direction", () => {
  // AI active (the AI attacker's own turn): still BATTLE, not AI_TURN.
  assert.deepEqual(hydrateGameState(rowWith(validMarker, "ai")).phase, {
    kind: "BATTLE",
    attackerId: "h1",
    defenderId: "h0",
  });
  // Human active: still BATTLE, not PLAYER_TURN.
  assert.deepEqual(hydrateGameState(rowWith(validMarker, "player")).phase, {
    kind: "BATTLE",
    attackerId: "h1",
    defenderId: "h0",
  });
});

test("without a marker the phase stays faction-derived (unchanged behavior)", () => {
  assert.deepEqual(hydrateGameState(rowWith(null, "player")).phase, {
    kind: "PLAYER_TURN",
    playerId: 0,
  });
  assert.deepEqual(hydrateGameState(rowWith(null, "ai")).phase, { kind: "AI_TURN", playerId: 1 });
  // Absent field entirely: same fallback.
  const row = rowWith(undefined, "player");
  assert.deepEqual(hydrateGameState(row).phase, { kind: "PLAYER_TURN", playerId: 0 });
});

test("a malformed marker is ignored, falling back to the faction-derived phase", () => {
  const malformed: unknown[] = [
    { attackerId: "h1", defenderId: "h0" }, // missing since
    { attackerId: 7, defenderId: "h0", since: 9 }, // non-string attackerId
    { attackerId: "h1", defenderId: "", since: 9 }, // empty defenderId
    { attackerId: "h1", defenderId: "h0", since: "9" }, // non-number since
    { attackerId: "h1", defenderId: "h0", since: Number.NaN }, // non-finite since
    "battle", // marker is not an object
  ];
  for (const marker of malformed) {
    const state = hydrateGameState(rowWith(marker, "ai"));
    assert.deepEqual(state.phase, { kind: "AI_TURN", playerId: 1 }, `marker: ${JSON.stringify(marker)}`);
  }
});

test("readPendingBattle extracts a valid marker and rejects everything else", () => {
  assert.deepEqual(readPendingBattle({ pendingBattle: validMarker }), validMarker);
  // The same helper validates the hydrate row's own field (both are
  // objects with a pendingBattle property).
  assert.deepEqual(readPendingBattle(rowWith(validMarker)), validMarker);
  assert.equal(readPendingBattle(null), null);
  assert.equal(readPendingBattle(undefined), null);
  assert.equal(readPendingBattle({}), null);
  assert.equal(readPendingBattle({ pendingBattle: null }), null);
  assert.equal(readPendingBattle({ pendingBattle: "soon" }), null);
  assert.equal(readPendingBattle({ pendingBattle: { attackerId: "h1", defenderId: "h0" } }), null);
  assert.equal(
    readPendingBattle({ pendingBattle: { attackerId: "h1", defenderId: "h0", since: Number.POSITIVE_INFINITY } }),
    null,
  );
});
