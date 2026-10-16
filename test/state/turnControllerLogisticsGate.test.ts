import { test } from "node:test";
import assert from "node:assert/strict";
import { TurnController, type LogisticsCommandMerge, type TurnControllerHooks } from "../../src/state/turnController";
import { makeHero, makePlayer, makeSettlement, makeState, makeTradeRoute } from "../charter/_helpers";
import type { GameState, TradeRouteEndpoint } from "@heroes/contracts";

function buildHooks(): TurnControllerHooks {
  const noop = async (): Promise<void> => {};
  return {
    onHumanTurnEnd: async (s: GameState) => s,
    onAiMove: noop,
    onHumanMove: noop,
    onBattleResolved: async (s: GameState) => ({ state: s, battle: null }),
    pickAiMove: () => null,
    logEvent: () => {},
    getMap: () => {
      throw new Error("getMap not used in these tests");
    },
    rng: () => 0,
    onRecruitHero: noop,
    onUpgradeTownHall: noop,
    onSetAutoTrade: noop,
    onReorderStack: noop,
    onCaptureSettlement: noop,
    onTransferGold: noop,
    onStartCharter: noop,
    onUpgradeBuilding: noop,
    onUpgradeSettlement: noop,
    onAdvanceCharterTravel: noop,
    onPlaceBuildings: noop,
    onTransferResources: noop,
    onAssignWagons: noop,
    onBuyWagons: noop,
    onCreateTradeRoute: noop,
    onUpdateTradeRoute: noop,
    onRecruitUnits: noop,
    onTransferUnits: noop,
    onBankGold: noop,
    onSettlementBattleSubmitted: noop,
  };
}

const FROM: TradeRouteEndpoint = { kind: "settlement", id: "s0" };
const TO: TradeRouteEndpoint = { kind: "hero", id: "h0" };
const WOOD = { kind: "resource", resource: "wood" } as const;

// Hero OFF the origin settlement tile (a same-tile create would be rejected
// as same_tile by the engine before the gate even matters).
function gateState(): GameState {
  return makeState({
    players: [
      makePlayer(0, "player", ["h0"], ["s0"], { wagonsOwned: 5, wagonsUnassigned: 3 }),
      makePlayer(1, "ai", ["h1"], ["s1"]),
    ],
    heroes: [makeHero("h0", 0, 5, 5), makeHero("h1", 1, 18, 4)],
    settlements: [
      makeSettlement("s0", 0, 2, 2, { gold: 500, warehouse: { wood: 10, stone: 0, iron: 0, arcane: 0, food: 0 } }),
      makeSettlement("s1", 1, 18, 4),
    ],
  });
}

test("S3: with a known local seat, the five logistics methods act during the local seat's own PLAYER_TURN", () => {
  const state = gateState();
  const controller = new TurnController(state, buildHooks(), { localSeat: 0 });

  const create = controller.createTradeRoute(FROM, TO, WOOD, 2);
  assert.equal(create.ok, true, `create should pass the gate: ${create.reason}`);
  const update = controller.updateTradeRoute("route0", { wagonsDelta: -1 });
  assert.equal(update.ok, true, `update should pass the gate: ${update.reason}`);
  const buy = controller.buyWagons("s0", 1);
  assert.equal(buy.ok, true, `buy should pass the gate: ${buy.reason}`);
  const assign = controller.assignWagons("h0", 1);
  assert.equal(assign.ok, true, `assign should pass the gate: ${assign.reason}`);
  // The reducer's own rejection (hero not standing on the settlement), NOT the
  // turn gate — proof the gate admitted the call.
  const transfer = controller.transferResources("h0", "s0", "load", { wood: 1 });
  assert.equal(transfer.ok, false);
  assert.notEqual(transfer.reason, "not_your_turn");
});

test("S3: during an AI turn every logistics method rejects not_your_turn without acting", () => {
  const state = {
    ...gateState(),
    activePlayerId: 1,
    phase: { kind: "AI_TURN", playerId: 1 } as GameState["phase"],
  };
  const controller = new TurnController(state, buildHooks(), { localSeat: 0 });

  assert.deepEqual(controller.createTradeRoute(FROM, TO, WOOD, 2), { ok: false, reason: "not_your_turn" });
  assert.deepEqual(controller.updateTradeRoute("route0", { wagonsDelta: -1 }), { ok: false, reason: "not_your_turn" });
  assert.deepEqual(controller.updateTradeRoute("route0", { remove: true }), { ok: false, reason: "not_your_turn" });
  assert.deepEqual(controller.buyWagons("s0", 1), { ok: false, reason: "not_your_turn" });
  assert.deepEqual(controller.assignWagons("h0", 1), { ok: false, reason: "not_your_turn" });
  assert.deepEqual(controller.transferResources("h0", "s0", "load", { wood: 1 }), { ok: false, reason: "not_your_turn" });

  const after = controller.getState();
  assert.equal(after.heroes.h0.wagons, 5, "the hero's wagons are untouched");
  assert.equal(after.players[0].wagonsUnassigned, 3, "the pool is untouched");
  assert.equal((after.tradeRoutes ?? []).length, 0, "no route was created");
});

