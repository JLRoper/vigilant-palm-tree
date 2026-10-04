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

function harness(localSeat: number | null = 0, opts: { installOnReplace?: boolean } = {}) {
  let tc: TurnController | null = null;
  const flags = { primary: false };
  const replaces: GameState[] = [];
  const detach = attachGarrisonEventBridge({
    getController: () => tc,
    replaceState: (next) => {
      replaces.push(next);
      // Production replaceState (GameStateManager) rebuilds the controller
      // from the adopted state; the default keeps the original stub
      // behavior so existing tests observe replaces[] only.
      if (opts.installOnReplace) tc = new TurnController(next, stubHooks());
    },
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

test("a remote TradeRouteCreated adds the route to the controller state", async () => {
  const h = harness();
  const base = garrisonFixture();
  h.setController(
    new TurnController(
      {
        ...base,
        players: base.players.map((p) => (p.id === 1 ? { ...p, wagonsUnassigned: 4 } : p)),
      },
      stubHooks(),
    ),
  );

  bus.emit({
    type: "mp:eventsApplied",
    gameName: "g",
    cursor: 17,
    events: [
      {
        type: "TradeRouteCreated",
        actor: 1,
        routeId: "route0",
        from: { kind: "settlement", id: "s1" },
        to: { kind: "settlement", id: "s0" },
        payload: { kind: "resource", resource: "wood" },
        wagons: 2,
      },
    ],
  });
  await tick();

  assert.equal(h.replaces.length, 1);
  const routes = h.replaces[0].tradeRoutes ?? [];
  assert.equal(routes.length, 1);
  assert.equal(routes[0]?.id, "route0", "the route carries the event's id verbatim");
  h.detach();
});

test("a server-offered BattleOffered flips the controller into the BATTLE phase so the defender's modal opens", async () => {
  serverDrivenPolicy.registerServerDriven("sdr-battle-1");
  const h = harness();
  h.setController(
    new TurnController(
      garrisonFixture({ activePlayerId: 1, phase: { kind: "AI_TURN", playerId: 1 }, selectedHeroId: "h0" }),
      stubHooks(),
    ),
  );

  bus.emit({
    type: "mp:eventsApplied",
    gameName: "sdr-battle-1",
    cursor: 60,
    events: [{ type: "BattleOffered", actor: 1, attackerId: "h1", defenderId: "h0" }],
  });
  await tick();

  assert.equal(h.replaces.length, 1);
  assert.deepEqual(h.replaces[0].phase, { kind: "BATTLE", attackerId: "h1", defenderId: "h0" });
  assert.equal(h.replaces[0].selectedHeroId, null, "startBattle clears a live selection");
  h.detach();
  serverDrivenPolicy.clearServerDriven("sdr-battle-1");
});

test("a BattleOffered arriving while the local phase is blocked queues and opens the phase once safe", async () => {
  const h = harness();
  h.setController(
    new TurnController(
      garrisonFixture({ phase: { kind: "SETTLEMENT_BATTLE", attackerId: "h0", settlementId: "s1" } }),
      stubHooks(),
    ),
  );

  bus.emit({
    type: "mp:eventsApplied",
    gameName: "g",
    cursor: 61,
    events: [{ type: "BattleOffered", actor: 1, attackerId: "h1", defenderId: "h0" }],
  });
  await tick();
  assert.deepEqual(h.replaces, [], "queued, not dropped, while the local phase is blocked");

  h.setController(new TurnController(garrisonFixture(), stubHooks()));
  bus.emit({ type: "state:committed" });
  await tick();

  assert.equal(h.replaces.length, 1, "the deferred offer re-opens the BATTLE phase");
  assert.deepEqual(h.replaces[0].phase, { kind: "BATTLE", attackerId: "h1", defenderId: "h0" });
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

// Server-side AI actor (plan/2026-09-30-server-side-ai-actor.md Phase 1):
// turn-boundary reconciliation for flagged games + the permissive
// safe-phase gates a spectator client runs with (Gate 2 wiring makes
// isPrimaryActor false on flagged games, which is what flags.primary=false
// models in the harness below).

const serverDrivenPolicy = await import("../../src/io/serverDrivenGames");

test("a flagged game's unseeded restart reconciles an AI turn the server already completed", async () => {
  serverDrivenPolicy.registerServerDriven("sdr1");
  const h = harness();
  h.setController(
    new TurnController(
      garrisonFixture({ activePlayerId: 1, phase: { kind: "AI_TURN", playerId: 1 }, selectedHeroId: "h0" }),
      stubHooks(),
    ),
  );
  const fetched = garrisonFixture({ activePlayerId: 0, phase: { kind: "PLAYER_TURN", playerId: 0 } });

  bus.emit({ type: "mp:resynced", gameName: "sdr1", state: fetched, cursor: 30, reason: "initial" });
  await tick();

  assert.equal(h.replaces.length, 1, "the initial catch-up repairs the parked controller");
  assert.equal(h.replaces[0].phase.kind, "PLAYER_TURN", "the controller is no longer stuck in AI_TURN");
  assert.equal(h.replaces[0].activePlayerId, 0, "the server's turn context is adopted");
  assert.equal(h.replaces[0].selectedHeroId, "h0", "the viewer's own selection survives the reconcile");
  h.detach();
  serverDrivenPolicy.clearServerDriven("sdr1");
});

test("a cursor_gap fetch past a flagged game's parked AI turn reconciles the same way", async () => {
  serverDrivenPolicy.registerServerDriven("sdr2");
  const h = harness();
  h.setController(
    new TurnController(
      garrisonFixture({ activePlayerId: 1, phase: { kind: "AI_TURN", playerId: 1 } }),
      stubHooks(),
    ),
  );
  const fetched = garrisonFixture({ activePlayerId: 0, phase: { kind: "PLAYER_TURN", playerId: 0 } });

  bus.emit({ type: "mp:resynced", gameName: "sdr2", state: fetched, cursor: 31, reason: "cursor_gap" });
  await tick();

  assert.equal(h.replaces.length, 1);
  assert.equal(h.replaces[0].phase.kind, "PLAYER_TURN");
  h.detach();
  serverDrivenPolicy.clearServerDriven("sdr2");
});

test("a fetch still inside the same AI turn does not rewind a flagged spectator", async () => {
  serverDrivenPolicy.registerServerDriven("sdr3");
  const h = harness();
  h.setController(
    new TurnController(
      garrisonFixture({ activePlayerId: 1, phase: { kind: "AI_TURN", playerId: 1 } }),
      stubHooks(),
    ),
  );
  const midTurn = garrisonFixture({ activePlayerId: 1, phase: { kind: "AI_TURN", playerId: 1 } });
  bus.emit({ type: "mp:resynced", gameName: "sdr3", state: midTurn, cursor: 32, reason: "initial" });
  await tick();
  assert.deepEqual(h.replaces, [], "a mid-AI-turn snapshot would rewind delta-applied state");

  const laterRound = {
    ...garrisonFixture({ activePlayerId: 1, phase: { kind: "AI_TURN", playerId: 1 } }),
    round: 2,
  };
  bus.emit({ type: "mp:resynced", gameName: "sdr3", state: laterRound, cursor: 33, reason: "cursor_gap" });
  await tick();
  assert.equal(h.replaces.length, 1, "a fetch past that AI turn (later round) reconciles");
  assert.equal(h.replaces[0].round, 2);
  h.detach();
  serverDrivenPolicy.clearServerDriven("sdr3");
});

test("an unflagged game still drops initial/cursor_gap resyncs even from a parked AI turn", async () => {
  const h = harness();
  h.setController(
    new TurnController(
      garrisonFixture({ activePlayerId: 1, phase: { kind: "AI_TURN", playerId: 1 } }),
      stubHooks(),
    ),
  );
  const fetched = garrisonFixture({ activePlayerId: 0, phase: { kind: "PLAYER_TURN", playerId: 0 } });

  bus.emit({ type: "mp:resynced", gameName: "g-unflagged-parked", state: fetched, cursor: 34, reason: "initial" });
  await tick();
  bus.emit({ type: "mp:resynced", gameName: "g-unflagged-parked", state: fetched, cursor: 35, reason: "cursor_gap" });
  await tick();

  assert.deepEqual(h.replaces, [], "browser-driven games keep the event_not_derivable-only behavior");
  h.detach();
});

test("a flagged game still drops a snapshot over the local seat's own PLAYER_TURN", async () => {
  serverDrivenPolicy.registerServerDriven("sdr5");
  const h = harness();
  h.setController(
    new TurnController(
      garrisonFixture({ activePlayerId: 0, phase: { kind: "PLAYER_TURN", playerId: 0 } }),
      stubHooks(),
    ),
  );
  const fetched = garrisonFixture({ activePlayerId: 0, phase: { kind: "PLAYER_TURN", playerId: 0 } });

  bus.emit({ type: "mp:resynced", gameName: "sdr5", state: fetched, cursor: 36, reason: "initial" });
  await tick();

  assert.deepEqual(h.replaces, [], "in-flight optimistic commands must not be rewound, even flagged");
  h.detach();
  serverDrivenPolicy.clearServerDriven("sdr5");
});

test("a flagged spectator's parked AI turn merges garrison deltas immediately", async () => {
  serverDrivenPolicy.registerServerDriven("sdr6");
  const h = harness();
  h.setController(
    new TurnController(
      garrisonFixture({ activePlayerId: 1, phase: { kind: "AI_TURN", playerId: 1 } }),
      stubHooks(),
    ),
  );

  bus.emit({
    type: "mp:eventsApplied",
    gameName: "sdr6",
    cursor: 37,
    events: [{ type: "UnitsRecruited", actor: 1, settlementId: "s1", unitTypeId: "pikeman", count: 5 }],
  });
  await tick();

  assert.equal(h.replaces.length, 1, "no deferral: the spectator never mutates during the AI turn");
  assert.equal(stackTotal(h.replaces[0].settlements.s1.stacks), 9);
  h.detach();
  serverDrivenPolicy.clearServerDriven("sdr6");
});

// W5-4 (live: server peasantx270, client peasantx540): a delta that queued
// during an unsafe phase is already baked into any snapshot fetched after
// it, so adopting the snapshot must discard the queue -- flushing it after
// the adoption re-applies the recruitment on top of the snapshot. The
// snapshot and its cursor come from the same GET, so anything committed
// after the fetch is re-delivered by the poll and still applies.
test("W5-4: adopting a flagged reconciliation discards deferred deltas instead of doubling them", async () => {
  serverDrivenPolicy.registerServerDriven("sdr7");
  const h = harness(0, { installOnReplace: true });
  h.setController(
    new TurnController(
      garrisonFixture({ phase: { kind: "BATTLE", attackerId: "h0", defenderId: "h1" } }),
      stubHooks(),
    ),
  );

  bus.emit({
    type: "mp:eventsApplied",
    gameName: "sdr7",
    cursor: 40,
    events: [{ type: "UnitsRecruited", actor: 1, settlementId: "s1", unitTypeId: "pikeman", count: 5 }],
  });
  await tick();
  assert.deepEqual(h.replaces, [], "the delta queues while the phase is BATTLE");

  h.setController(
    new TurnController(
      garrisonFixture({ activePlayerId: 1, phase: { kind: "AI_TURN", playerId: 1 } }),
      stubHooks(),
    ),
  );
  const fetched = garrisonFixture({ activePlayerId: 0, phase: { kind: "PLAYER_TURN", playerId: 0 } });
  (fetched.settlements.s1.stacks ?? [{ entries: [] }])[0].entries.push({ unitTypeId: "pikeman", count: 5 });

  bus.emit({ type: "mp:resynced", gameName: "sdr7", state: fetched, cursor: 41, reason: "initial" });
  await tick();

  assert.equal(h.replaces.length, 1, "the superseded-AI-turn snapshot is adopted");
  assert.equal(
    stackTotal(h.replaces[0].settlements.s1.stacks),
    9,
    "the adopted garrison matches the snapshot exactly",
  );

  bus.emit({ type: "state:committed" });
  await tick();

  assert.equal(h.replaces.length, 1, "the deferred pre-snapshot delta was discarded, not flushed");
  assert.equal(stackTotal(h.replaces[0].settlements.s1.stacks), 9, "no doubling on top of the snapshot");

  bus.emit({
    type: "mp:eventsApplied",
    gameName: "sdr7",
    cursor: 44,
    events: [{ type: "UnitsRecruited", actor: 1, settlementId: "s1", unitTypeId: "pikeman", count: 3 }],
  });
  await tick();

  assert.equal(h.replaces.length, 2, "a delta arriving after the snapshot still applies");
  assert.equal(stackTotal(h.replaces[1].settlements.s1.stacks), 12);

  h.detach();
  serverDrivenPolicy.clearServerDriven("sdr7");
});

test("W5-4: an event_not_derivable resync also discards its deferred deltas at adoption", async () => {
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
    cursor: 42,
    events: [{ type: "UnitsRecruited", actor: 1, settlementId: "s1", unitTypeId: "pikeman", count: 5 }],
  });
  await tick();
  assert.deepEqual(h.replaces, [], "the delta queues while the phase is BATTLE");

  h.setController(new TurnController(garrisonFixture(), stubHooks()));
  const resynced = garrisonFixture();
  (resynced.settlements.s1.stacks ?? [{ entries: [] }])[0].entries.push({ unitTypeId: "pikeman", count: 5 });

  bus.emit({ type: "mp:resynced", gameName: "g", state: resynced, cursor: 43, reason: "event_not_derivable" });
  await tick();

  assert.equal(h.replaces.length, 1, "the snapshot is adopted");
  assert.equal(stackTotal(h.replaces[0].settlements.s1.stacks), 9, "the adopted garrison matches the snapshot");

  bus.emit({ type: "state:committed" });
  await tick();

  assert.equal(h.replaces.length, 1, "the pre-snapshot delta is not flushed after adoption");
  assert.equal(stackTotal(h.replaces[0].settlements.s1.stacks), 9);

  h.detach();
});

// Server-driven AI (plan 2026-09-30-server-side-ai-actor.md): on a flagged
// game the browser never drives the AI turn, so the server's per-step
// HeroMoved rows must reach the live controller -- through
// applyRemoteHeroMove (a quiet state replacement GameStateManager tweens),
// never through replaceState, which snaps every hero on the map.
function aiSeatMoveFixture(overrides: { phase?: GamePhase } = {}): GameState {
  const base = garrisonFixture({ activePlayerId: 1, phase: overrides.phase ?? { kind: "AI_TURN", playerId: 1 } });
  return {
    ...base,
    players: base.players.map((p) => (p.id === 1 ? { ...p, faction: "ai" as const } : p)),
  };
}

test("a flagged game replays an AI seat's HeroMoved onto the controller without a replaceState snap", async () => {
  serverDrivenPolicy.registerServerDriven("sdr-move-1");
  const h = harness();
  h.setController(new TurnController(aiSeatMoveFixture(), stubHooks()));

  bus.emit({
    type: "mp:eventsApplied",
    gameName: "sdr-move-1",
    cursor: 50,
    events: [{ type: "HeroMoved", actor: 1, heroId: "h1", to: { q: 9, r: 8 } }],
  });
  await tick();

  const hero = h.controller().getState().heroes.h1;
  assert.equal(hero?.q, 9, "the AI hero steps onto the event's tile");
  assert.equal(hero?.r, 8);
  assert.deepEqual(h.replaces, [], "replaceState would snap every hero -- the teleport this avoids");
  h.detach();
  serverDrivenPolicy.clearServerDriven("sdr-move-1");
});

test("a flagged game does not replay a remote human seat's HeroMoved", async () => {
  serverDrivenPolicy.registerServerDriven("sdr-move-2");
  const h = harness();
  h.setController(new TurnController(garrisonFixture(), stubHooks()));

  bus.emit({
    type: "mp:eventsApplied",
    gameName: "sdr-move-2",
    cursor: 51,
    events: [{ type: "HeroMoved", actor: 1, heroId: "h1", to: { q: 9, r: 8 } }],
  });
  await tick();

  assert.equal(h.controller().getState().heroes.h1?.q, 8, "a player-faction hero is not this bridge's business");
  assert.deepEqual(h.replaces, []);
  h.detach();
  serverDrivenPolicy.clearServerDriven("sdr-move-2");
});

test("an unflagged game never replays an AI hero's HeroMoved (the seat-0 client drives its own AI tick)", async () => {
  const h = harness();
  h.setController(new TurnController(aiSeatMoveFixture(), stubHooks()));

  bus.emit({
    type: "mp:eventsApplied",
    gameName: "g",
    cursor: 52,
    events: [{ type: "HeroMoved", actor: 1, heroId: "h1", to: { q: 9, r: 8 } }],
  });
  await tick();

  assert.equal(h.controller().getState().heroes.h1?.q, 8, "browser-driven games keep byte-identical behavior");
  assert.deepEqual(h.replaces, []);
  h.detach();
});

test("a flagged game's HeroMoved arriving in a blocked phase is dropped, not queued", async () => {
  serverDrivenPolicy.registerServerDriven("sdr-move-3");
  const h = harness();
  h.setController(
    new TurnController(
      aiSeatMoveFixture({ phase: { kind: "BATTLE", attackerId: "h0", defenderId: "h1" } }),
      stubHooks(),
    ),
  );

  bus.emit({
    type: "mp:eventsApplied",
    gameName: "sdr-move-3",
    cursor: 53,
    events: [{ type: "HeroMoved", actor: 1, heroId: "h1", to: { q: 9, r: 8 } }],
  });
  await tick();
  bus.emit({ type: "state:committed" });
  await tick();

  assert.equal(h.controller().getState().heroes.h1?.q, 8, "the move never lands and is never replayed later");
  assert.deepEqual(h.replaces, [], "the blocked phase must not even queue a wholesale replace");
  h.detach();
  serverDrivenPolicy.clearServerDriven("sdr-move-3");
});

test("a flagged game's HeroMoved for an unknown hero is a no-op, not a throw", async () => {
  serverDrivenPolicy.registerServerDriven("sdr-move-4");
  const h = harness();
  const controller = new TurnController(aiSeatMoveFixture(), stubHooks());
  h.setController(controller);
  const before = controller.getState();

  bus.emit({
    type: "mp:eventsApplied",
    gameName: "sdr-move-4",
    cursor: 54,
    events: [{ type: "HeroMoved", actor: 1, heroId: "ghost", to: { q: 9, r: 8 } }],
  });
  await tick();

  assert.equal(controller.getState(), before, "an unknown hero leaves the controller state identity untouched");
  assert.deepEqual(h.replaces, []);
  h.detach();
  serverDrivenPolicy.clearServerDriven("sdr-move-4");
});
