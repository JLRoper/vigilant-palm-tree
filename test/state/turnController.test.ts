import { test } from "node:test";
import assert from "node:assert/strict";
import { TurnController, type TurnControllerHooks } from "../../src/state/turnController";
import { emptyWarehouse, makeCharter, makeHero, makeSettlement, makeState } from "../charter/_helpers";
import { normalizePlatoons } from "@heroes/engine";
import { MOVEMENT_PER_TURN, type GameState } from "@heroes/contracts";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface Spy {
  (...args: unknown[]): unknown;
  mock: { calls: unknown[][]; callCount: () => number };
}

function spy(): Spy {
  const calls: unknown[][] = [];
  const fn = ((...args: unknown[]): unknown => {
    calls.push(args);
    return undefined;
  }) as Spy;
  fn.mock = { calls, callCount: () => calls.length };
  return fn;
}

interface TestHooks extends TurnControllerHooks {
  onHumanTurnEndSpy: Spy;
}

function buildHooks(initial: GameState): TurnControllerHooks {
  const nextState: GameState = {
    ...initial,
    activePlayerId: 1,
    phase: { kind: "AI_TURN", playerId: 1 },
  };
  const onHumanTurnEndSpy = spy();
  const noop = async (): Promise<void> => {};
  const hooks: TurnControllerHooks = {
    onHumanTurnEnd: ((s: GameState) => {
      onHumanTurnEndSpy(s);
      return nextState;
    }) as TurnControllerHooks["onHumanTurnEnd"],
    onAiMove: noop,
    onHumanMove: noop,
    onBattleResolved: async (s: GameState) => ({ state: s, battle: null }),
    pickAiMove: () => null,
    logEvent: () => {},
    getMap: () => {
      throw new Error("getMap not used in these tests");
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
    onUpgradeBuilding: noop,
    onUpgradeSettlement: noop,
    onAdvanceCharterTravel: noop,
    onRecruitUnits: noop,
    onTransferUnits: noop,
    onSubmitSettlementBattleResult: noop,
  };
  (hooks as unknown as TestHooks).onHumanTurnEndSpy = onHumanTurnEndSpy;
  return hooks;
}

function getEndTurnSpy(hooks: TurnControllerHooks): Spy {
  return (hooks as unknown as TestHooks).onHumanTurnEndSpy;
}

test("drainPendingCommands resolves immediately when nothing is pending and onHumanTurnEnd fires on the next microtask", async () => {
  const initial = makeState();
  const hooks = buildHooks(initial);
  const controller = new TurnController(initial, hooks);
  const endTurnSpy = getEndTurnSpy(hooks);

  const endTurnPromise = controller.endHumanTurn();

  await Promise.resolve();
  assert.equal(endTurnSpy.mock.callCount(), 0, "onHumanTurnEnd must not run synchronously");

  await endTurnPromise;
  assert.equal(
    endTurnSpy.mock.callCount(),
    1,
    "onHumanTurnEnd must run once the (vacuous) drain resolves",
  );
});

test("drainPendingCommands waits for a single in-flight command before firing onHumanTurnEnd", async () => {
  const initial = makeState();
  const hooks = buildHooks(initial);
  const endTurnSpy = getEndTurnSpy(hooks);

  const setAutoTradeCommand = deferred<void>();
  hooks.onSetAutoTrade = (() => setAutoTradeCommand.promise) as TurnControllerHooks["onSetAutoTrade"];

  const controller = new TurnController(initial, hooks);
  assert.equal(controller.setAutoTrade("s0", false), true, "setAutoTrade should register the pending command");

  const endTurnPromise = controller.endHumanTurn();

  await Promise.resolve();
  await Promise.resolve();
  assert.equal(
    endTurnSpy.mock.callCount(),
    0,
    "onHumanTurnEnd must not fire while the tracked command is still in flight",
  );

  setAutoTradeCommand.resolve();
  await endTurnPromise;
  assert.equal(
    endTurnSpy.mock.callCount(),
    1,
    "onHumanTurnEnd must fire only after the in-flight command settles",
  );
});

test("drainPendingCommands waits for every one of multiple concurrent in-flight commands", async () => {
  const initial = makeState();
  const hooks = buildHooks(initial);
  const endTurnSpy = getEndTurnSpy(hooks);

  const d1 = deferred<void>();
  const d2 = deferred<void>();
  const d3 = deferred<void>();
  const cycle = [d1, d2, d3];
  let i = 0;
  hooks.onSetAutoTrade = (() => {
    const d = cycle[i++ % cycle.length];
    return d.promise;
  }) as TurnControllerHooks["onSetAutoTrade"];

  const controller = new TurnController(initial, hooks);
  assert.equal(controller.setAutoTrade("s0", false), true, "first toggle");
  assert.equal(controller.setAutoTrade("s0", true), true, "second toggle");
  assert.equal(controller.setAutoTrade("s0", false), true, "third toggle");

  const endTurnPromise = controller.endHumanTurn();

  await Promise.resolve();
  await Promise.resolve();
  assert.equal(
    endTurnSpy.mock.callCount(),
    0,
    "onHumanTurnEnd must not fire while any tracked command is still in flight",
  );

  d1.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(
    endTurnSpy.mock.callCount(),
    0,
    "resolving one of three in-flight commands must not release the barrier",
  );

  d2.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(
    endTurnSpy.mock.callCount(),
    0,
    "the barrier must hold until every tracked command has settled",
  );

  d3.resolve();
  await endTurnPromise;
  assert.equal(
    endTurnSpy.mock.callCount(),
    1,
    "onHumanTurnEnd fires exactly once after every tracked command has settled",
  );
});

test("endCurrentTurn blocks onHumanTurnEnd until a command tracked between mutation and end-turn settles (PR #114 regression pin)", async () => {
  const initial = makeState();
  const hooks = buildHooks(initial);
  const endTurnSpy = getEndTurnSpy(hooks);

  const command = deferred<void>();
  hooks.onSetAutoTrade = (() => command.promise) as TurnControllerHooks["onSetAutoTrade"];

  const controller = new TurnController(initial, hooks);
  controller.setAutoTrade("s0", false);
  const endTurnPromise = controller.endHumanTurn();

  await Promise.resolve();
  await Promise.resolve();
  assert.equal(
    endTurnSpy.mock.callCount(),
    0,
    "End-turn issued immediately after a mutation must not race past the still-in-flight command",
  );

  command.resolve();
  await endTurnPromise;
  assert.equal(
    endTurnSpy.mock.callCount(),
    1,
    "onHumanTurnEnd fires only after the previously-in-flight command has settled server-side",
  );
});

test("drainPendingCommands still releases onHumanTurnEnd when the in-flight command rejects (issue #151 §3)", async () => {
  const initial = makeState();
  const hooks = buildHooks(initial);
  const endTurnSpy = getEndTurnSpy(hooks);

  const rejectedCommand = deferred<void>();
  hooks.onSetAutoTrade = (() => rejectedCommand.promise) as TurnControllerHooks["onSetAutoTrade"];

  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };
  try {
    const controller = new TurnController(initial, hooks);
    controller.setAutoTrade("s0", false);

    const endTurnPromise = controller.endHumanTurn();
    rejectedCommand.reject(new Error("server rejected the auto-trade"));

    await endTurnPromise;

    assert.equal(
      endTurnSpy.mock.callCount(),
      1,
      "drainPendingCommands must let End Turn proceed even when an in-flight command rejects",
    );
    assert.equal(
      warnings.length,
      1,
      "the rejected promise should surface as exactly one console.warn via trackCommand's own .catch",
    );
  } finally {
    console.warn = originalWarn;
  }
});