test("S3: during another seat's PLAYER_TURN the logistics methods reject not_your_turn", () => {
  const state = {
    ...gateState(),
    activePlayerId: 1,
    phase: { kind: "PLAYER_TURN", playerId: 1 } as GameState["phase"],
  };
  const controller = new TurnController(state, buildHooks(), { localSeat: 0 });

  assert.deepEqual(controller.createTradeRoute(FROM, TO, WOOD, 2), { ok: false, reason: "not_your_turn" });
  assert.deepEqual(controller.assignWagons("h0", 1), { ok: false, reason: "not_your_turn" });
});

test("S3: an absent localSeat keeps today's behavior (acts as activePlayerId even during an AI turn)", () => {
  const state = {
    ...gateState(),
    players: [
      makePlayer(0, "player", ["h0"], ["s0"], { wagonsOwned: 5, wagonsUnassigned: 3 }),
      makePlayer(1, "ai", ["h1"], ["s1"], { wagonsOwned: 5, wagonsUnassigned: 2 }),
    ],
    activePlayerId: 1,
    phase: { kind: "AI_TURN", playerId: 1 } as GameState["phase"],
  };
  const controller = new TurnController(state, buildHooks());

  const assign = controller.assignWagons("h1", 1);
  assert.equal(assign.ok, true, `pre-gate behavior must be preserved: ${assign.reason}`);
  assert.equal(controller.getState().heroes.h1.wagons, 6);
});

test("S1: mergeCommandResult adopts the server result and re-derives the route-id counter during the local seat's turn", () => {
  const state = gateState();
  const controller = new TurnController(state, buildHooks(), { localSeat: 0 });

  const routes = [
    makeTradeRoute({ id: "route3", from: FROM, to: TO, payload: WOOD }),
  ];
  const players = state.players.map((p) => (p.id === 0 ? { ...p, wagonsUnassigned: 1 } : p));
  const hero = { ...state.heroes.h0, wagons: 6 };
  const settlement = { ...state.settlements.s0, gold: 300 };
  const result: LogisticsCommandMerge = { tradeRoutes: routes, players, hero, settlement };

  const before = controller.getState();
  controller.mergeCommandResult(result);

  const after = controller.getState();
  assert.notEqual(after, before, "the merge is a real state replacement");
  assert.equal(after.tradeRoutes, routes, "the server's routes array is adopted verbatim");
  assert.equal(after.nextTradeRouteId, 4, "the counter re-derives one past the highest persisted id");
  assert.deepEqual(after.players, players);
  assert.equal(after.heroes.h0.wagons, 6);
  assert.equal(after.settlements.s0.gold, 300);
  assert.equal(after.phase, before.phase, "the merge is quiet: phase and selections ride along untouched");
});

test("S1: mergeCommandResult skips entirely outside the local seat's PLAYER_TURN (resync boundary corrects)", () => {
  const state = {
    ...gateState(),
    activePlayerId: 1,
    phase: { kind: "SETTLEMENT_BATTLE", playerId: 1, attackerId: "h1" } as unknown as GameState["phase"],
  };
  const controller = new TurnController(state, buildHooks(), { localSeat: 0 });
  const before = controller.getState();

  controller.mergeCommandResult({
    tradeRoutes: [makeTradeRoute({ id: "route9", from: FROM, to: TO, payload: WOOD })],
    players: state.players,
  });

  assert.equal(controller.getState(), before, "a result landing mid-battle must not rewind live state");
});

test("S1: mergeCommandResult with an unknown local seat still merges during any PLAYER_TURN", () => {
  const state = {
    ...gateState(),
    activePlayerId: 1,
    phase: { kind: "PLAYER_TURN", playerId: 1 } as GameState["phase"],
  };
  const controller = new TurnController(state, buildHooks());
  const routes = [makeTradeRoute({ id: "route2", from: FROM, to: TO, payload: WOOD })];

  controller.mergeCommandResult({ tradeRoutes: routes });

  assert.equal(controller.getState().nextTradeRouteId, 3, "unknown-seat callers keep the pre-gate merge behavior");
});
