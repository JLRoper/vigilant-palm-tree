import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { EngineEvent, GamePhase, GameState, HeroId, PlayerId } from "@heroes/contracts";
import { makeHero, makePlayer, makeSettlement, makeState } from "../charter/_helpers";
import { TurnController, type TurnControllerHooks } from "../../src/state/turnController";
import { attachGarrisonEventBridge } from "../../src/game/garrisonEventBridge";
import { bus } from "../../src/core/eventBus";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function stubHooks(): TurnControllerHooks {
  const noop = async (): Promise<void> => {};
  return {
    onHumanTurnEnd: async (state: GameState) => state,
    onAiMove: noop,
    onHumanMove: noop,
    onBattleResolved: async (state: GameState) => ({ state, battle: null }),
    pickAiMove: () => null,
    logEvent: () => {},
    getMap: () => {
      throw new Error("map not needed");
    },
    rng: () => 0,
    onTradeResources: noop,
    onRecruitHero: noop,
    onUpgradeTownHall: noop,
    onSetAutoTrade: noop,
    onReorderStack: noop,
    onCaptureSettlement: noop,
    onTransferGold: noop,
    onStartCharter: noop,
    onAdvanceCharterTravel: noop,
    onUpgradeBuilding: noop,
    onUpgradeSettlement: noop,
    onRecruitUnits: noop,
    onTransferUnits: noop,
    onSettlementBattleSubmitted: noop,
    onPlaceBuildings: noop,
    onTransferResources: noop,
    onAssignWagons: noop,
    onBuyWagons: noop,
    onCreateTradeRoute: noop,
    onUpdateTradeRoute: noop,
  };
}

function garrisonFixture(
  overrides: { phase?: GamePhase; activePlayerId?: PlayerId; selectedHeroId?: HeroId | null } = {},
): GameState {
  const activePlayerId = overrides.activePlayerId ?? 1;
  return makeState({
    players: [makePlayer(0, "player", ["h0"], ["s0"]), makePlayer(1, "player", ["h1"], ["s1"])],
    heroes: [makeHero("h0", 0, 2, 2), makeHero("h1", 1, 8, 8)],
    settlements: [
      makeSettlement("s0", 0, 2, 2),
      { ...makeSettlement("s1", 1, 8, 8), stacks: [{ entries: [{ unitTypeId: "pikeman", count: 4 }] }] },
    ],
    activePlayerId,
    phase: overrides.phase ?? { kind: "PLAYER_TURN", playerId: activePlayerId },
    selectedHeroId: overrides.selectedHeroId ?? null,
  });
}

function harness(localSeat: number | null = 0) {
  let tc: TurnController | null = null;
  const flags = { primary: false };
  const replaces: GameState[] = [];
  const detach = attachGarrisonEventBridge({
    getController: () => tc,
    replaceState: (next) => replaces.push(next),
    isPrimaryActor: () => flags.primary,
    localSeat: () => localSeat,
  });
  return {
    detach,
    replaces,
    flags,
    setController: (next: TurnController) => {
      tc = next;
    },
    controller: () => {
      assert.ok(tc, "no controller installed");
      return tc;
    },
  };
}

function stackTotal(stacks: GameState["settlements"][string]["stacks"]): number {
  let total = 0;
  for (const p of stacks ?? []) {
    for (const e of p.entries) total += e.count;
  }
  return total;
}

beforeEach(() => {
  bus.clear();
});

test("a remote UnitsRecruited updates the local settlement garrison when idle", async () => {
  const h = harness();
  h.setController(new TurnController(garrisonFixture(), stubHooks()));

  bus.emit({
    type: "mp:eventsApplied",
    gameName: "g",
    cursor: 11,
    events: [{ type: "UnitsRecruited", actor: 1, settlementId: "s1", unitTypeId: "pikeman", count: 5 }],
  });
  await tick();

  assert.equal(h.replaces.length, 1);
  assert.equal(stackTotal(h.replaces[0].settlements.s1.stacks), 9, "garrison 4 + 5 recruited");
  h.detach();
});