test("advanceAutoTravel fires onAdvanceCharterTravel once per hex-step, and endCurrentTurn blocks on them (issue #152 -- closing the #114 race on the charter-travel path)", async () => {
  const initial = makeState({
    heroes: [makeHero("h0", 0, 0, 0, { isChartering: true, charterId: "c0", movementRemaining: 2 })],
    activeCharters: [makeCharter({ id: "c0", heroId: "h0", ownerId: 0, targetQ: 5, targetR: 0 })],
  });
  const hooks = buildHooks(initial);
  const endTurnSpy = getEndTurnSpy(hooks);
  // A fully open, uniform-cost map -- this test is about how many times
  // (and with what args) advanceAutoTravel() calls the hook per step, not
  // about pathfinding/terrain itself (already covered by
  // src/map/pathfinding.ts's own tests).
  hooks.getMap = (() => ({
    isPassable: () => true,
    cost: () => 1,
  })) as unknown as TurnControllerHooks["getMap"];

  const steps: unknown[][] = [];
  const commands: Deferred<void>[] = [];
  hooks.onAdvanceCharterTravel = ((...args: unknown[]) => {
    steps.push(args);
    const d = deferred<void>();
    commands.push(d);
    return d.promise;
  }) as TurnControllerHooks["onAdvanceCharterTravel"];

  const controller = new TurnController(initial, hooks);
  controller.advanceAutoTravel();

  assert.equal(steps.length, 2, "movementRemaining=2 at cost 1/hex should take exactly two steps in one call");
  assert.deepEqual(steps[0], [0, "h0", { q: 0, r: 0 }, { q: 1, r: 0 }, 1]);
  assert.deepEqual(steps[1], [0, "h0", { q: 1, r: 0 }, { q: 2, r: 0 }, 1]);

  // Same #114 shape as the MoveHero/SetAutoTrade regression pins above:
  // ending the turn immediately after these steps must not race past the
  // still-in-flight commands they registered via trackCommand.
  const endTurnPromise = controller.endHumanTurn();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(
    endTurnSpy.mock.callCount(),
    0,
    "End Turn must not race ahead of the two still-in-flight charter-travel steps",
  );

  for (const d of commands) d.resolve();
  await endTurnPromise;
  assert.equal(endTurnSpy.mock.callCount(), 1);
});

