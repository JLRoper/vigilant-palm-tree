import { test } from "node:test";
import assert from "node:assert/strict";
import { TurnController, createAiTurnMemory, type AiTurnMemory, type TurnControllerHooks } from "../../src/state/turnController";
import { GameStateManager } from "../../src/managers/GameStateManager";
import { mergeBattleOutcomeHero, mergeBattleOutcomeHeroes } from "../../src/game/turnHooks";
import { emptyWarehouse, makeCharter, makeHero, makeSettlement, makeState } from "../charter/_helpers";
import {
  CAPTURE_GOLD_REWARD,
  DEFAULT_TREASURY_WAGONS,
  WAGON_GOLD_CAPACITY,
  cleanupDefeatedHeroCharters,
  normalizePlatoons,
  relocateHeroToSettlement,
} from "@heroes/engine";
import { MOVEMENT_PER_TURN, type GameState, type HeroId, type SettlementId } from "@heroes/contracts";
import type { UnitType } from "../../src/state/units";
import { bus } from "../../src/core/eventBus";

const BATTLE_UNIT_TYPES: Record<string, UnitType> = {
  champ: { id: "champ", name: "Champ", attack: 100, defence: 100, health: 100, speed: 5, description: "", advantageType: "ranged", specialty: "", specialtyPriority: 0 },
  trash: { id: "trash", name: "Trash", attack: 1, defence: 1, health: 1, speed: 1, description: "", advantageType: "ranged", specialty: "", specialtyPriority: 0 },
  wall: { id: "wall", name: "Wall", attack: 1, defence: 1000, health: 10, speed: 1, description: "", advantageType: "ranged", specialty: "", specialtyPriority: 0 },
};

function stackOf(unitTypeId: string, count: number) {
  return normalizePlatoons([{ entries: [{ unitTypeId, count }] }]);
}

function garrisonedAt(id: string, owner: 0 | 1 | null, q: number, r: number, unitTypeId: string, count: number) {
  const s = makeSettlement(id, owner, q, r);
  s.stacks = stackOf(unitTypeId, count);
  return s;
}

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
    onBankGold: noop,
    onSettlementBattleSubmitted: noop,
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

test("bankGold deposit moves treasury -> pot locally and blocks End Turn on the in-flight command", async () => {
  const initial = makeState({
    day: 11,
    settlements: [
      makeSettlement("s0", 0, 2, 2, { gold: 1000, buildings: [{ gx: 1, gy: 1, kind: "bank", level: 1, style: "classic" }] }),
      makeSettlement("s1", 1, 18, 4),
    ],
  });
  const hooks = buildHooks(initial);
  const endTurnSpy = getEndTurnSpy(hooks);
  const seen: unknown[][] = [];
  const command = deferred<void>();
  hooks.onBankGold = ((...args: unknown[]) => {
    seen.push(args);
    return command.promise;
  }) as TurnControllerHooks["onBankGold"];

  const controller = new TurnController(initial, hooks);
  const result = controller.bankGold("s0", 1, 1, 400, "deposit");
  assert.deepEqual(result, { ok: true, reason: "" });

  const s0 = controller.getState().settlements["s0"];
  assert.equal(s0?.gold, 600, "the deposit leaves the treasury immediately");
  assert.deepEqual(s0?.buildings[0].bank, { gold: 400, pendingOut: [] }, "the pot carries the gold locally");

  // The local apply is load-bearing: multiplayerSync skips the client's OWN
  // event id, so a POST-only path would leave this pot stale until a resync.
  assert.deepEqual(seen, [[0, "s0", 1, 1, 400, "deposit"]]);

  const endTurnPromise = controller.endHumanTurn();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(endTurnSpy.mock.callCount(), 0, "End Turn must not race past the in-flight onBankGold command");
  command.resolve();
  await endTurnPromise;
  assert.equal(endTurnSpy.mock.callCount(), 1);
});

test("bankGold withdrawal starts the 7-day countdown out of the pot, not into the treasury", () => {
  const initial = makeState({
    day: 11,
    settlements: [
      makeSettlement("s0", 0, 2, 2, {
        gold: 100,
        buildings: [{ gx: 1, gy: 1, kind: "bank", level: 1, style: "classic", bank: { gold: 900, pendingOut: [] } }],
      }),
      makeSettlement("s1", 1, 18, 4),
    ],
  });
  const controller = new TurnController(initial, buildHooks(initial));
  assert.deepEqual(controller.bankGold("s0", 1, 1, 300, "withdraw"), { ok: true, reason: "" });

  const s0 = controller.getState().settlements["s0"];
  assert.equal(s0?.gold, 100, "the treasury does not receive the gold until it matures");
  assert.deepEqual(s0?.buildings[0].bank, { gold: 600, pendingOut: [{ gold: 300, maturesOnDay: 18 }] });
});

