import { test } from "node:test";
import assert from "node:assert/strict";
import { applyEngineEvent } from "@heroes/engine";
import type { EngineEvent, GameState, SettlementState } from "@heroes/contracts";
import { GameStateManager } from "../../src/managers/GameStateManager";
import { EntityMirror } from "../../src/render/scene/entityMirror";
import { GameMap } from "../../src/map/gameMap";
import { makeHero, makeSettlement, makeState } from "../charter/_helpers";
import type { TurnControllerHooks } from "../../src/state/turnController";

// Playthrough round 2, F4: the client's Castle mirror (`getSettlements()`, the
// collection every render/UI path reads) kept a captured settlement's OLD owner
// forever, while getState()/getGameState() were already correct. These tests
// assert the MIRROR -- `GameStateManager.getSettlement(id)` / `getSettlements()`
// -- because the mirror is what was wrong; asserting the server or the
// authoritative `GameState` would have passed before the fix.
//
// The commands below are the real TurnController entry points the client calls;
// the only thing stubbed is the network half (the POST hooks), behaving the way
// an accepting server does.

/** Fields the Castle wrapper deliberately does NOT carry (it is a render
 *  projection; the upkeep shortfall round-trips paid up through
 *  Castle.toGameState). Excluded from the whole-object comparison. */
const UNMIRRORED: ReadonlyArray<keyof SettlementState> = [
  "garrisonUnpaidSinceDay",
  "garrisonUnpaidTroops",
  "garrisonUnpaidGold",
];

const ACCEPTING_HOOKS = {
  logEvent: () => {},
  onHumanMove: async () => {},
  onCaptureSettlement: async () => {},
  onSetAutoTrade: async () => {},
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

/** Every mirrored field of one settlement, mirror against authoritative state. */
function assertMirrorMatchesState(manager: GameStateManager, id: string): void {
  const mirror = manager.getSettlement(id);
  const authoritative = manager.getState().settlements[id];
  assert.ok(mirror, `mirror holds ${id}`);
  assert.ok(authoritative, `state holds ${id}`);
  const projected = mirror.toGameState() as Record<string, unknown>;
  for (const [key, value] of Object.entries(projected)) {
    if (UNMIRRORED.includes(key as keyof SettlementState)) continue;
    assert.deepEqual(
      value,
      (authoritative as unknown as Record<string, unknown>)[key],
      `mirror field ${key} must agree with the state`,
    );
  }
}

test("a walk-in capture moves the client's settlement mirror, not just the state (F4)", () => {
  const manager = managerWith(
    makeState({
      activePlayerId: 0,
      selectedHeroId: "h0",
      phase: { kind: "PLAYER_TURN", playerId: 0 },
      heroes: [makeHero("h0", 0, 2, 3)],
      settlements: [makeSettlement("s1", 1, 2, 2, { level: 2, population: 1500, gold: 400 })],
    }),
  );
  const mirror = manager.getSettlement("s1");
  assert.ok(mirror, "the mirror was built at boot");
  assert.equal(mirror.ownerId, 1, "precondition: the mirror starts on the AI's ownership");
  assertMirrorMatchesState(manager, "s1");

  // The walk-in: the player's hero steps onto the AI-held castle, which the
  // TurnController captures optimistically and persists as a command. No
  // state:committed is emitted on this path (it would snap every hero).
  assert.equal(manager.getTurnController().requestMove("h0", { q: 2, r: 2 }, 1), true);
  assert.equal(
    manager.getTurnController().getState().settlements["s1"].ownerId,
    0,
    "the authoritative controller state moved to the player",
  );
  assert.equal(mirror.ownerId, 1, "the mirror is the surface that was wrong — still pre-capture before the diff");

  manager.update(16);

  assert.equal(manager.getState().settlements["s1"].ownerId, 0, "the frame diff adopted the controller's state");
  assert.strictEqual(manager.getSettlement("s1"), mirror, "the reconcile keeps the instance the render mirror aliases");
  assert.equal(mirror.ownerId, 0, "the MIRROR follows the capture with no commit");
  assert.equal(manager.getSettlements().find((c) => c.id === "s1")?.ownerId, 0);
  assertMirrorMatchesState(manager, "s1");

  // The same reconcile, one mirrored field over: nothing about this is
  // owner-specific. A second local command (an auto-trade toggle) takes the
  // same commit path and must land in the mirror the same way.
  assert.equal(manager.getTurnController().setAutoTrade("s1", false), true);
  assert.equal(mirror.autoTrade, true, "still pre-command until the diff runs");
  manager.update(16);
  assert.equal(mirror.autoTrade, false, "buildings/upgrade/autoTrade are mirrored fields too, and reconcile with the owner");
  assertMirrorMatchesState(manager, "s1");
});

test("the AI's capture reaches the same mirror through the event path, and survives the commit path", () => {
  const manager = managerWith(
    makeState({
      activePlayerId: 0,
      selectedHeroId: null,
      heroes: [makeHero("h0", 0, 5, 5), makeHero("h1", 1, 2, 3)],
      settlements: [makeSettlement("s0", 0, 2, 2)],
    }),
  );
  const mirror = manager.getSettlement("s0");
  assert.ok(mirror);
  assert.equal(mirror.ownerId, 0);

  // Production wiring: the render layer's mirror adopts the manager's exact
  // instances (EntityMirror.syncWith), so the event multiplayerSync applies
  // writes the capture onto the one object every view reads.
  const renderMirror = new EntityMirror();
  renderMirror.syncWith(manager.getHeroesMap(), manager.getSettlementsMap());
  assert.strictEqual(renderMirror.getSettlement("s0"), mirror, "the render mirror aliases the manager's instance");

  const event: EngineEvent = {
    type: "SettlementCaptured",
    actor: 1,
    heroId: "h1",
    settlementId: "s0",
    previousOwnerId: 0,
  };
  const applied = applyEngineEvent(manager.getState(), event);
  assert.equal(applied.outcome, "applied", "the server's capture replays onto this client's state");
  renderMirror.applyEvent(event);

  assert.equal(mirror.ownerId, 1, "the manager's own mirror view moved with the event");

  // The turn-boundary resync adopts the server's state wholesale -- what
  // GameEngine's state:committed listener then rebuilds from. The mirror must
  // come through that as the same instance, still on the new owner.
  manager.replaceState(applied.state);
  manager.rebuildSettlementsFromState();

  assert.strictEqual(manager.getSettlement("s0"), mirror, "the commit path keeps the instance the render mirror holds");
  assert.strictEqual(renderMirror.getSettlement("s0"), mirror);
  assert.equal(mirror.ownerId, 1);
  assertMirrorMatchesState(manager, "s0");
});