test("pendingCommands empties after a tracked command settles, so the Set can't grow unbounded across a session (issue #151 §4)", async () => {
  const initial = makeState();
  const hooks = buildHooks(initial);

  const cycle = [deferred<void>(), deferred<void>(), deferred<void>()];
  let i = 0;
  hooks.onSetAutoTrade = (() => {
    const d = cycle[i++ % cycle.length];
    return d.promise;
  }) as TurnControllerHooks["onSetAutoTrade"];

  const controller = new TurnController(initial, hooks);
  const toggles = [false, true, false];
  for (let k = 0; k < cycle.length; k += 1) {
    assert.equal(controller.setAutoTrade("s0", toggles[k]!), true, `command ${k + 1} registers`);
  }

  const pendingDuringFlight = (controller as unknown as { pendingCommands: Set<Promise<void>> }).pendingCommands;
  assert.equal(pendingDuringFlight.size, 3, "all three tracked commands are pending before they resolve");

  for (const d of cycle) {
    d.resolve();
  }

  const controllerInternals = controller as unknown as { pendingCommands: Set<Promise<void>> };
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(
    controllerInternals.pendingCommands.size,
    0,
    "pendingCommands must drain to empty once every tracked promise settles -- no unbounded growth across a long session",
  );
});

test("coverage guard: every this.hooks.on*( call inside a TurnController mutation method is tracked via trackCommand( or the commit() dispatcher (issue #151 §5)", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const source = readFileSync(fileURLToPath(new URL("../../src/state/turnController.ts", import.meta.url)), "utf8");

  const mutationNames = new Set([
    "requestMove",
    "captureSettlement",
    "transferGold",
    "tradeResources",
    "setAutoTrade",
    "reorderStack",
    "recruitHero",
    "startCharter",
    "startTownHallUpgrade",
    "startBuildingUpgrade",
    "startSettlementUpgrade",
    "advanceAutoTravel",
    "placeBuildings",
    "transferResources",
    "assignWagons",
    "buyWagons",
    "createTradeRoute",
    "updateTradeRoute",
    "recruitUnits",
    "transferUnits",
  ]);

  const lines = source.split("\n");
  type Span = { name: string; start: number; end: number; braceDepthAtEntry: number };
  const spans: Span[] = [];
  const methodHeader = /^\s{2}(?:async\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s*\([^)]*\)\s*[:{]/;
  for (let idx = 0; idx < lines.length; idx += 1) {
    const m = lines[idx]!.match(methodHeader);
    if (!m || !mutationNames.has(m[1]!)) continue;
    let depth = 0;
    let opened = false;
    let end = idx;
    for (let j = idx; j < lines.length; j += 1) {
      for (const ch of lines[j]!) {
        if (ch === "{") {
          depth += 1;
          opened = true;
        } else if (ch === "}") {
          depth -= 1;
          if (opened && depth === 0) {
            end = j;
            break;
          }
        }
      }
      if (opened && depth === 0) break;
    }
    spans.push({ name: m[1]!, start: idx, end, braceDepthAtEntry: 0 });
  }

  const hookCallRe = /\bthis\.hooks\.on[A-Z][A-Za-z]*\s*\(/g;
  const trackOpenRe = /\b(?:trackCommand|commit)\s*\(/g;
  const missing: string[] = [];
  for (const span of spans) {
    const block = lines.slice(span.start, span.end + 1).join("\n");
    let match: RegExpExecArray | null;
    while ((match = hookCallRe.exec(block)) !== null) {
      const before = block.slice(0, match.index);
      const trackOpens: number[] = [];
      let tm: RegExpExecArray | null;
      const re = new RegExp(trackOpenRe.source, "g");
      while ((tm = re.exec(before)) !== null) {
        trackOpens.push(tm.index + tm[0].length);
      }
      let covered = false;
      for (const openIdx of trackOpens) {
        const between = before.slice(openIdx);
        let depth = 1;
        let balanced = false;
        for (let k = 0; k < between.length; k += 1) {
          const ch = between[k]!;
          if (ch === "(") depth += 1;
          else if (ch === ")") {
            depth -= 1;
            if (depth === 0) {
              balanced = true;
              break;
            }
          }
        }
        if (!balanced) {
          covered = true;
          break;
        }
      }
      if (!covered) {
        missing.push(`${span.name}: ${match[0]}`);
      }
    }
  }

  assert.deepEqual(
    missing,
    [],
    "every this.hooks.on*( inside a TurnController mutation method must be tracked (inside trackCommand( or the commit() dispatcher)",
  );

  const commitIdx = source.indexOf("private commit(");
  assert.notEqual(commitIdx, -1, "the commit() dispatcher must exist");
  let parenDepth = 0;
  let bodyStart = -1;
  for (let i = source.indexOf("(", commitIdx); i < source.length; i += 1) {
    const ch = source[i]!;
    if (ch === "(") parenDepth += 1;
    else if (ch === ")") parenDepth -= 1;
    else if (ch === "{" && parenDepth === 0) {
      bodyStart = i;
      break;
    }
  }
  assert.notEqual(bodyStart, -1, "commit() body brace not found");
  let cDepth = 0;
  let commitEnd = source.length;
  for (let i = bodyStart; i < source.length; i += 1) {
    const ch = source[i]!;
    if (ch === "{") cDepth += 1;
    else if (ch === "}") {
      cDepth -= 1;
      if (cDepth === 0) {
        commitEnd = i + 1;
        break;
      }
    }
  }
  const commitBody = source.slice(commitIdx, commitEnd);
  assert.match(
    commitBody,
    /this\.trackCommand\(\s*opts\.hook\(\)/,
    "commit() must create-and-track its hook promise via trackCommand( -- it is the single choke point the union coverage above relies on",
  );
});

test("recruitUnits applies the garrison deposit locally and blocks End Turn on the in-flight onRecruitUnits command", async () => {
  const initial = makeState({
    settlements: [
      makeSettlement("s0", 0, 2, 2, {
        gold: 1000,
        warehouse: emptyWarehouse({ wood: 100 }),
        buildings: [{ gx: 0, gy: 0, kind: "archeryRange", level: 1, style: "classic" }],
      }),
      makeSettlement("s1", 1, 18, 4),
    ],
  });
  const hooks = buildHooks(initial);
  const endTurnSpy = getEndTurnSpy(hooks);

  const command = deferred<void>();
  hooks.onRecruitUnits = (() => command.promise) as TurnControllerHooks["onRecruitUnits"];

  const controller = new TurnController(initial, hooks);
  assert.equal(controller.recruitUnits("s0", "archeryRange", 0, 0, "archer", 3), true);

  const s0 = controller.getState().settlements["s0"];
  assert.equal(s0?.gold, 250, "3 archers at 250g each must deduct from the settlement treasury");
  assert.deepEqual(s0?.stacks?.[0]?.entries, [{ unitTypeId: "archer", count: 3 }], "recruits land in the garrison");

  const endTurnPromise = controller.endHumanTurn();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(
    endTurnSpy.mock.callCount(),
    0,
    "End Turn must not race past the still-in-flight onRecruitUnits command",
  );

  command.resolve();
  await endTurnPromise;
  assert.equal(endTurnSpy.mock.callCount(), 1);
});

test("recruitUnits returns false without committing when the engine rejects the purchase", () => {
  const initial = makeState();
  const controller = new TurnController(initial, buildHooks(initial));
  assert.equal(controller.recruitUnits("s0", "archeryRange", 0, 0, "archer", 1), false, "no archeryRange at s0");
  assert.equal(controller.getState(), initial, "state must be untouched on a rejected recruit");
});

test("transferUnits moves garrison troops onto a hero standing on the settlement tile and tracks the hook", async () => {
  const s0 = makeSettlement("s0", 0, 2, 2);
  s0.stacks = normalizePlatoons([{ entries: [{ unitTypeId: "swordsman", count: 10 }] }]);
  const initial = makeState({
    heroes: [makeHero("h0", 0, 2, 2)],
    settlements: [s0, makeSettlement("s1", 1, 18, 4)],
  });
  const hooks = buildHooks(initial);
  const endTurnSpy = getEndTurnSpy(hooks);

  const command = deferred<void>();
  hooks.onTransferUnits = (() => command.promise) as TurnControllerHooks["onTransferUnits"];

  const controller = new TurnController(initial, hooks);
  assert.equal(controller.transferUnits("h0", "s0", "toHero", "swordsman", 4), true);

  const state = controller.getState();
  assert.deepEqual(state.heroes["h0"]?.stacks[0]?.entries, [{ unitTypeId: "swordsman", count: 4 }]);
  assert.deepEqual(state.settlements["s0"]?.stacks?.[0]?.entries, [{ unitTypeId: "swordsman", count: 6 }]);

  const endTurnPromise = controller.endHumanTurn();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(endTurnSpy.mock.callCount(), 0, "onTransferUnits must be tracked like every other command hook");
  command.resolve();
  await endTurnPromise;
  assert.equal(endTurnSpy.mock.callCount(), 1);
});

test("transferUnits returns false when the hero is not on the settlement tile", () => {
  const initial = makeState({
    heroes: [makeHero("h0", 0, 5, 5)],
    settlements: [makeSettlement("s0", 0, 2, 2), makeSettlement("s1", 1, 18, 4)],
  });
  const controller = new TurnController(initial, buildHooks(initial));
  assert.equal(controller.transferUnits("h0", "s0", "toHero", "swordsman", 1), false, "hero_not_at_settlement");
});

test("tryCaptureAt gate: a garrisoned enemy settlement triggers SETTLEMENT_BATTLE instead of a walk-in capture", () => {
  const s1 = makeSettlement("s1", 1, 2, 2);
  s1.stacks = normalizePlatoons([{ entries: [{ unitTypeId: "swordsman", count: 5 }] }]);
  const initial = makeState({
    heroes: [makeHero("h0", 0, 2, 2)],
    settlements: [makeSettlement("s0", 0, 18, 4), s1],
  });
  const controller = new TurnController(initial, buildHooks(initial));

  controller.selectHero("h0");

  const phase = controller.getState().phase;
  assert.equal(phase.kind, "SETTLEMENT_BATTLE");
  assert.equal(phase.kind === "SETTLEMENT_BATTLE" ? phase.settlementId : null, "s1");
  assert.equal(controller.getState().settlements["s1"]?.ownerId, 1, "ownership must not flip when the garrison fights");
});

test("tryCaptureAt gate: a defending hero on the settlement tile defers to the adjacent-enemy battle (no capture, no settlement battle)", () => {
  const s1 = makeSettlement("s1", 1, 2, 2);
  s1.stacks = normalizePlatoons([{ entries: [{ unitTypeId: "swordsman", count: 5 }] }]);
  const initial = makeState({
    heroes: [makeHero("h0", 0, 2, 2), makeHero("h1", 1, 2, 2)],
    settlements: [makeSettlement("s0", 0, 18, 4), s1],
  });
  const controller = new TurnController(initial, buildHooks(initial));

  controller.selectHero("h0");

  assert.equal(controller.getState().phase.kind, "PLAYER_TURN", "tryCaptureAt must bail without capturing or starting a settlement battle");
  assert.equal(controller.getState().settlements["s1"]?.ownerId, 1);
});

test("tryCaptureAt gate: an empty-garrison enemy settlement still captures on walk-in", () => {
  const initial = makeState({
    heroes: [makeHero("h0", 0, 2, 2)],
    settlements: [makeSettlement("s0", 0, 18, 4), makeSettlement("s1", 1, 2, 2)],
  });
  const controller = new TurnController(initial, buildHooks(initial));

  controller.selectHero("h0");

  assert.equal(controller.getState().settlements["s1"]?.ownerId, 0, "empty garrison captures exactly as before the gate");
  assert.equal(controller.getState().phase.kind, "PLAYER_TURN");
});

test("captureAfterBattleIfNeeded re-runs the capture check on the hero's current tile after a hero battle", () => {
  const s1 = makeSettlement("s1", 1, 2, 2);
  s1.stacks = normalizePlatoons([{ entries: [{ unitTypeId: "swordsman", count: 2 }] }]);
  const initial = makeState({
    heroes: [makeHero("h0", 0, 2, 2)],
    settlements: [makeSettlement("s0", 0, 18, 4), s1],
  });
  const controller = new TurnController(initial, buildHooks(initial));

  controller.captureAfterBattleIfNeeded("h0");

  assert.equal(controller.getState().phase.kind, "SETTLEMENT_BATTLE", "garrison still holds, so the settlement battle fires");
});

test("captureAfterBattleIfNeeded is a no-op for an unknown hero id", () => {
  const initial = makeState();
  const controller = new TurnController(initial, buildHooks(initial));
  controller.captureAfterBattleIfNeeded("hX");
  assert.equal(controller.getState(), initial);
});

test("selectHero clears a prior settlement selection", () => {
  const initial = makeState();
  const controller = new TurnController(initial, buildHooks(initial));

  controller.selectSettlement("s0");
  assert.equal(controller.getState().selectedSettlementId, "s0");
  assert.equal(controller.getState().selectedHeroId, null);

  controller.selectHero("h0");

  assert.equal(controller.getState().selectedHeroId, "h0");
  assert.equal(controller.getState().selectedSettlementId, null);
});

function stubOpenMap(): TurnControllerHooks["getMap"] {
  return (() => ({
    isPassable: () => true,
    cost: () => 1,
  })) as unknown as TurnControllerHooks["getMap"];
}

async function settlePersist(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

test("AI tick moves the active AI hero, spends movement, persists via onAiMove with the AI seat as actor, and ends the turn once no moves remain", async () => {
  const initial = makeState({
    activePlayerId: 1,
    phase: { kind: "AI_TURN", playerId: 1 },
  });
  const hooks = buildHooks(initial);
  const endTurnSpy = getEndTurnSpy(hooks);
  hooks.getMap = stubOpenMap();
  const moves = [
    { toTile: { q: 18, r: 5 }, cost: 1 },
    { toTile: { q: 18, r: 6 }, cost: 1 },
  ];
  hooks.pickAiMove = (() => (moves.length > 0 ? moves.shift()! : null)) as TurnControllerHooks["pickAiMove"];
  const aiMoveCalls: unknown[][] = [];
  hooks.onAiMove = ((...args: unknown[]) => {
    aiMoveCalls.push(args);
    return Promise.resolve();
  }) as TurnControllerHooks["onAiMove"];

  const controller = new TurnController(initial, hooks);
  controller.tick(16);

  const moved = controller.getState().heroes["h1"];
  assert.equal(moved?.q, 18);
  assert.equal(moved?.r, 5);
  assert.equal(moved?.movementRemaining, MOVEMENT_PER_TURN - 1);
  assert.equal(aiMoveCalls.length, 1, "the move must persist via onAiMove");
  const [aiState, aiHeroId, aiToTile] = aiMoveCalls[0] as [GameState, string, { q: number; r: number }];
  assert.equal(aiHeroId, "h1");
  assert.deepEqual(aiToTile, { q: 18, r: 5 });
  assert.equal(aiState.activePlayerId, 1, "the persisting seat is the AI seat");
  assert.equal(endTurnSpy.mock.callCount(), 0, "the in-flight persist holds the turn open");

  await settlePersist();
  controller.tick(16);
  assert.equal(controller.getState().heroes["h1"]?.r, 6);
  assert.equal(controller.getState().heroes["h1"]?.movementRemaining, MOVEMENT_PER_TURN - 2);
  assert.equal(endTurnSpy.mock.callCount(), 0, "the hero still has movement, so the turn continues");

  await settlePersist();
  hooks.pickAiMove = (() => null) as TurnControllerHooks["pickAiMove"];
  controller.tick(16);
  await settlePersist();

  assert.equal(endTurnSpy.mock.callCount(), 1, "no moves left -> endCurrentTurn fires");
  const endedState = endTurnSpy.mock.calls[0]![0] as GameState;
  assert.equal(endedState.activePlayerId, 1, "the AI seat ends its own turn");
  assert.equal(endedState.phase.kind, "AI_TURN");
});

test("AI hero moving adjacent to an enemy enters BATTLE; after the loop's quick-resolve the AI turn resumes and completes", async () => {
  const initial = makeState({
    heroes: [makeHero("h0", 0, 12, 10), makeHero("h1", 1, 10, 10)],
    activePlayerId: 1,
    phase: { kind: "AI_TURN", playerId: 1 },
  });
  const hooks = buildHooks(initial);
  const endTurnSpy = getEndTurnSpy(hooks);
  hooks.getMap = stubOpenMap();
  hooks.pickAiMove = (() => ({ toTile: { q: 11, r: 10 }, cost: 1 })) as TurnControllerHooks["pickAiMove"];
  hooks.onAiMove = (() => Promise.resolve()) as TurnControllerHooks["onAiMove"];

  const controller = new TurnController(initial, hooks, { isPrimaryActor: () => true });
  controller.tick(16);

  assert.equal(controller.getState().heroes["h1"]?.q, 11, "the move itself landed");
  const phase = controller.getState().phase;
  assert.equal(phase.kind, "BATTLE", "landing adjacent to an enemy must enter the battle phase");
  assert.equal(phase.kind === "BATTLE" ? phase.attackerId : null, "h1");
  assert.equal(phase.kind === "BATTLE" ? phase.defenderId : null, "h0");
  assert.equal(endTurnSpy.mock.callCount(), 0, "a mid-turn battle must not end the AI turn");

  await controller.resolveCurrentBattle();

  const after = controller.getState().phase;
  assert.equal(
    after.kind,
    "AI_TURN",
    "endBattlePhase's PLAYER_TURN must be re-mapped so an AI seat can resume (tick and canEndTurn both gate on AI_TURN)",
  );
  assert.equal(after.kind === "AI_TURN" ? after.playerId : null, 1);

  hooks.pickAiMove = (() => null) as TurnControllerHooks["pickAiMove"];
  await settlePersist();
  controller.tick(16);
  await settlePersist();

  assert.equal(endTurnSpy.mock.callCount(), 1, "after the battle the AI turn resumes and completes");
  const endedState = endTurnSpy.mock.calls[0]![0] as GameState;
  assert.equal(endedState.activePlayerId, 1);
});

test("isPrimaryActor: () => false blocks the AI tick entirely (non-primary clients only watch)", () => {
  const initial = makeState({
    activePlayerId: 1,
    phase: { kind: "AI_TURN", playerId: 1 },
  });
  const hooks = buildHooks(initial);
  const endTurnSpy = getEndTurnSpy(hooks);
  let pickCalls = 0;
  hooks.pickAiMove = (() => {
    pickCalls += 1;
    return null;
  }) as TurnControllerHooks["pickAiMove"];
  hooks.onAiMove = (() => Promise.resolve()) as TurnControllerHooks["onAiMove"];

  const controller = new TurnController(initial, hooks, { isPrimaryActor: () => false });
  controller.tick(16);

  assert.equal(controller.getState(), initial, "state must be untouched on a non-primary client");
  assert.equal(pickCalls, 0, "the AI brain must not even be consulted");
  assert.equal(endTurnSpy.mock.callCount(), 0, "a non-primary client must not end the AI seat's turn");
});

test("AI walking onto a neutral settlement captures it via tryCaptureAt", async () => {
  const initial = makeState({
    heroes: [makeHero("h0", 0, 2, 2), makeHero("h1", 1, 18, 4)],
    settlements: [
      makeSettlement("s0", 0, 2, 2),
      makeSettlement("s1", 1, 20, 8),
      makeSettlement("s2", null, 18, 5),
    ],
    activePlayerId: 1,
    phase: { kind: "AI_TURN", playerId: 1 },
  });
  const hooks = buildHooks(initial);
  const endTurnSpy = getEndTurnSpy(hooks);
  hooks.getMap = stubOpenMap();
  hooks.pickAiMove = (() => ({ toTile: { q: 18, r: 5 }, cost: 1 })) as TurnControllerHooks["pickAiMove"];
  hooks.onAiMove = (() => Promise.resolve()) as TurnControllerHooks["onAiMove"];
  const captureCalls: unknown[][] = [];
  hooks.onCaptureSettlement = ((...args: unknown[]) => {
    captureCalls.push(args);
    return Promise.resolve();
  }) as TurnControllerHooks["onCaptureSettlement"];

  const controller = new TurnController(initial, hooks);
  controller.tick(16);

  assert.equal(controller.getState().settlements["s2"]?.ownerId, 1, "the neutral settlement flips to the AI seat");
  assert.equal(controller.getState().heroes["h1"]?.gold, 100, "CAPTURE_GOLD_REWARD lands on the mover");
  assert.deepEqual(captureCalls[0], [1, "h1", "s2"], "onCaptureSettlement fires with the AI seat as actor");
  assert.ok(controller.getState().players[1]?.settlementIds.includes("s2"));
  assert.equal(controller.getState().phase.kind, "AI_TURN", "a plain capture leaves the AI turn running");
  assert.equal(endTurnSpy.mock.callCount(), 0);
});