test("bankGold returns the reducer's reason and dispatches nothing when it rejects", () => {
  const initial = makeState({
    settlements: [
      makeSettlement("s0", 0, 2, 2, {
        gold: 100,
        buildings: [
          { gx: 1, gy: 1, kind: "bank", level: 1, style: "classic", bank: { gold: 100, pendingOut: [] } },
          { gx: 0, gy: 0, kind: "house", level: 1, style: "classic" },
        ],
      }),
      makeSettlement("s1", 1, 18, 4),
    ],
  });
  const hooks = buildHooks(initial);
  let called = 0;
  hooks.onBankGold = (() => {
    called++;
    return Promise.resolve();
  }) as TurnControllerHooks["onBankGold"];
  const controller = new TurnController(initial, hooks);

  assert.deepEqual(controller.bankGold("s0", 1, 1, 500, "deposit"), { ok: false, reason: "not_enough_gold" });
  assert.deepEqual(controller.bankGold("s0", 0, 0, 10, "deposit"), { ok: false, reason: "not_a_bank" });
  assert.deepEqual(controller.bankGold("s0", 1, 1, 600, "withdraw"), { ok: false, reason: "not_enough_in_pot" });
  assert.deepEqual(controller.bankGold("nope", 1, 1, 10, "deposit"), { ok: false, reason: "no_settlement" });
  assert.deepEqual(controller.bankGold("s0", 1, 1, 0, "deposit"), { ok: false, reason: "nothing_to_deposit" });
  assert.equal(called, 0, "a rejected move must not POST");
  assert.equal(controller.getState(), initial, "state must be untouched on a rejected move");
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

test("AI tick's selection override never leaks: a prior human selection survives the AI turn", async () => {
  const initial = makeState({
    selectedHeroId: "h0",
    activePlayerId: 1,
    phase: { kind: "AI_TURN", playerId: 1 },
  });
  const hooks = buildHooks(initial);
  hooks.getMap = stubOpenMap();
  hooks.pickAiMove = (() => ({ toTile: { q: 18, r: 5 }, cost: 1 })) as TurnControllerHooks["pickAiMove"];
  hooks.onAiMove = (() => Promise.resolve()) as TurnControllerHooks["onAiMove"];

  const controller = new TurnController(initial, hooks);
  controller.tick(16);

  assert.equal(controller.getState().heroes["h1"]?.q, 18, "the move itself landed");
  assert.equal(
    controller.getState().selectedHeroId,
    "h0",
    "the pre-AI human selection must not be replaced by the AI hero the reducer was tricked into accepting",
  );

  await settlePersist();
  controller.tick(16);
  hooks.pickAiMove = (() => null) as TurnControllerHooks["pickAiMove"];
  controller.tick(16);
  await settlePersist();

  assert.equal(controller.getState().selectedHeroId, "h0", "the human selection is still intact after the AI turn completes");
});

test("AI tick with no prior selection leaves selectedHeroId null after the move", async () => {
  const initial = makeState({
    activePlayerId: 1,
    phase: { kind: "AI_TURN", playerId: 1 },
  });
  const hooks = buildHooks(initial);
  hooks.getMap = stubOpenMap();
  hooks.pickAiMove = (() => ({ toTile: { q: 18, r: 5 }, cost: 1 })) as TurnControllerHooks["pickAiMove"];
  hooks.onAiMove = (() => Promise.resolve()) as TurnControllerHooks["onAiMove"];

  const controller = new TurnController(initial, hooks);
  controller.tick(16);

  assert.equal(controller.getState().heroes["h1"]?.q, 18);
  assert.equal(controller.getState().selectedHeroId, null, "the not_selected-gate override must not leak the AI hero as selected");
});

test("AI hero moving adjacent to an enemy enters BATTLE; after the loop's quick-resolve the AI turn resumes and completes", async () => {
  const initial = makeState({
    heroes: [
      makeHero("h0", 0, 12, 10, { stacks: normalizePlatoons([{ entries: [{ unitTypeId: "swordsman", count: 5 }] }]) }),
      makeHero("h1", 1, 10, 10),
    ],
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

test("AI moving adjacent to a 0-troop enemy hero does NOT enter battle: the AI turn continues and completes", async () => {
  const initial = makeState({
    heroes: [makeHero("h0", 0, 12, 10, { stacks: [] }), makeHero("h1", 1, 10, 10)],
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

  assert.equal(controller.getState().heroes["h1"]?.q, 11, "the move itself landed adjacent to the wiped hero");
  const phase = controller.getState().phase;
  assert.equal(phase.kind, "AI_TURN", "a zero-troop defender must not trigger the battle phase");
  assert.equal(phase.kind === "AI_TURN" ? phase.playerId : null, 1);
  assert.equal(endTurnSpy.mock.callCount(), 0, "the AI seat still holds its turn after the guarded move");

  hooks.pickAiMove = (() => null) as TurnControllerHooks["pickAiMove"];
  await settlePersist();
  controller.tick(16);
  await settlePersist();

  assert.equal(endTurnSpy.mock.callCount(), 1, "the AI turn completes on the next tick with no battle in between");
  const endedState = endTurnSpy.mock.calls[0]![0] as GameState;
  assert.equal(endedState.activePlayerId, 1);
  assert.equal(endedState.phase.kind, "AI_TURN");
});

test("resolveCurrentBattle holds onBattleResolved until the in-flight onAiMove persist settles (move-then-resolve ordering)", async () => {
  const initial = makeState({
    heroes: [
      makeHero("h0", 0, 12, 10, { stacks: normalizePlatoons([{ entries: [{ unitTypeId: "swordsman", count: 5 }] }]) }),
      makeHero("h1", 1, 10, 10),
    ],
    activePlayerId: 1,
    phase: { kind: "AI_TURN", playerId: 1 },
  });
  const hooks = buildHooks(initial);
  hooks.getMap = stubOpenMap();
  hooks.pickAiMove = (() => ({ toTile: { q: 11, r: 10 }, cost: 1 })) as TurnControllerHooks["pickAiMove"];
  const movePersist = deferred<void>();
  const order: string[] = [];
  hooks.onAiMove = (() => {
    order.push("onAiMove");
    return movePersist.promise;
  }) as TurnControllerHooks["onAiMove"];
  hooks.onBattleResolved = (async (s: GameState) => {
    order.push("onBattleResolved");
    return { state: s, battle: null };
  }) as TurnControllerHooks["onBattleResolved"];

  const controller = new TurnController(initial, hooks, { isPrimaryActor: () => true });
  controller.tick(16);

  assert.equal(controller.getState().phase.kind, "BATTLE", "the move landed adjacent and entered battle");
  assert.deepEqual(order, ["onAiMove"], "the move persist fired with the tick");

  const resolving = controller.resolveCurrentBattle();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(
    order,
    ["onAiMove"],
    "ResolveBattle must not dispatch while the move persist is still in flight (the 409 not_adjacent race)",
  );

  movePersist.resolve();
  await resolving;

  assert.deepEqual(
    order,
    ["onAiMove", "onBattleResolved"],
    "the resolve dispatch must follow the settled persist, in that order",
  );
  assert.equal(controller.getState().phase.kind, "AI_TURN", "the battle phase must clear after the resolution attempt");
});

test("ResolveBattle failure (hook returns no battle): no result surfaces, the battle phase clears, and the AI tick resumes", async () => {
  const initial = makeState({
    heroes: [
      makeHero("h0", 0, 12, 10, { stacks: normalizePlatoons([{ entries: [{ unitTypeId: "swordsman", count: 5 }] }]) }),
      makeHero("h1", 1, 10, 10),
    ],
    activePlayerId: 1,
    phase: { kind: "AI_TURN", playerId: 1 },
  });
  const hooks = buildHooks(initial);
  const endTurnSpy = getEndTurnSpy(hooks);
  hooks.getMap = stubOpenMap();
  hooks.pickAiMove = (() => ({ toTile: { q: 11, r: 10 }, cost: 1 })) as TurnControllerHooks["pickAiMove"];
  hooks.onAiMove = (() => Promise.resolve()) as TurnControllerHooks["onAiMove"];
  let resolveCalls = 0;
  hooks.onBattleResolved = (async (s: GameState) => {
    resolveCalls += 1;
    return { state: s, battle: null };
  }) as TurnControllerHooks["onBattleResolved"];

  const controller = new TurnController(initial, hooks, { isPrimaryActor: () => true });
  controller.tick(16);
  assert.equal(controller.getState().phase.kind, "BATTLE");

  const battle = await controller.resolveCurrentBattle();

  assert.equal(battle, null, "a failed resolution must surface no battle result (no card payload for the caller)");
  assert.equal(resolveCalls, 1, "the resolve dispatch must happen exactly once -- no re-resolve loop");
  const phase = controller.getState().phase;
  assert.equal(phase.kind, "AI_TURN", "the evaporation path must clear the battle phase so the tick can resume");
  assert.equal(phase.kind === "AI_TURN" ? phase.playerId : null, 1);

  hooks.pickAiMove = (() => null) as TurnControllerHooks["pickAiMove"];
  await settlePersist();
  controller.tick(16);
  await settlePersist();

  assert.equal(endTurnSpy.mock.callCount(), 1, "the AI turn completes on the next tick after the failed resolution");
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

test("AI battle merge removes a defeated attacker: hero deleted, heroIds pruned, selection cleared, and the AI turn resumes", async () => {
  const initial = makeState({
    heroes: [
      makeHero("h0", 0, 12, 10, { stacks: normalizePlatoons([{ entries: [{ unitTypeId: "swordsman", count: 5 }] }]) }),
      makeHero("h1", 1, 10, 10),
    ],
    activePlayerId: 1,
    phase: { kind: "AI_TURN", playerId: 1 },
  });
  const hooks = buildHooks(initial);
  const endTurnSpy = getEndTurnSpy(hooks);
  hooks.getMap = stubOpenMap();
  hooks.pickAiMove = (() => ({ toTile: { q: 11, r: 10 }, cost: 1 })) as TurnControllerHooks["pickAiMove"];
  hooks.onAiMove = (() => Promise.resolve()) as TurnControllerHooks["onAiMove"];
  hooks.onBattleResolved = (async (s: GameState) => {
    const defender = s.heroes["h0"];
    return {
      state: mergeBattleOutcomeHeroes(s, "h1", "h0", {
        attackerVerdict: "defeated",
        defenderHero: defender
          ? { ...defender, stacks: normalizePlatoons([{ entries: [{ unitTypeId: "swordsman", count: 2 }] }]) }
          : undefined,
      }),
      battle: null,
    };
  }) as TurnControllerHooks["onBattleResolved"];

  const controller = new TurnController(initial, hooks, { isPrimaryActor: () => true });
  controller.tick(16);
  assert.equal(controller.getState().phase.kind, "BATTLE");
  assert.equal(controller.getState().selectedHeroId, null, "startBattle clears selection before the resolve");

  await controller.resolveCurrentBattle();

  const after = controller.getState();
  assert.equal(after.heroes["h1"], undefined, "the defeated attacker must be deleted from state.heroes");
  assert.equal(after.players[1]?.heroIds.includes("h1"), false, "the owner's heroIds must be pruned");
  assert.equal(after.selectedHeroId, null, "the removal must not resurrect a selection");
  assert.ok(after.heroes["h0"], "the surviving defender stays in state.heroes");
  assert.equal(after.players[0]?.heroIds.includes("h0"), true, "the survivor's heroIds entry is untouched");
  assert.equal(after.phase.kind, "AI_TURN", "the AI turn resumes after the removal");

  hooks.pickAiMove = (() => null) as TurnControllerHooks["pickAiMove"];
  await settlePersist();
  controller.tick(16);
  await settlePersist();

  assert.equal(endTurnSpy.mock.callCount(), 1, "the AI turn completes with its hero gone");
  const endedState = endTurnSpy.mock.calls[0]![0] as GameState;
  assert.equal(endedState.players[1]?.heroIds.includes("h1"), false);
});

test("AI battle merge relocates a retreated attacker: new position merges, heroIds and selection survive, AI turn resumes", async () => {
  const initial = makeState({
    heroes: [
      makeHero("h0", 0, 12, 10, { stacks: normalizePlatoons([{ entries: [{ unitTypeId: "swordsman", count: 5 }] }]) }),
      makeHero("h1", 1, 10, 10),
    ],
    settlements: [makeSettlement("s0", 0, 2, 2), makeSettlement("s1", 1, 18, 4)],
    activePlayerId: 1,
    phase: { kind: "AI_TURN", playerId: 1 },
  });
  const hooks = buildHooks(initial);
  const endTurnSpy = getEndTurnSpy(hooks);
  hooks.getMap = stubOpenMap();
  hooks.pickAiMove = (() => ({ toTile: { q: 11, r: 10 }, cost: 1 })) as TurnControllerHooks["pickAiMove"];
  hooks.onAiMove = (() => Promise.resolve()) as TurnControllerHooks["onAiMove"];
  hooks.onBattleResolved = (async (s: GameState) => {
    const attacker = s.heroes["h1"];
    return {
      state: mergeBattleOutcomeHeroes(s, "h1", "h0", {
        attackerHero: attacker
          ? { ...attacker, q: 18, r: 4, stacks: [], movementRemaining: 0, trail: [{ q: 18, r: 4 }] }
          : undefined,
        attackerVerdict: "retreated",
        defenderHero: s.heroes["h0"],
      }),
      battle: null,
    };
  }) as TurnControllerHooks["onBattleResolved"];

  const controller = new TurnController(initial, hooks, { isPrimaryActor: () => true });
  controller.tick(16);
  assert.equal(controller.getState().phase.kind, "BATTLE");

  await controller.resolveCurrentBattle();

  const after = controller.getState();
  assert.equal(after.heroes["h1"]?.q, 18, "the retreated attacker merged at its relocation hex");
  assert.equal(after.heroes["h1"]?.r, 4);
  assert.ok(after.heroes["h1"] && after.heroes["h0"], "both heroes survive the retreat");
  assert.equal(after.players[1]?.heroIds.includes("h1"), true, "heroIds keep the retreated hero");
  assert.equal(after.players[0]?.heroIds.includes("h0"), true);
  assert.equal(after.selectedHeroId, null, "selection stays null through the battle flow (startBattle cleared it)");
  assert.equal(after.phase.kind, "AI_TURN", "the AI turn resumes after the retreat");

  hooks.pickAiMove = (() => null) as TurnControllerHooks["pickAiMove"];
  await settlePersist();
  controller.tick(16);
  await settlePersist();

  assert.equal(endTurnSpy.mock.callCount(), 1, "the AI turn completes after the retreat");
});

test("mergeBattleOutcomeHeroes tolerates already-absent heroes: idempotent re-merge is a reference-stable no-op", () => {
  const initial = makeState({ selectedHeroId: "h0" });
  const once = mergeBattleOutcomeHeroes(initial, "h0", "h1", {});
  assert.equal(once.heroes["h0"], undefined);
  assert.equal(once.heroes["h1"], undefined);
  assert.deepEqual(once.players[0]?.heroIds, []);
  assert.deepEqual(once.players[1]?.heroIds, []);
  assert.equal(once.selectedHeroId, null, "a selection pointing at a removed hero must clear");
  const twice = mergeBattleOutcomeHeroes(once, "h0", "h1", {});
  assert.equal(twice, once, "re-merging an already-applied omission must not throw and must not rebuild state");

  const withSurvivor = makeState({ selectedHeroId: "h0" });
  const kept = mergeBattleOutcomeHeroes(withSurvivor, "h1", "h0", {
    defenderHero: withSurvivor.heroes["h0"],
  });
  assert.equal(kept.selectedHeroId, "h0", "a surviving selected hero keeps client-local selection");
  assert.equal(kept.heroes["h1"], undefined, "the omitted attacker is still removed");
  assert.deepEqual(kept.players[1]?.heroIds, []);
  assert.deepEqual(kept.players[0]?.heroIds, ["h0"]);
});

test("settlement battle merge removes a defeated attacker: charter folded pre-merge, row deleted, heroIds pruned, selection cleared", () => {
  const initial = makeState({
    heroes: [makeHero("h0", 0, 5, 5, { isChartering: true, charterId: "c1" }), makeHero("h1", 1, 18, 4)],
    activeCharters: [makeCharter({ id: "c1", heroId: "h0", ownerId: 0 })],
    selectedHeroId: "h0",
  });

  const folded = cleanupDefeatedHeroCharters(initial, "h0");
  const merged = mergeBattleOutcomeHero(folded, "h0", undefined);

  assert.deepEqual(merged.activeCharters, [], "the outstanding charter dropped before the row removal");
  assert.equal(merged.heroes["h0"], undefined, "the omitted attacker is deleted from state.heroes");
  assert.deepEqual(merged.players[0]?.heroIds, [], "the owner's heroIds are pruned");
  assert.equal(merged.selectedHeroId, null, "a selection pointing at the removed hero clears");
  assert.ok(merged.heroes["h1"], "unrelated heroes survive");
  assert.equal(merged.players[0]?.settlementIds.includes("s0"), true, "settlement roster untouched");
});

test("settlement battle merge applies a relocated retreat/surrender attacker: position + trail reseed merge, selection survives", () => {
  const initial = makeState({
    heroes: [makeHero("h0", 0, 5, 5), makeHero("h1", 1, 18, 4)],
    settlements: [makeSettlement("s0", 0, 2, 2), makeSettlement("s1", 1, 18, 4)],
    selectedHeroId: "h0",
  });
  const home = initial.settlements["s0"];
  const relocated = relocateHeroToSettlement(
    { ...initial.heroes["h0"], stacks: [], troops: 0 },
    home,
  );

  const merged = mergeBattleOutcomeHero(initial, "h0", relocated);

  assert.equal(merged.heroes["h0"], relocated, "the relocated row replaces the local hero wholesale");
  assert.equal(merged.heroes["h0"]?.q, 2, "position merged at the settlement hex");
  assert.equal(merged.heroes["h0"]?.r, 2);
  assert.deepEqual(merged.heroes["h0"]?.trail, [{ q: 2, r: 2 }], "trail reseeded at the settlement");
  assert.equal(merged.heroes["h0"]?.movementRemaining, MOVEMENT_PER_TURN);
  assert.deepEqual(merged.players[0]?.heroIds, ["h0"], "heroIds keep the retreated hero");
  assert.equal(merged.selectedHeroId, "h0", "a surviving selected hero keeps client-local selection");
  assert.equal(merged.settlements, initial.settlements, "settlements untouched by the hero merge");
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
  assert.equal(
    controller.getState().heroes["h1"]?.gold,
    Math.min(CAPTURE_GOLD_REWARD, DEFAULT_TREASURY_WAGONS * WAGON_GOLD_CAPACITY),
    "the headroom-clamped CAPTURE_GOLD_REWARD lands on the mover (full 100g: empty purse, 2,500g soft-default cap)",
  );
  await settlePersist();
  assert.deepEqual(captureCalls[0], [1, "h1", "s2"], "onCaptureSettlement fires with the AI seat as actor (after the move persist settles)");
  assert.ok(controller.getState().players[1]?.settlementIds.includes("s2"));
  assert.equal(controller.getState().phase.kind, "AI_TURN", "a plain capture leaves the AI turn running");
  assert.equal(endTurnSpy.mock.callCount(), 0);
});

function walkInCaptureState(overrides: { heroQ?: number; heroR?: number; settlementQ?: number; settlementR?: number } = {}): GameState {
  return makeState({
    selectedHeroId: "h0",
    heroes: [makeHero("h0", 0, overrides.heroQ ?? 4, overrides.heroR ?? 2), makeHero("h1", 1, 18, 4)],
    settlements: [makeSettlement("s0", 0, 2, 2), makeSettlement("s1", 1, overrides.settlementQ ?? 5, overrides.settlementR ?? 2)],
  });
}

test("walk-in capture (human path): the CaptureSettlement POST dispatches only after the move persist settles", async () => {
  const initial = walkInCaptureState();
  const hooks = buildHooks(initial);
  const order: string[] = [];
  const movePersist = deferred<void>();
  const capturePost = deferred<void>();
  hooks.onHumanMove = (() => {
    order.push("onHumanMove");
    return movePersist.promise;
  }) as TurnControllerHooks["onHumanMove"];
  hooks.onCaptureSettlement = (() => {
    order.push("onCaptureSettlement");
    return capturePost.promise;
  }) as TurnControllerHooks["onCaptureSettlement"];

  const controller = new TurnController(initial, hooks);
  assert.equal(controller.requestMove("h0", { q: 5, r: 2 }, 1), true);

  assert.equal(controller.getState().settlements["s1"]?.ownerId, 0, "the optimistic capture applies immediately");
  assert.equal(
    controller.getState().heroes["h0"]?.gold,
    Math.min(CAPTURE_GOLD_REWARD, DEFAULT_TREASURY_WAGONS * WAGON_GOLD_CAPACITY),
    "the headroom-clamped CAPTURE_GOLD_REWARD lands optimistically (Phase 1 purse-cap clamp)",
  );
  assert.deepEqual(order, ["onHumanMove"], "only the move persist may have fired at move time");

  await settlePersist();
  assert.deepEqual(
    order,
    ["onHumanMove"],
    "onCaptureSettlement must not fire while the triggering move persist is in flight (the 409 hero_not_at_settlement race)",
  );

  movePersist.resolve();
  await settlePersist();
  assert.deepEqual(order, ["onHumanMove", "onCaptureSettlement"], "the capture POST follows the settled move persist");
  assert.equal(controller.getState().settlements["s1"]?.ownerId, 0, "the local capture stands when the server accepts");

  capturePost.resolve();
  await settlePersist();
});

test("walk-in capture (AI tick path): the CaptureSettlement POST dispatches only after the onAiMove persist settles", async () => {
  const initial = makeState({
    heroes: [makeHero("h0", 0, 2, 2), makeHero("h1", 1, 18, 4)],
    settlements: [makeSettlement("s0", 0, 2, 2), makeSettlement("s1", 1, 20, 8), makeSettlement("s2", null, 18, 5)],
    activePlayerId: 1,
    phase: { kind: "AI_TURN", playerId: 1 },
  });
  const hooks = buildHooks(initial);
  hooks.getMap = stubOpenMap();
  hooks.pickAiMove = (() => ({ toTile: { q: 18, r: 5 }, cost: 1 })) as TurnControllerHooks["pickAiMove"];
  const order: string[] = [];
  const captureCalls: unknown[][] = [];
  const movePersist = deferred<void>();
  const capturePost = deferred<void>();
  hooks.onAiMove = (() => {
    order.push("onAiMove");
    return movePersist.promise;
  }) as TurnControllerHooks["onAiMove"];
  hooks.onCaptureSettlement = ((...args: unknown[]) => {
    order.push("onCaptureSettlement");
    captureCalls.push(args);
    return capturePost.promise;
  }) as TurnControllerHooks["onCaptureSettlement"];

  const controller = new TurnController(initial, hooks);
  controller.tick(16);

  assert.equal(controller.getState().settlements["s2"]?.ownerId, 1, "the optimistic capture applies immediately");
  assert.deepEqual(order, ["onAiMove"], "only the AI move persist may have fired at tick time");

  await settlePersist();
  assert.deepEqual(order, ["onAiMove"], "onCaptureSettlement must not fire while the AI move persist is in flight");

  movePersist.resolve();
  await settlePersist();
  assert.deepEqual(order, ["onAiMove", "onCaptureSettlement"]);
  assert.deepEqual(captureCalls[0], [1, "h1", "s2"], "the capture POST fires with the AI seat as actor");

  capturePost.resolve();
  await settlePersist();
});

test("a rejected CaptureSettlement rolls the optimistic capture back: owner, roster, and gold restored", async () => {
  const initial = walkInCaptureState();
  const hooks = buildHooks(initial);
  const logs: { type: string; payload: Record<string, unknown> }[] = [];
  hooks.logEvent = (event) => {
    logs.push(event);
  };
  hooks.onHumanMove = (() => Promise.resolve()) as TurnControllerHooks["onHumanMove"];
  hooks.onCaptureSettlement = (() => Promise.reject(new Error("hero_not_at_settlement"))) as TurnControllerHooks["onCaptureSettlement"];

  const consoleWarn = console.warn;
  console.warn = () => {};
  try {
    const controller = new TurnController(initial, hooks);
    assert.equal(controller.requestMove("h0", { q: 5, r: 2 }, 1), true);
    assert.equal(controller.getState().settlements["s1"]?.ownerId, 0, "optimistic capture in place before the rejection arrives");

    await settlePersist();

    const after = controller.getState();
    assert.equal(after.settlements["s1"]?.ownerId, 1, "previous owner restored");
    assert.equal(after.heroes["h0"]?.gold, 0, "capture reward subtracted back to the starting purse");
    assert.deepEqual(after.players[0]?.settlementIds, ["s0"], "capturing seat's roster no longer lists the settlement");
    assert.deepEqual(after.players[1]?.settlementIds, ["s1"], "previous owner's roster restored");
    assert.ok(logs.some((l) => l.type === "capture_rolled_back"), "the rollback is logged");
  } finally {
    console.warn = consoleWarn;
  }
});

test("rollback is a no-op when the optimistic capture is no longer in place (sync already corrected ownership)", async () => {
  const initial = walkInCaptureState();
  const hooks = buildHooks(initial);
  let rejectCapture: ((reason: unknown) => void) | null = null;
  hooks.onHumanMove = (() => Promise.resolve()) as TurnControllerHooks["onHumanMove"];
  hooks.onCaptureSettlement = (() => new Promise<void>((_res, rej) => { rejectCapture = rej; })) as TurnControllerHooks["onCaptureSettlement"];

  const consoleWarn = console.warn;
  console.warn = () => {};
  try {
    const controller = new TurnController(initial, hooks);
    controller.requestMove("h0", { q: 5, r: 2 }, 1);
    assert.equal(controller.getState().settlements["s1"]?.ownerId, 0);

    await settlePersist();

    // A multiplayer sync replaces the controller's state while the capture
    // POST is in flight: the settlement flips back server-truth-side, so the
    // late rejection must NOT re-flip it.
    const synced = {
      ...controller.getState(),
      settlements: {
        ...controller.getState().settlements,
        s1: { ...controller.getState().settlements["s1"]!, ownerId: 1 },
      },
    };
    (controller as unknown as { state: GameState }).state = synced;

    rejectCapture!(new Error("hero_not_at_settlement"));
    await settlePersist();

    assert.equal(controller.getState().settlements["s1"]?.ownerId, 1, "the guarded rollback left the synced ownership alone");
  } finally {
    console.warn = consoleWarn;
  }
});

test("tryCaptureAt gate: a NEUTRAL settlement with a live garrison enters SETTLEMENT_BATTLE on walk-in", () => {
  const s2 = makeSettlement("s2", null, 2, 2);
  s2.stacks = normalizePlatoons([{ entries: [{ unitTypeId: "swordsman", count: 4 }] }]);
  const initial = makeState({
    heroes: [makeHero("h0", 0, 2, 2)],
    settlements: [makeSettlement("s0", 0, 18, 4), s2],
  });
  const controller = new TurnController(initial, buildHooks(initial));

  controller.selectHero("h0");

  const phase = controller.getState().phase;
  assert.equal(phase.kind, "SETTLEMENT_BATTLE", "neutral garrisoned settlements fight like enemy-owned ones");
  assert.equal(phase.kind === "SETTLEMENT_BATTLE" ? phase.settlementId : null, "s2");
  assert.equal(controller.getState().settlements["s2"]?.ownerId, null, "ownership unchanged while the garrison fights");
});

test("requestMove adjacent to a 0-troop enemy hero does NOT enter battle (human-path parity with the AI tick guard)", () => {
  const initial = makeState({
    selectedHeroId: "h0",
    heroes: [makeHero("h0", 0, 4, 2), makeHero("h1", 1, 5, 2, { stacks: [] })],
    settlements: [makeSettlement("s0", 0, 2, 2), makeSettlement("s1", 1, 18, 4)],
  });
  const controller = new TurnController(initial, buildHooks(initial));

  assert.equal(controller.requestMove("h0", { q: 5, r: 3 }, 1), true, "adjacent to the wiped hero at (5,2)");

  assert.equal(controller.getState().phase.kind, "PLAYER_TURN", "a zero-troop enemy must not open a battle");
});

test("requestMove adjacent to an enemy hero WITH troops still enters battle (guard is specific to 0-troop defenders)", () => {
  const initial = makeState({
    selectedHeroId: "h0",
    heroes: [
      makeHero("h0", 0, 4, 2),
      makeHero("h1", 1, 5, 2, { stacks: normalizePlatoons([{ entries: [{ unitTypeId: "swordsman", count: 3 }] }]) }),
    ],
    settlements: [makeSettlement("s0", 0, 2, 2), makeSettlement("s1", 1, 18, 4)],
  });
  const controller = new TurnController(initial, buildHooks(initial));

  assert.equal(controller.requestMove("h0", { q: 5, r: 3 }, 1), true);

  const phase = controller.getState().phase;
  assert.equal(phase.kind, "BATTLE");
  assert.equal(phase.kind === "BATTLE" ? phase.attackerId : null, "h0");
  assert.equal(phase.kind === "BATTLE" ? phase.defenderId : null, "h1");
});

test("requestMove onto a garrisoned enemy settlement with an enemy adjacent: the settlement battle is not clobbered by a BATTLE", async () => {
  const initial = makeState({
    selectedHeroId: "h0",
    heroes: [
      makeHero("h0", 0, 4, 2),
      makeHero("h1", 1, 5, 3, { stacks: normalizePlatoons([{ entries: [{ unitTypeId: "swordsman", count: 3 }] }]) }),
    ],
    settlements: [
      makeSettlement("s0", 0, 2, 2),
      garrisonedAt("s1", 1, 5, 2, "swordsman", 4),
    ],
  });
  const hooks = buildHooks(initial);
  hooks.onSettlementBattleSubmitted = async () => {};
  const controller = new TurnController(initial, hooks);

  assert.equal(controller.requestMove("h0", { q: 5, r: 2 }, 1), true, "the move onto the settlement lands");

  const phase = controller.getState().phase;
  assert.equal(
    phase.kind,
    "SETTLEMENT_BATTLE",
    "the garrisoned settlement opens the settlement battle and keeps the phase",
  );
  assert.equal(phase.kind === "SETTLEMENT_BATTLE" ? phase.settlementId : null, "s1");
  assert.notEqual(phase.kind, "BATTLE", "the adjacent h1 must not clobber it with a hero BATTLE");

  const resolution = await controller.resolveSettlementBattle(BATTLE_UNIT_TYPES);

  assert.ok(resolution);
  assert.equal(controller.getState().phase.kind, "PLAYER_TURN", "the human attacker's phase closes normally");
});

test("tryCaptureAt: a failed enterSettlementBattle falls back to a walk-in capture when the garrison is actually empty", () => {
  const s1 = makeSettlement("s1", 1, 2, 2);
  s1.stacks = normalizePlatoons([{ entries: [{ unitTypeId: "swordsman", count: 5 }] }]);
  const initial = makeState({
    heroes: [makeHero("h0", 0, 2, 2)],
    settlements: [makeSettlement("s0", 0, 18, 4), s1],
  });
  const hooks = buildHooks(initial);
  const controller = new TurnController(initial, hooks);
  controller.enterSettlementBattle = (_attackerId: HeroId, settlementId: SettlementId): boolean => {
    const s = controller.getState().settlements[settlementId];
    if (s) {
      (controller as unknown as { state: GameState }).state = {
        ...controller.getState(),
        settlements: { ...controller.getState().settlements, [settlementId]: { ...s, stacks: normalizePlatoons([]) } },
      };
    }
    return false;
  };

  controller.selectHero("h0");

  assert.equal(controller.getState().phase.kind, "PLAYER_TURN");
  assert.equal(controller.getState().settlements["s1"]?.ownerId, 0, "the emptied garrison falls back to a walk-in capture");
});

test("tryCaptureAt: a failed enterSettlementBattle with a live garrison surfaces a diagnostic instead of silently abandoning", () => {
  const s1 = makeSettlement("s1", 1, 2, 2);
  s1.stacks = normalizePlatoons([{ entries: [{ unitTypeId: "swordsman", count: 5 }] }]);
  const initial = makeState({
    heroes: [makeHero("h0", 0, 2, 2)],
    settlements: [makeSettlement("s0", 0, 18, 4), s1],
  });
  const controller = new TurnController(initial, buildHooks(initial));
  controller.enterSettlementBattle = (): boolean => false;
  const rejections: unknown[] = [];
  const handler = (e: unknown): void => {
    rejections.push(e);
  };
  bus.on("command:rejected", handler);

  try {
    controller.selectHero("h0");
  } finally {
    bus.off("command:rejected", handler);
  }

  assert.equal(controller.getState().phase.kind, "PLAYER_TURN");
  assert.equal(controller.getState().settlements["s1"]?.ownerId, 1, "no capture while the garrison still holds");
  assert.equal(rejections.length, 1, "exactly one diagnostic reached the toast layer");
});

test("AI walking onto a favorable garrisoned settlement auto-resolves a win: owner flips, garrison zeroed, AI turn completes", async () => {
  const initial = makeState({
    heroes: [
      makeHero("h0", 0, 2, 2, { stacks: [] }),
      makeHero("h1", 1, 10, 10, { stacks: stackOf("champ", 15) }),
    ],
    settlements: [garrisonedAt("s0", 0, 11, 10, "trash", 1)],
    activePlayerId: 1,
    phase: { kind: "AI_TURN", playerId: 1 },
  });
  const hooks = buildHooks(initial);
  const endTurnSpy = getEndTurnSpy(hooks);
  hooks.getMap = stubOpenMap();
  hooks.pickAiMove = (() => ({ toTile: { q: 11, r: 10 }, cost: 1 })) as TurnControllerHooks["pickAiMove"];
  hooks.onAiMove = (() => Promise.resolve()) as TurnControllerHooks["onAiMove"];
  const submissions: Parameters<TurnControllerHooks["onSettlementBattleSubmitted"]>[0][] = [];
  hooks.onSettlementBattleSubmitted = async (payload) => {
    submissions.push(payload);
  };

  const controller = new TurnController(initial, hooks, { isPrimaryActor: () => true });
  controller.tick(16);

  const phase = controller.getState().phase;
  assert.equal(phase.kind, "SETTLEMENT_BATTLE", "the garrison holds the tile, so walk-in opens the settlement battle");
  assert.equal(phase.kind === "SETTLEMENT_BATTLE" ? phase.attackerId : null, "h1");
  assert.equal(phase.kind === "SETTLEMENT_BATTLE" ? phase.settlementId : null, "s0");

  const resolution = await controller.resolveSettlementBattle(BATTLE_UNIT_TYPES);

  assert.ok(resolution, "the auto-resolver must produce a resolution");
  assert.equal(resolution!.outcome, "attackerWon");
  assert.equal(resolution!.captured, true, "a won settlement battle captures inline");
  assert.equal(resolution!.battle.winner, "attacker");
  const after = controller.getState();
  assert.equal(after.settlements["s0"]?.ownerId, 1, "the capture flips ownership to the AI seat");
  assert.deepEqual(after.settlements["s0"]?.stacks, normalizePlatoons([]), "the garrison is zeroed on a win");
  assert.equal(after.players[1]?.settlementIds.includes("s0"), true, "the AI seat's roster gains the settlement");
  assert.equal(
    after.phase.kind,
    "AI_TURN",
    "endBattlePhase's PLAYER_TURN must be re-mapped so the AI tick resumes",
  );
  assert.equal(submissions.length, 1, "the result is POSTed fire-and-forget");
  assert.equal(submissions[0]!.actor, 1, "the AI seat is the command actor");
  assert.equal(submissions[0]!.outcome, "attackerWon");
  assert.equal(submissions[0]!.attackerId, "h1");
  assert.equal(submissions[0]!.settlementId, "s0");

  hooks.pickAiMove = (() => null) as TurnControllerHooks["pickAiMove"];
  await settlePersist();
  controller.tick(16);
  await settlePersist();

  assert.equal(endTurnSpy.mock.callCount(), 1, "after the battle the AI turn resumes and completes");
  const endedState = endTurnSpy.mock.calls[0]![0] as GameState;
  assert.equal(endedState.activePlayerId, 1);
});

test("an auto-resolved settlement-battle defeat removes the AI attacker and the turn still completes", async () => {
  const initial = makeState({
    heroes: [
      makeHero("h0", 0, 2, 2, { stacks: [] }),
      makeHero("h1", 1, 10, 10, { stacks: stackOf("trash", 1) }),
    ],
    settlements: [garrisonedAt("s0", 0, 11, 10, "champ", 20)],
    activePlayerId: 1,
    phase: { kind: "AI_TURN", playerId: 1 },
  });
  const hooks = buildHooks(initial);
  const endTurnSpy = getEndTurnSpy(hooks);
  hooks.getMap = stubOpenMap();
  hooks.pickAiMove = (() => ({ toTile: { q: 11, r: 10 }, cost: 1 })) as TurnControllerHooks["pickAiMove"];
  hooks.onAiMove = (() => Promise.resolve()) as TurnControllerHooks["onAiMove"];
  hooks.onSettlementBattleSubmitted = async () => {};

  const controller = new TurnController(initial, hooks, { isPrimaryActor: () => true });
  controller.tick(16);
  assert.equal(controller.getState().phase.kind, "SETTLEMENT_BATTLE");

  const resolution = await controller.resolveSettlementBattle(BATTLE_UNIT_TYPES);

  assert.ok(resolution);
  assert.equal(resolution!.outcome, "defenderWon");
  assert.equal(resolution!.captured, false);
  assert.equal(resolution!.attackerVerdict, "defeated", "a wiped attacker is defeated, not merely stood");
  const after = controller.getState();
  assert.equal(after.heroes["h1"], undefined, "the defeated attacker is deleted from state.heroes");
  assert.equal(after.players[1]?.heroIds.includes("h1"), false, "the owner's heroIds are pruned");
  assert.equal(after.settlements["s0"]?.ownerId, 0, "the garrison held: ownership unchanged");
  assert.equal(after.phase.kind, "AI_TURN", "the AI tick resumes even though the attacker is gone");

  await settlePersist();
  controller.tick(16);
  await settlePersist();

  assert.equal(endTurnSpy.mock.callCount(), 1, "with no heroIds left the AI turn completes");
});

test("a stalemate settlement battle bounces the attacker and the garrison persists per the submitted stacks", async () => {
  const initial = makeState({
    heroes: [
      makeHero("h0", 0, 2, 2, { stacks: [] }),
      makeHero("h1", 1, 10, 10, { stacks: stackOf("wall", 5) }),
    ],
    settlements: [garrisonedAt("s0", 0, 11, 10, "wall", 5)],
    activePlayerId: 1,
    phase: { kind: "AI_TURN", playerId: 1 },
  });
  const hooks = buildHooks(initial);
  const endTurnSpy = getEndTurnSpy(hooks);
  hooks.getMap = stubOpenMap();
  hooks.pickAiMove = (() => ({ toTile: { q: 11, r: 10 }, cost: 1 })) as TurnControllerHooks["pickAiMove"];
  hooks.onAiMove = (() => Promise.resolve()) as TurnControllerHooks["onAiMove"];
  const submissions: Parameters<TurnControllerHooks["onSettlementBattleSubmitted"]>[0][] = [];
  hooks.onSettlementBattleSubmitted = async (payload) => {
    submissions.push(payload);
  };

  const controller = new TurnController(initial, hooks, { isPrimaryActor: () => true });
  controller.tick(16);
  assert.equal(controller.getState().phase.kind, "SETTLEMENT_BATTLE");

  const resolution = await controller.resolveSettlementBattle(BATTLE_UNIT_TYPES);

  assert.ok(resolution);
  assert.equal(resolution!.outcome, "draw", "walls grind to the 30-round cap: both sides survive");
  assert.equal(resolution!.captured, false);
  assert.equal(resolution!.attackerVerdict, "stood", "survivors mean no removal and no relocation");
  const after = controller.getState();
  assert.equal(after.heroes["h1"]?.q, 10, "the bounced attacker is back at its pre-battle tile");
  assert.equal(after.heroes["h1"]?.r, 10);
  assert.equal(after.settlements["s0"]?.ownerId, 0, "no capture on a stalemate");
  assert.deepEqual(
    after.settlements["s0"]?.stacks,
    normalizePlatoons(submissions[0]!.defenderStacks),
    "the persisted garrison equals the submitted defender stacks",
  );
  assert.equal(after.phase.kind, "AI_TURN", "the AI tick resumes after the bounce");

  hooks.pickAiMove = (() => null) as TurnControllerHooks["pickAiMove"];
  await settlePersist();
  controller.tick(16);
  await settlePersist();

  assert.equal(endTurnSpy.mock.callCount(), 1, "the AI turn completes after the bounced attack");
});

test("a capture-triggered settlement battle suppresses the same-move adjacency enterBattle (no phase clobber)", async () => {
  const initial = makeState({
    heroes: [
      makeHero("h0", 0, 11, 9, { stacks: stackOf("champ", 5) }),
      makeHero("h1", 1, 10, 10, { stacks: stackOf("champ", 15) }),
    ],
    settlements: [garrisonedAt("s0", 0, 11, 10, "trash", 1)],
    activePlayerId: 1,
    phase: { kind: "AI_TURN", playerId: 1 },
  });
  const hooks = buildHooks(initial);
  hooks.getMap = stubOpenMap();
  hooks.pickAiMove = (() => ({ toTile: { q: 11, r: 10 }, cost: 1 })) as TurnControllerHooks["pickAiMove"];
  hooks.onAiMove = (() => Promise.resolve()) as TurnControllerHooks["onAiMove"];
  hooks.onSettlementBattleSubmitted = async () => {};

  const controller = new TurnController(initial, hooks, { isPrimaryActor: () => true });
  controller.tick(16);

  const phase = controller.getState().phase;
  assert.equal(
    phase.kind,
    "SETTLEMENT_BATTLE",
    "the settlement battle opened by tryCaptureAt must own the phase",
  );
  assert.notEqual(
    phase.kind,
    "BATTLE",
    "the adjacent enemy hero (h0) must not clobber the settlement battle with a hero BATTLE",
  );
  assert.equal(phase.kind === "SETTLEMENT_BATTLE" ? phase.settlementId : null, "s0");
});

test("isPrimaryActor: false keeps the AI from even walking into a garrisoned settlement", () => {
  const initial = makeState({
    heroes: [
      makeHero("h0", 0, 2, 2, { stacks: [] }),
      makeHero("h1", 1, 10, 10, { stacks: stackOf("champ", 15) }),
    ],
    settlements: [garrisonedAt("s0", 0, 11, 10, "trash", 1)],
    activePlayerId: 1,
    phase: { kind: "AI_TURN", playerId: 1 },
  });
  const hooks = buildHooks(initial);
  hooks.getMap = stubOpenMap();
  hooks.pickAiMove = (() => ({ toTile: { q: 11, r: 10 }, cost: 1 })) as TurnControllerHooks["pickAiMove"];
  hooks.onAiMove = (() => Promise.resolve()) as TurnControllerHooks["onAiMove"];

  const controller = new TurnController(initial, hooks, { isPrimaryActor: () => false });
  controller.tick(16);

  assert.equal(controller.getState(), initial, "state must be untouched on a non-primary client");
  assert.equal(controller.getState().phase.kind, "AI_TURN", "no settlement battle forms off the primary actor");
});

test("resolveSettlementBattle without a unit catalog bounces the attacker instead of inventing a result", async () => {
  const initial = makeState({
    heroes: [
      makeHero("h0", 0, 2, 2, { stacks: [] }),
      makeHero("h1", 1, 10, 10, { stacks: stackOf("champ", 15) }),
    ],
    settlements: [garrisonedAt("s0", 0, 11, 10, "trash", 1)],
    activePlayerId: 1,
    phase: { kind: "AI_TURN", playerId: 1 },
  });
  const hooks = buildHooks(initial);
  hooks.getMap = stubOpenMap();
  hooks.pickAiMove = (() => ({ toTile: { q: 11, r: 10 }, cost: 1 })) as TurnControllerHooks["pickAiMove"];
  hooks.onAiMove = (() => Promise.resolve()) as TurnControllerHooks["onAiMove"];
  let submitted = 0;
  hooks.onSettlementBattleSubmitted = async () => {
    submitted += 1;
  };

  const controller = new TurnController(initial, hooks, { isPrimaryActor: () => true });
  controller.tick(16);
  assert.equal(controller.getState().phase.kind, "SETTLEMENT_BATTLE");

  const resolution = await controller.resolveSettlementBattle(null);

  assert.equal(resolution, null, "no catalog means no casualty report and no resolution");
  assert.equal(submitted, 0, "nothing is POSTed when the battle could not resolve");
  const after = controller.getState();
  assert.equal(after.heroes["h1"]?.q, 10, "the attacker is bounced back to its pre-battle tile");
  assert.equal(after.settlements["s0"]?.ownerId, 0, "no capture without a resolution");
  assert.equal(after.phase.kind, "AI_TURN", "the phase clears so the tick can resume");
});

test("a rejected AI move persist rolls the walk-in back, cancels the battle it opened, submits nothing, and the turn still ends server-visibly", async () => {
  const initial = makeState({
    heroes: [
      makeHero("h0", 0, 2, 2, { stacks: [] }),
      makeHero("h1", 1, 10, 10, { stacks: stackOf("champ", 15) }),
    ],
    settlements: [garrisonedAt("s0", 0, 11, 10, "trash", 1)],
    activePlayerId: 1,
    phase: { kind: "AI_TURN", playerId: 1 },
  });
  const hooks = buildHooks(initial);
  hooks.getMap = stubOpenMap();
  hooks.pickAiMove = (() => ({ toTile: { q: 11, r: 10 }, cost: 1 })) as TurnControllerHooks["pickAiMove"];
  hooks.onAiMove = (() => Promise.reject(new Error("hero_not_at_fromTile"))) as TurnControllerHooks["onAiMove"];
  let submitted = 0;
  hooks.onSettlementBattleSubmitted = async () => {
    submitted += 1;
  };
  const logs: { type: string; payload: Record<string, unknown> }[] = [];
  hooks.logEvent = (event) => {
    logs.push(event);
  };

  const controller = new TurnController(initial, hooks, { isPrimaryActor: () => true });
  controller.tick(16);
  assert.equal(controller.getState().phase.kind, "SETTLEMENT_BATTLE", "the walk-in opens the assault optimistically");
  assert.equal(controller.getState().heroes["h1"]?.q, 11, "the optimistic move put the hero on the settlement");

  await settlePersist();

  const after = controller.getState();
  assert.equal(after.phase.kind, "AI_TURN", "the battle opened behind the failed persist is cancelled");
  assert.equal(after.heroes["h1"]?.q, 10, "the optimistic move is un-walked back to the server's tile");
  assert.equal(after.heroes["h1"]?.r, 10);
  assert.equal(
    after.heroes["h1"]?.movementRemaining,
    MOVEMENT_PER_TURN,
    "the spent movement is restored so the tick can re-plan",
  );
  assert.ok(
    logs.some((l) => l.type === "ai_move_persist_failed"),
    "the rollback is visible in the event log",
  );
  assert.equal(await controller.resolveSettlementBattle(BATTLE_UNIT_TYPES), null, "no resolution runs against the phantom position");
  assert.equal(submitted, 0, "no battle result is POSTed for the cancelled battle");

  hooks.pickAiMove = (() => null) as TurnControllerHooks["pickAiMove"];
  controller.tick(16);
  await settlePersist();
  assert.equal(getEndTurnSpy(hooks).mock.callCount(), 1, "the turn still ends (the EndTurn POST is attempted) after the rollback");
});

test("resolveSettlementBattle gates the next AI move until the battle submit settles", async () => {
  const initial = makeState({
    heroes: [
      makeHero("h0", 0, 2, 2, { stacks: [] }),
      makeHero("h1", 1, 10, 10, { stacks: stackOf("wall", 5) }),
    ],
    settlements: [garrisonedAt("s0", 0, 11, 10, "wall", 5)],
    activePlayerId: 1,
    phase: { kind: "AI_TURN", playerId: 1 },
  });
  const hooks = buildHooks(initial);
  hooks.getMap = stubOpenMap();
  const pickCalls: number[] = [];
  hooks.pickAiMove = (() => {
    pickCalls.push(pickCalls.length);
    return { toTile: { q: 11, r: 10 }, cost: 1 };
  }) as TurnControllerHooks["pickAiMove"];
  hooks.onAiMove = (() => Promise.resolve()) as TurnControllerHooks["onAiMove"];
  const order: string[] = [];
  const submitPost = deferred<void>();
  hooks.onSettlementBattleSubmitted = async () => {
    order.push("submit");
    await submitPost.promise;
  };

  const controller = new TurnController(initial, hooks, { isPrimaryActor: () => true });
  controller.tick(16);
  assert.equal(controller.getState().phase.kind, "SETTLEMENT_BATTLE");

  const resolutionPromise = controller.resolveSettlementBattle(BATTLE_UNIT_TYPES);
  await settlePersist();
  assert.deepEqual(order, ["submit"], "the submit fired but has not settled");
  assert.equal(pickCalls.length, 1, "no further move was planned while the submit is in flight");

  controller.tick(16);
  assert.equal(pickCalls.length, 1, "the tick is gated (aiAwaitingPersist) until the submit settles");

  submitPost.resolve();
  const resolution = await resolutionPromise;
  await settlePersist();
  assert.equal(resolution?.outcome, "draw", "the walled garrison holds (draw -> bounced attacker, movement restored)");

  hooks.pickAiMove = (() => {
    pickCalls.push(pickCalls.length);
    return { toTile: { q: 18, r: 4 }, cost: 1 };
  }) as TurnControllerHooks["pickAiMove"];
  controller.tick(16);
  assert.equal(pickCalls.length, 2, "the tick resumes once the submit settled");
});

test("cancelSettlementBattle ends the phase with the hero on the tile, the garrison intact, and nothing submitted", () => {
  const s1 = makeSettlement("s1", 1, 2, 2);
  s1.stacks = normalizePlatoons([{ entries: [{ unitTypeId: "swordsman", count: 5 }] }]);
  const initial = makeState({
    heroes: [makeHero("h0", 0, 2, 2)],
    settlements: [makeSettlement("s0", 0, 18, 4), s1],
  });
  const hooks = buildHooks(initial);
  let submitted = 0;
  hooks.onSettlementBattleSubmitted = async () => {
    submitted += 1;
  };
  const controller = new TurnController(initial, hooks);

  controller.selectHero("h0");
  assert.equal(controller.getState().phase.kind, "SETTLEMENT_BATTLE");

  assert.equal(controller.cancelSettlementBattle(), true);
  const after = controller.getState();
  assert.equal(after.phase.kind, "PLAYER_TURN", "the phase ends without resolving or submitting anything");
  assert.equal(after.heroes["h0"]?.q, 2, "the hero stays standing on the settlement tile");
  assert.equal(after.heroes["h0"]?.r, 2);
  assert.equal(
    after.heroes["h0"]?.movementRemaining,
    MOVEMENT_PER_TURN,
    "the already-persisted walk-in move is not rolled back",
  );
  assert.equal(after.settlements["s1"]?.ownerId, 1, "no capture");
  assert.deepEqual(
    after.settlements["s1"]?.stacks?.[0]?.entries,
    [{ unitTypeId: "swordsman", count: 5 }],
    "the garrison is untouched",
  );
  assert.equal(after.selectedHeroId, "h0", "the hero selection survives the cancel");
  assert.equal(submitted, 0, "no battle result is POSTed");

  controller.selectHero("h0");
  assert.equal(
    controller.getState().phase.kind,
    "SETTLEMENT_BATTLE",
    "re-selecting the hero re-runs tryCaptureAt and re-opens the assault flow",
  );
});

test("cancelSettlementBattle is a no-op outside SETTLEMENT_BATTLE", () => {
  const initial = makeState();
  const controller = new TurnController(initial, buildHooks(initial));
  assert.equal(controller.cancelSettlementBattle(), false);
  assert.equal(controller.getState(), initial);
});

// ---------------------------------------------------------------------------
// B1: AI garrison recruitment through the existing RecruitUnits command path
// ---------------------------------------------------------------------------

function aiTown(gold: number, buildings: Array<{ gx: number; gy: number; kind: "farmhouse" | "barracks"; level: number }>) {
  return makeSettlement("s1", 1, 18, 4, {
    gold,
    buildings: buildings.map((b) => ({ ...b, style: "classic" as const })),
  });
}

function aiRecruitState(town: ReturnType<typeof makeSettlement>, heroOverrides: { movementRemaining?: number } = {}) {
  return makeState({
    heroes: [makeHero("h0", 0, 2, 2), makeHero("h1", 1, 10, 10, heroOverrides)],
    settlements: [makeSettlement("s0", 0, 2, 2), town],
    activePlayerId: 1,
    phase: { kind: "AI_TURN", playerId: 1 },
  });
}

test("B1: the AI tick submits RecruitUnits with the AI seat as actor; the garrison grows and gold drops", async () => {
  const initial = aiRecruitState(aiTown(500, [{ gx: 2, gy: 2, kind: "farmhouse", level: 1 }]), { movementRemaining: 0 });
  const hooks = buildHooks(initial);
  const endTurnSpy = getEndTurnSpy(hooks);
  const recruitCalls: unknown[][] = [];
  hooks.onRecruitUnits = ((...args: unknown[]) => {
    recruitCalls.push(args);
    return Promise.resolve();
  }) as TurnControllerHooks["onRecruitUnits"];
  hooks.pickGarrisonRecruitment = () => [
    { settlementId: "s1", buildingKind: "farmhouse", gx: 2, gy: 2, unitTypeId: "peasant", count: 2 },
  ];
  backoffRoundAdvance(hooks);

  const controller = new TurnController(initial, hooks, { isPrimaryActor: () => true });
  controller.tick(16);
  await settlePersist();

  const town = controller.getState().settlements["s1"];
  assert.deepEqual(town?.stacks?.[0]?.entries, [{ unitTypeId: "peasant", count: 2 }], "the optimistic garrison deposit applied locally");
  assert.equal(town?.gold, 450, "2 peasants at 25g each were paid from the settlement treasury");
  assert.deepEqual(recruitCalls[0], [1, "s1", "farmhouse", 2, 2, "peasant", 2], "onRecruitUnits fired with the AI seat as actor");
  assert.equal(endTurnSpy.mock.callCount(), 1, "the recruit command was drained before the turn ended");
});

test("B1: recruitment runs once per AI turn -- repeated ticks don't re-recruit, the next round does", async () => {
  const initial = aiRecruitState(aiTown(500, [{ gx: 2, gy: 2, kind: "farmhouse", level: 1 }]));
  const hooks = buildHooks(initial);
  const endTurnSpy = getEndTurnSpy(hooks);
  let recruitSubmissions = 0;
  hooks.onRecruitUnits = (() => {
    recruitSubmissions += 1;
    return Promise.resolve();
  }) as TurnControllerHooks["onRecruitUnits"];
  hooks.pickGarrisonRecruitment = () => [
    { settlementId: "s1", buildingKind: "farmhouse", gx: 2, gy: 2, unitTypeId: "peasant", count: 1 },
  ];
  let pickCalls = 0;
  hooks.pickAiMove = (() => (pickCalls++ === 0 ? { toTile: { q: 11, r: 10 }, cost: 1 } : null)) as TurnControllerHooks["pickAiMove"];
  hooks.onAiMove = (() => Promise.resolve()) as TurnControllerHooks["onAiMove"];
  hooks.getMap = stubOpenMap();
  backoffRoundAdvance(hooks);

  const controller = new TurnController(initial, hooks, { isPrimaryActor: () => true });
  controller.tick(16);
  assert.equal(recruitSubmissions, 1, "the turn's first tick recruits");
  await settlePersist();

  controller.tick(16);
  await settlePersist();
  assert.equal(recruitSubmissions, 1, "the same round+seat never re-recruits");
  assert.equal(endTurnSpy.mock.callCount(), 1, "the round-1 turn completed");

  controller.tick(16);
  await settlePersist();
  assert.equal(recruitSubmissions, 2, "a new round recruits again");
  assert.equal(controller.getState().settlements["s1"]?.gold, 450, "two rounds of 1-peasant recruits at 25g each");
});

test("B1: rejected recruit entries log and continue -- the AI turn still completes", async () => {
  const initial = aiRecruitState(aiTown(500, [{ gx: 2, gy: 2, kind: "farmhouse", level: 1 }]), { movementRemaining: 0 });
  const hooks = buildHooks(initial);
  const endTurnSpy = getEndTurnSpy(hooks);
  const rejections: Array<Record<string, unknown>> = [];
  hooks.logEvent = (event) => {
    if (event.type === "ai_garrison_recruit_rejected") rejections.push(event.payload);
  };
  let submitted = 0;
  hooks.onRecruitUnits = (() => {
    submitted += 1;
    return Promise.resolve();
  }) as TurnControllerHooks["onRecruitUnits"];
  hooks.pickGarrisonRecruitment = () => [
    { settlementId: "s1", buildingKind: "barracks", gx: 9, gy: 9, unitTypeId: "swordsman", count: 1 },
    { settlementId: "sX", buildingKind: "farmhouse", gx: 2, gy: 2, unitTypeId: "peasant", count: 1 },
  ];

  const controller = new TurnController(initial, hooks, { isPrimaryActor: () => true });
  controller.tick(16);
  await settlePersist();

  assert.equal(submitted, 0, "neither rejected entry reached the command hook");
  assert.equal(rejections.length, 2, "each rejection is logged with its item");
  assert.deepEqual(rejections[0], { seat: 1, settlementId: "s1", unitTypeId: "swordsman", count: 1 });
  assert.equal(endTurnSpy.mock.callCount(), 1, "the AI turn completes despite both rejections");
});

// ---------------------------------------------------------------------------
// I1: AI re-attack backoff
// ---------------------------------------------------------------------------

function backoffRoundAdvance(hooks: TurnControllerHooks): void {
  const inner = hooks.onHumanTurnEnd;
  hooks.onHumanTurnEnd = async (s: GameState): Promise<GameState> => {
    void inner(s);
    return {
      ...s,
      round: s.round + 1,
      activePlayerId: 1,
      phase: { kind: "AI_TURN", playerId: 1 },
    };
  };
}

test("I1: a drawn garrison assault excludes the settlement for the backoff window, then expires", async () => {
  const initial = makeState({
    heroes: [
      makeHero("h0", 0, 2, 2, { stacks: [] }),
      makeHero("h1", 1, 10, 10, { stacks: stackOf("wall", 5) }),
    ],
    settlements: [garrisonedAt("s0", 0, 11, 10, "wall", 5)],
    activePlayerId: 1,
    phase: { kind: "AI_TURN", playerId: 1 },
    round: 5,
  });
  const hooks = buildHooks(initial);
  const endTurnSpy = getEndTurnSpy(hooks);
  hooks.getMap = stubOpenMap();
  const exclusionsByTick: Array<ReadonlySet<string>> = [];
  let moving = true;
  hooks.pickAiMove = ((_state: GameState, _heroId: HeroId, excluded?: ReadonlySet<string>) => {
    exclusionsByTick.push(excluded ?? new Set<string>());
    return moving ? { toTile: { q: 11, r: 10 }, cost: 1 } : null;
  }) as TurnControllerHooks["pickAiMove"];
  hooks.onAiMove = (() => Promise.resolve()) as TurnControllerHooks["onAiMove"];
  hooks.onSettlementBattleSubmitted = async () => {};
  backoffRoundAdvance(hooks);

  const controller = new TurnController(initial, hooks, { isPrimaryActor: () => true });
  controller.tick(16);
  assert.equal(controller.getState().phase.kind, "SETTLEMENT_BATTLE", "the walk-in opened the assault");
  const resolution = await controller.resolveSettlementBattle(BATTLE_UNIT_TYPES);
  assert.equal(resolution!.outcome, "draw", "walls vs walls grind to the cap: the garrison held");

  moving = false;
  await settlePersist();
  controller.tick(16);
  await settlePersist();
  controller.tick(16);
  await settlePersist();
  controller.tick(16);
  await settlePersist();

  assert.deepEqual(exclusionsByTick[0], new Set(), "the attacking tick itself has no exclusions yet");
  assert.deepEqual(exclusionsByTick[1], new Set(["s0"]), "the tick after the bounce excludes the settlement (recorded round 5, expiry 7)");
  assert.deepEqual(exclusionsByTick[2], new Set(["s0"]), "round 6 is still inside the window");
  assert.deepEqual(exclusionsByTick[3], new Set(), "round 7 = expiry: the settlement is targetable again");
  assert.equal(endTurnSpy.mock.callCount(), 3, "every post-battle tick ended its turn cleanly");
});

test("I1: a won settlement battle creates no backoff entry", async () => {
  const initial = makeState({
    heroes: [
      makeHero("h0", 0, 2, 2, { stacks: [] }),
      makeHero("h1", 1, 10, 10, { stacks: stackOf("champ", 15) }),
    ],
    settlements: [garrisonedAt("s0", 0, 11, 10, "trash", 1)],
    activePlayerId: 1,
    phase: { kind: "AI_TURN", playerId: 1 },
    round: 5,
  });
  const hooks = buildHooks(initial);
  hooks.getMap = stubOpenMap();
  const exclusionsByTick: Array<ReadonlySet<string>> = [];
  let moving = true;
  hooks.pickAiMove = ((_state: GameState, _heroId: HeroId, excluded?: ReadonlySet<string>) => {
    exclusionsByTick.push(excluded ?? new Set<string>());
    return moving ? { toTile: { q: 11, r: 10 }, cost: 1 } : null;
  }) as TurnControllerHooks["pickAiMove"];
  hooks.onAiMove = (() => Promise.resolve()) as TurnControllerHooks["onAiMove"];
  hooks.onSettlementBattleSubmitted = async () => {};
  backoffRoundAdvance(hooks);

  const controller = new TurnController(initial, hooks, { isPrimaryActor: () => true });
  controller.tick(16);
  const resolution = await controller.resolveSettlementBattle(BATTLE_UNIT_TYPES);

  assert.equal(resolution!.outcome, "attackerWon");
  assert.equal(controller.getState().settlements["s0"]?.ownerId, 1, "the win captured the settlement");

  moving = false;
  await settlePersist();
  controller.tick(16);
  await settlePersist();

  assert.deepEqual(exclusionsByTick[1], new Set(), "a win never backs off: the next tick has no exclusions");
});

test("I1: a human-attacker settlement battle resolution never records a backoff entry", async () => {
  const initial = makeState({
    heroes: [makeHero("h0", 0, 10, 10, { stacks: stackOf("wall", 5) }), makeHero("h1", 1, 18, 4)],
    settlements: [garrisonedAt("s1", 1, 11, 10, "wall", 5)],
    selectedHeroId: "h0",
  });
  const hooks = buildHooks(initial);
  hooks.onSettlementBattleSubmitted = async () => {};
  const controller = new TurnController(initial, hooks);
  (controller as unknown as { state: GameState }).state = {
    ...initial,
    phase: { kind: "SETTLEMENT_BATTLE", attackerId: "h0", settlementId: "s1" },
  };

  const resolution = await controller.resolveSettlementBattle(BATTLE_UNIT_TYPES);

  assert.equal(resolution!.outcome, "draw", "walls vs walls: the assault bounced");
  assert.equal(
    (controller as unknown as { aiMemory: AiTurnMemory }).aiMemory.garrisonBackoff.size,
    0,
    "human attackers never enter the backoff map",
  );
});

test("I1: the backoff survives a controller rebuild on a shared AiTurnMemory (the replaceState path)", async () => {
  const initial = makeState({
    heroes: [
      makeHero("h0", 0, 2, 2, { stacks: [] }),
      makeHero("h1", 1, 10, 10, { stacks: stackOf("wall", 5) }),
    ],
    settlements: [garrisonedAt("s0", 0, 11, 10, "wall", 5)],
    activePlayerId: 1,
    phase: { kind: "AI_TURN", playerId: 1 },
    round: 5,
  });
  const hooks = buildHooks(initial);
  const endTurnSpy = getEndTurnSpy(hooks);
  hooks.getMap = stubOpenMap();
  const exclusionsByTick: Array<ReadonlySet<string>> = [];
  let moving = true;
  hooks.pickAiMove = ((_state: GameState, _heroId: HeroId, excluded?: ReadonlySet<string>) => {
    exclusionsByTick.push(excluded ?? new Set<string>());
    return moving ? { toTile: { q: 11, r: 10 }, cost: 1 } : null;
  }) as TurnControllerHooks["pickAiMove"];
  hooks.onAiMove = (() => Promise.resolve()) as TurnControllerHooks["onAiMove"];
  hooks.onSettlementBattleSubmitted = async () => {};
  backoffRoundAdvance(hooks);

  const memory = createAiTurnMemory();
  const controller = new TurnController(initial, hooks, { isPrimaryActor: () => true, aiMemory: memory });
  controller.tick(16);
  assert.equal(controller.getState().phase.kind, "SETTLEMENT_BATTLE", "the walk-in opened the assault");
  const resolution = await controller.resolveSettlementBattle(BATTLE_UNIT_TYPES);
  assert.equal(resolution!.outcome, "draw", "walls vs walls grind to the cap: the garrison held");

  const rebuilt = new TurnController(controller.getState(), hooks, {
    isPrimaryActor: () => true,
    aiMemory: memory,
  });
  assert.equal(
    (rebuilt as unknown as { aiMemory: AiTurnMemory }).aiMemory,
    memory,
    "the rebuilt controller holds the same memory instance",
  );

  moving = false;
  await settlePersist();
  rebuilt.tick(16);
  await settlePersist();
  rebuilt.tick(16);
  await settlePersist();
  rebuilt.tick(16);
  await settlePersist();

  assert.deepEqual(exclusionsByTick[1], new Set(["s0"]), "the REBUILT controller still excludes the settlement inside the window");
  assert.deepEqual(exclusionsByTick[2], new Set(["s0"]), "round 6 is still inside the window");
  assert.deepEqual(exclusionsByTick[3], new Set(), "round 7 = expiry: targetable again after the rebuild");
  assert.equal(endTurnSpy.mock.callCount(), 3, "every post-battle tick ended its turn cleanly");
});

test("B1: the once-per-turn recruit guard survives a controller rebuild on a shared AiTurnMemory", async () => {
  const initial = aiRecruitState(aiTown(500, [{ gx: 2, gy: 2, kind: "farmhouse", level: 1 }]));
  const hooks = buildHooks(initial);
  let recruitSubmissions = 0;
  hooks.onRecruitUnits = (() => {
    recruitSubmissions += 1;
    return Promise.resolve();
  }) as TurnControllerHooks["onRecruitUnits"];
  hooks.pickGarrisonRecruitment = () => [
    { settlementId: "s1", buildingKind: "farmhouse", gx: 2, gy: 2, unitTypeId: "peasant", count: 1 },
  ];
  let pickCalls = 0;
  hooks.pickAiMove = (() => (pickCalls++ === 0 ? { toTile: { q: 11, r: 10 }, cost: 1 } : null)) as TurnControllerHooks["pickAiMove"];
  hooks.onAiMove = (() => Promise.resolve()) as TurnControllerHooks["onAiMove"];
  hooks.getMap = stubOpenMap();
  backoffRoundAdvance(hooks);

  const memory = createAiTurnMemory();
  const controller = new TurnController(initial, hooks, { isPrimaryActor: () => true, aiMemory: memory });
  controller.tick(16);
  assert.equal(recruitSubmissions, 1, "the turn's first tick recruits");
  await settlePersist();

  const rebuilt = new TurnController(controller.getState(), hooks, {
    isPrimaryActor: () => true,
    aiMemory: memory,
  });
  rebuilt.tick(16);
  await settlePersist();
  assert.equal(recruitSubmissions, 1, "the rebuilt controller still honors the same round+seat guard");

  rebuilt.tick(16);
  await settlePersist();
  assert.equal(recruitSubmissions, 2, "a new round recruits again through the rebuilt controller");
});

test("GameStateManager threads one AiTurnMemory across setState/replaceState; resetAiTurnMemory installs a fresh one", () => {
  const manager = new GameStateManager();
  const peek = (c: TurnController) => (c as unknown as { aiMemory: AiTurnMemory }).aiMemory;

  manager.setState(makeState());
  const first = peek(manager.getTurnController());
  manager.replaceState(makeState());
  const second = peek(manager.getTurnController());
  assert.equal(second, first, "replaceState carries the same memory into the rebuilt controller");

  manager.resetAiTurnMemory();
  manager.replaceState(makeState());
  const third = peek(manager.getTurnController());
  assert.notEqual(third, first, "a game-session reset installs a fresh memory");
});

// Server-driven AI (plan 2026-09-30-server-side-ai-actor.md): the browser
// never drives an AI turn on a flagged game, so each server-side HeroMoved is
// replayed onto the live controller through applyRemoteHeroMove. It must move
// the hero and nothing else -- no phase turn, no selection churn, no state
// replacement when the hero is unknown.
test("applyRemoteHeroMove moves the hero, records previousQ/R and appends the trail", () => {
  const initial = makeState();
  const controller = new TurnController(initial, buildHooks(initial));

  const applied = controller.applyRemoteHeroMove({ heroId: "h1", to: { q: 17, r: 5 } });

  assert.equal(applied, true, "a known AI hero's move applies");
  const hero = controller.getState().heroes.h1;
  assert.equal(hero?.q, 17, "the hero stands on the event's tile");
  assert.equal(hero?.r, 5);
  assert.equal(hero?.previousQ, 18, "the old tile is kept for the visual tween");
  assert.equal(hero?.previousR, 4);
  assert.deepEqual(
    hero?.trail,
    [{ q: 18, r: 4 }, { q: 17, r: 5 }],
    "the trail gains the arrival tile (the fixture seeds it with its own tile)",
  );
  assert.deepEqual(
    controller.getState().heroes.h0,
    initial.heroes.h0,
    "an unrelated hero is untouched",
  );
});

test("applyRemoteHeroMove returns false for an unknown hero and leaves the state identity alone", () => {
  const initial = makeState();
  const controller = new TurnController(initial, buildHooks(initial));
  const before = controller.getState();

  const applied = controller.applyRemoteHeroMove({ heroId: "ghost", to: { q: 3, r: 3 } });

  assert.equal(applied, false, "a move for a hero this client does not know is rejected");
  assert.equal(controller.getState(), before, "a rejected move must not even replace the state object");
});

test("applyRemoteHeroMove leaves the phase, active seat and both selections untouched", () => {
  const base = makeState({
    activePlayerId: 0,
    phase: { kind: "PLAYER_TURN", playerId: 0 },
  });
  const initial: GameState = { ...base, selectedHeroId: "h0", selectedSettlementId: "s0" };
  const controller = new TurnController(initial, buildHooks(initial));

  assert.equal(controller.applyRemoteHeroMove({ heroId: "h1", to: { q: 17, r: 5 } }), true);

  const after = controller.getState();
  assert.deepEqual(after.phase, initial.phase, "a remote move never opens or closes a phase");
  assert.equal(after.activePlayerId, 0, "the active seat is untouched");
  assert.equal(after.selectedHeroId, "h0", "the viewer's hero selection survives");
  assert.equal(after.selectedSettlementId, "s0", "the viewer's settlement selection survives");
});

test("applyRemoteHeroMove works mid-AI_TURN (the phase the server driver is playing)", () => {
  const initial = makeState({
    activePlayerId: 1,
    phase: { kind: "AI_TURN", playerId: 1 },
  });
  const controller = new TurnController(initial, buildHooks(initial), { isPrimaryActor: () => false });

  assert.equal(controller.applyRemoteHeroMove({ heroId: "h1", to: { q: 17, r: 5 } }), true);

  const after = controller.getState();
  assert.equal(after.heroes.h1?.q, 17, "the parked AI-turn controller takes the step");
  assert.equal(after.heroes.h1?.r, 5);
  assert.equal(after.phase.kind, "AI_TURN", "the controller stays parked in the AI turn");
  assert.equal(after.phase.kind === "AI_TURN" ? after.phase.playerId : null, 1);
  assert.equal(after.activePlayerId, 1);
});
