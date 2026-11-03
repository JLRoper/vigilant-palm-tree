import { test } from "node:test";
import assert from "node:assert/strict";
import {
  revealForPlayer,
  sortedRevealKeys,
  startMove,
  visionKeysForPlayer,
} from "@heroes/engine";
import type { GameState, Player } from "@heroes/contracts";
import { GameStateManager } from "../../src/managers/GameStateManager";
import { GameMap } from "../../src/map/gameMap";
import { makeHero, makeSettlement, makeState } from "../charter/_helpers";
import type { TurnControllerHooks } from "../../src/state/turnController";

// Playthrough round 3, F1 (re-measured on github/main f7e02a3 / 0.39.2): after a
// move the SERVER's `players[].revealedTiles` grew (134 keys) while the CLIENT's
// own copy stayed at its load-time value (98) for the rest of the session, with
// no resync to catch it up. Nothing showed because `GameEngine.draw` hands that
// stale copy to `revealTilesFor`, which re-unions the live vision ring every
// frame -- the render path compensated for the projection instead of the
// projection being right.
//
// These tests assert the CLIENT's copy itself -- the value a consumer reads
// (`GameEngine.draw`'s seed, `__gameDebug.getState()`, any future reader) --
// after the TurnController's optimistic apply, NOT what the renderer draws.
// They are the same class as test/state/settlementMirrorReconcile.test.ts:
// a projection the client writes once and never refreshes.

/** The network half, behaving the way an accepting server does. */
const ACCEPTING_HOOKS = {
  logEvent: () => {},
  onHumanMove: async () => {},
  onCaptureSettlement: async () => {},
  onFoundSettlement: async () => {},
} as unknown as TurnControllerHooks;

function managerWith(state: GameState): GameStateManager {
  const manager = new GameStateManager();
  manager.setGameMap(new GameMap(9, "small"));
  manager.setHooks(ACCEPTING_HOOKS);
  manager.setState(state);
  manager.rebuildHeroesFromState();
  manager.rebuildSettlementsFromState();
  return manager;
}

/** An uncharted game's human seat: the `revealedTiles` key is the flag (README
 *  in packages/contracts/src/gameState.ts). Seeded the way init.ts seeds it --
 *  the seat's own starting vision -- so the fixture starts from the value the
 *  server would have persisted at creation. */
function unchartedState(): GameState {
  const base = makeState({
    activePlayerId: 0,
    selectedHeroId: "h0",
    phase: { kind: "PLAYER_TURN", playerId: 0 },
    heroes: [makeHero("h0", 0, 2, 2), makeHero("h1", 1, 18, 4)],
    settlements: [makeSettlement("s0", 0, 2, 2), makeSettlement("s1", 1, 18, 4)],
  });
  const players: Player[] = base.players.map((p) =>
    p.id === 0
      ? { ...p, revealedTiles: sortedRevealKeys(visionKeysForPlayer(base, 0)) }
      : p,
  );
  return { ...base, players };
}

// The move: 10 hexes east, along a trail that bulges north. (7,-1) is 5 hexes
// from the origin and 8 from the destination, so it is inside NEITHER endpoint's
// radius-4 ring -- it can only be revealed by the corridor the server walks.
const DEST = { q: 12, r: 2 };
const TRAIL = [
  { q: 2, r: 2 },
  { q: 7, r: -1 },
  { q: 12, r: 2 },
];

test("a move reconciles the client's players[].revealedTiles -- destination and corridor (F1)", () => {
  const state = unchartedState();
  const manager = managerWith(state);
  const controller = manager.getTurnController();

  const before = controller.getState().players[0].revealedTiles;
  assert.ok(before && before.length > 0, "precondition: the human seat carries a seeded reveal");
  assert.equal(before.includes(`${DEST.q},${DEST.r}`), false, "precondition: destination starts unrevealed");
  assert.equal(before.includes("7,-1"), false, "precondition: corridor point starts unrevealed");

  assert.equal(controller.requestMove("h0", DEST, 1, TRAIL), true, "the optimistic move applies");

  const after = controller.getState().players[0].revealedTiles ?? [];
  assert.ok(
    after.includes(`${DEST.q},${DEST.r}`),
    `the client's mirror must follow the server to the destination after a move (measured: ${before.length} keys before, ${after.length} after; destination ${DEST.q},${DEST.r} ${after.includes(`${DEST.q},${DEST.r}`) ? "present" : "MISSING"})`,
  );
  assert.ok(
    after.includes("7,-1"),
    "the walked corridor is revealed too -- outside both endpoint rings, so only the trail can carry it",
  );

  // The client applies exactly the server's rule (server/app/commandHandler.ts
  // calls the same engine function on its own post-move state), so the two
  // copies cannot disagree about a key or about the sort order.
  const moved = startMove({ ...state, selectedHeroId: "h0" }, "h0", DEST, 1, TRAIL).state;
  const serverWouldPersist = revealForPlayer(moved, 0, TRAIL).players[0].revealedTiles;
  assert.deepEqual(after, serverWouldPersist, "the client's mirror equals what the server's rule persists");

  // The AI seat maintains no reveal at all (init.ts stamps human seats only),
  // so the same command must not invent a key for it.
  assert.equal("revealedTiles" in controller.getState().players[1], false, "AI seats keep no reveal key");
});

test("a classic game's mirror stays key-free: a move writes no revealedTiles (byte-compat)", () => {
  const state = makeState({
    activePlayerId: 0,
    selectedHeroId: "h0",
    phase: { kind: "PLAYER_TURN", playerId: 0 },
    heroes: [makeHero("h0", 0, 2, 2), makeHero("h1", 1, 18, 4)],
    settlements: [makeSettlement("s0", 0, 2, 2), makeSettlement("s1", 1, 18, 4)],
  });
  const manager = managerWith(state);
  const controller = manager.getTurnController();

  assert.equal(controller.requestMove("h0", DEST, 1, TRAIL), true);
  for (const p of controller.getState().players) {
    assert.equal(
      "revealedTiles" in p,
      false,
      `player ${p.id} gained a revealedTiles key in a non-uncharted game (byte-compat broken)`,
    );
  }
});
