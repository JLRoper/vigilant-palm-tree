import { test } from "node:test";
import assert from "node:assert/strict";
import type { HydratableGameRow, PendingBattleMarker } from "@heroes/engine";
import { hydrateGameState, readPendingBattle } from "@heroes/engine";
import { makeHero, makePlayer, makeSettlement } from "../charter/_helpers";

// The marker rides games.lobby (an untyped jsonb bag) server-side; the
// hydrate row's pendingBattle field carries the same value, so the
// malformed shapes below are cast through unknown exactly as the wire
// would deliver them.
// h1 stands adjacent to h0: (3,2) is a real neighbour of (2,2), which is what
// the marker's only writer guarantees -- EnterBattle re-derives
// detectAdjacentEnemy(attacker) === defender before it persists the offer. The
// fixtures below pin that live-collision shape on purpose: hydrate now refuses
// a marker whose pair is NOT adjacent (test/engine/pendingBattle.test.ts's last
// case), because that shape is a battle that has already ended.
function rowWith(pendingBattle: unknown, activeFaction: "player" | "ai" = "player"): HydratableGameRow {
  return {
    name: "pending-battle",
    seed: 1,
    round: 3,
    day: 9,
    active_player_id: activeFaction === "ai" ? 1 : 0,
    players: [makePlayer(0, "player", ["h0"], ["s0"]), makePlayer(1, "ai", ["h1"], [])],
    heroes: { h0: makeHero("h0", 0, 2, 2), h1: makeHero("h1", 1, 3, 2) },
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

// ---------------------------------------------------------------------------
// M-BLOCKER-1 / M-BLOCKER-2: a marker that outlived its battle must not
// re-derive BATTLE on the next load.
//
// Acceptance: `phase.kind === "PLAYER_TURN"`, `activePlayerId === 0` for a
// human seat 0 whose lobby still carries a stale marker. Before the fix, all
// three shapes below hydrated as `{ kind: "BATTLE", ... }` and the game was
// unplayable from the reload on -- the client reopened in combat and every
// PLAYER_TURN-gated command was refused.
// ---------------------------------------------------------------------------

/** h1 moved away from h0 (the post-resolution shape: cancelMove bounced it back, or the defender stepped off). */
function rowWithSeparatedPair(activeFaction: "player" | "ai" = "player"): HydratableGameRow {
  const row = rowWith(validMarker, activeFaction);
  row.heroes.h1 = makeHero("h1", 1, 9, 9);
  return row;
}

test("a marker whose pair is no longer adjacent is dropped: the phase stays PLAYER_TURN/0 (M-BLOCKER-1/M-BLOCKER-2)", (t) => {
  t.mock.method(console, "warn", () => {});
  const state = hydrateGameState(rowWithSeparatedPair("player"));
  assert.equal(state.phase.kind, "PLAYER_TURN");
  assert.equal(state.activePlayerId, 0);
  assert.deepEqual(state.phase, { kind: "PLAYER_TURN", playerId: 0 });
});

test("a marker naming a hero that is GONE (the loser of the resolved battle) is dropped too", (t) => {
  t.mock.method(console, "warn", () => {});
  const defenderGone = rowWith(validMarker, "player");
  delete defenderGone.heroes.h0;
  assert.deepEqual(hydrateGameState(defenderGone).phase, { kind: "PLAYER_TURN", playerId: 0 });

  const attackerGone = rowWith(validMarker, "player");
  delete attackerGone.heroes.h1;
  assert.deepEqual(hydrateGameState(attackerGone).phase, { kind: "PLAYER_TURN", playerId: 0 });
});

test("a marker whose pair is still adjacent keeps the BATTLE phase (a live offer survives the reload)", () => {
  const state = hydrateGameState(rowWith(validMarker, "ai"));
  assert.deepEqual(state.phase, { kind: "BATTLE", attackerId: "h1", defenderId: "h0" });
  assert.equal(state.activePlayerId, 1);
});