test("a remote UnitsTransferred moves units between garrison and hero in the controller state", async () => {
  const h = harness();
  h.setController(new TurnController(garrisonFixture(), stubHooks()));

  bus.emit({
    type: "mp:eventsApplied",
    gameName: "g",
    cursor: 12,
    events: [
      {
        type: "UnitsTransferred",
        actor: 1,
        heroId: "h1",
        settlementId: "s1",
        direction: "toHero",
        unitTypeId: "pikeman",
        count: 2,
      },
    ],
  });
  await tick();

  assert.equal(h.replaces.length, 1);
  assert.equal(stackTotal(h.replaces[0].settlements.s1.stacks), 2);
  let heroTotal = 0;
  for (const p of h.replaces[0].heroes.h1.stacks) {
    for (const e of p.entries) heroTotal += e.count;
  }
  assert.equal(heroTotal, 2);
  h.detach();
});

test("a delta that no longer replays against local state is skipped without touching the controller", async () => {
  const h = harness();
  h.setController(new TurnController(garrisonFixture(), stubHooks()));

  bus.emit({
    type: "mp:eventsApplied",
    gameName: "g",
    cursor: 13,
    events: [{ type: "UnitsRecruited", actor: 1, settlementId: "ghost", unitTypeId: "pikeman", count: 5 }],
  });
  await tick();

  assert.deepEqual(h.replaces, []);
  h.detach();
});

test("non-garrison applied events are not bridged", async () => {
  const h = harness();
  h.setController(new TurnController(garrisonFixture(), stubHooks()));

  bus.emit({
    type: "mp:eventsApplied",
    gameName: "g",
    cursor: 14,
    events: [{ type: "HeroMoved", actor: 1, heroId: "h1", to: { q: 9, r: 8 } }],
  });
  await tick();

  assert.deepEqual(h.replaces, []);
  h.detach();
});

test("a SettlementBattleResolved resync replaces entity state on a remote turn and preserves a live selection", async () => {
  const h = harness();
  h.setController(new TurnController(garrisonFixture({ selectedHeroId: "h0" }), stubHooks()));
  const resynced = garrisonFixture({ activePlayerId: 1 });
  (resynced.settlements.s1.stacks ?? [{ entries: [] }])[0].entries.push({
    unitTypeId: "knight",
    count: 2,
  });

  bus.emit({ type: "mp:resynced", gameName: "g", state: resynced, cursor: 20, reason: "event_not_derivable" });
  await tick();

  assert.equal(h.replaces.length, 1);
  assert.deepEqual(h.replaces[0].settlements, resynced.settlements, "entities are taken wholesale");
  assert.equal(h.replaces[0].selectedHeroId, "h0", "a still-existing selection survives");
  assert.equal(stackTotal(h.replaces[0].settlements.s1.stacks), 6);
  h.detach();
});

test("a resync whose snapshot no longer has the selected hero clears the selection", async () => {
  const h = harness();
  h.setController(new TurnController(garrisonFixture({ selectedHeroId: "h0" }), stubHooks()));
  const resynced = makeState({
    players: [makePlayer(0, "player", [], ["s0"]), makePlayer(1, "player", ["h1"], ["s1"])],
    heroes: [makeHero("h1", 1, 8, 8)],
    settlements: [makeSettlement("s0", 0, 2, 2), makeSettlement("s1", 1, 8, 8)],
    activePlayerId: 1,
  });

  bus.emit({ type: "mp:resynced", gameName: "g", state: resynced, cursor: 21, reason: "event_not_derivable" });
  await tick();

  assert.equal(h.replaces.length, 1);
  assert.equal(h.replaces[0].selectedHeroId, null, "a dead selection is cleared");
  h.detach();
});

