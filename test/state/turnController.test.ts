import { test } from "node:test";
import assert from "node:assert/strict";
import { TurnController, type TurnControllerHooks } from "../../src/state/turnController";
import { makeState } from "../charter/_helpers";
import type { GameState } from "@heroes/contracts";

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

test("coverage guard: every this.hooks.on*( call inside a TurnController mutation method is wrapped in trackCommand( (issue #151 §5)", async () => {
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
  const trackOpenRe = /\btrackCommand\s*\(/g;
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
    "every this.hooks.on*( inside a TurnController mutation method must be wrapped in trackCommand(",
  );
});