test("a resync drops a FOREIGN-seat hero selection and keeps the viewer's own (garrisonEventMerge)", async () => {
  const foreign = harness(0);
  foreign.setController(new TurnController(garrisonFixture({ selectedHeroId: "h1" }), stubHooks()));
  const resynced = garrisonFixture();

  bus.emit({ type: "mp:resynced", gameName: "g", state: resynced, cursor: 24, reason: "event_not_derivable" });
  await tick();

  assert.equal(foreign.replaces.length, 1);
  assert.equal(
    foreign.replaces[0].selectedHeroId,
    null,
    "h1 exists in the snapshot but belongs to seat 1 -- a foreign selection must not re-enter shared state",
  );
  foreign.detach();

  const own = harness(1);
  own.setController(
    new TurnController(
      garrisonFixture({ activePlayerId: 0, phase: { kind: "PLAYER_TURN", playerId: 0 }, selectedHeroId: "h1" }),
      stubHooks(),
    ),
  );

  bus.emit({ type: "mp:resynced", gameName: "g", state: resynced, cursor: 25, reason: "event_not_derivable" });
  await tick();

  assert.equal(own.replaces.length, 1);
  assert.equal(own.replaces[0].selectedHeroId, "h1", "the same selection survives for the seat that owns the hero");
  own.detach();
});

test("a resync during the local seat's own turn is dropped, and so are non-derivable-unrelated reasons", async () => {
  const h = harness();
  h.setController(
    new TurnController(garrisonFixture({ activePlayerId: 0, phase: { kind: "PLAYER_TURN", playerId: 0 } }), stubHooks()),
  );
  const resynced = garrisonFixture();

  bus.emit({ type: "mp:resynced", gameName: "g", state: resynced, cursor: 22, reason: "event_not_derivable" });
  await tick();
  bus.emit({ type: "mp:resynced", gameName: "g", state: resynced, cursor: 23, reason: "initial" });
  await tick();

  assert.deepEqual(h.replaces, [], "no wholesale snapshot lands over the local turn");
  h.detach();
});

test("deltas arriving mid-battle are deferred and applied when the battle ends", async () => {
  const h = harness();
  h.setController(
    new TurnController(
      garrisonFixture({ phase: { kind: "BATTLE", attackerId: "h0", defenderId: "h1" } }),
      stubHooks(),
    ),
  );

  bus.emit({
    type: "mp:eventsApplied",
    gameName: "g",
    cursor: 15,
    events: [{ type: "UnitsRecruited", actor: 1, settlementId: "s1", unitTypeId: "pikeman", count: 5 }],
  });
  await tick();
  assert.deepEqual(h.replaces, [], "nothing applies while the phase is BATTLE");

  h.setController(new TurnController(garrisonFixture(), stubHooks()));
  bus.emit({ type: "state:committed" });
  await tick();

  assert.equal(h.replaces.length, 1, "the deferred batch merges once a safe state commits");
  assert.equal(stackTotal(h.replaces[0].settlements.s1.stacks), 9);
  h.detach();
});

test("deltas arriving while the local client drives an AI turn are deferred until it is not the primary actor", async () => {
  const h = harness();
  h.flags.primary = true;
  h.setController(
    new TurnController(garrisonFixture({ activePlayerId: 1, phase: { kind: "AI_TURN", playerId: 1 } }), stubHooks()),
  );

  bus.emit({
    type: "mp:eventsApplied",
    gameName: "g",
    cursor: 16,
    events: [{ type: "UnitsRecruited", actor: 1, settlementId: "s1", unitTypeId: "pikeman", count: 5 }],
  });
  await tick();
  bus.emit({ type: "state:committed" });
  await tick();
  assert.deepEqual(h.replaces, [], "the AI driver's mid-turn state is not clobbered");

  h.flags.primary = false;
  bus.emit({ type: "state:committed" });
  await tick();

  assert.equal(h.replaces.length, 1);
  assert.equal(stackTotal(h.replaces[0].settlements.s1.stacks), 9);
  h.detach();
});
