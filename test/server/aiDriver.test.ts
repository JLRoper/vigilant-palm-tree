import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  GameMap,
  mulberry32,
  normalizePlatoons,
  pickAiMove,
  pickGarrisonRecruitment,
  resolveBattle,
  evaluateTradeNeeds,
  type MapSize,
  type PendingBattleMarker,
  type UnitType,
} from "@heroes/engine";
import { hexDistance, HEX_DIRECTIONS } from "@heroes/contracts";
import type { Axial, Command, HeroId } from "@heroes/contracts";
import {
  AI_DEFENDER_OWNER_MISSING_AUDIT_KIND,
  AI_DEFENDER_WAIT_EXPIRED_AUDIT_KIND,
  AI_DEFENDER_WAIT_TIMEOUT_MS,
  AI_MAX_ROUTES_PER_SEAT,
  AI_TURN_ACTION_BUDGET,
  AI_TURN_ADOPTED_AUDIT_KIND,
  AI_TURN_HEARTBEAT_STALE_MS,
  AI_TURN_PASS_DEADLINE_MS,
  configureAiDriver,
  defaultAdoptGame,
  defaultStampHeartbeats,
  isGameTrackedByDriver,
  resetAiDriver,
  scanOnce,
  type AiDriverBeat,
  type AiDriverCandidate,
  type AiDriveOutcome,
  type AiDriverCommandOutcome,
  type AiDriverGameSnapshot,
  type GameLockOutcome,
  type WithGameLock,
} from "../../server/app/aiDriver";
import { aiDriverBootToken } from "../../server/app/aiDriverToken";
import { pool } from "../../server/persistence/db";
import { makeHero, makePlayer, makeSettlement, makeState, emptyWarehouse } from "../charter/_helpers";

// Injectable-seam coverage for the server-side AI driver
// (server/app/aiDriver.ts), on the configureDropPolicy pattern: the clock,
// cadence, candidate scan, game hydration, catalog, command dispatch, and
// audit append are all overridden per test, so the drive state machine is
// exercised without the live pipeline. The scripted runCommand mutates the
// world the way the real handlers narrowly do (position staleness guard
// included) so multi-action passes see their own commits. One test at the
// end exercises the DEFAULT loadCandidates/loadGame SQL against real
// Postgres.

after(async () => {
  await pool.end();
});

const CATALOG: Record<string, UnitType> = {
  swordsman: { id: "swordsman", name: "Swordsman", attack: 4, defence: 4, health: 10, speed: 3, description: "", advantageType: "infantry", specialty: "", specialtyPriority: 1 },
  peasant: { id: "peasant", name: "Peasant", attack: 1, defence: 1, health: 2, speed: 2, description: "", advantageType: "infantry", specialty: "", specialtyPriority: 1 },
};

const MAP_SIZE: MapSize = "small";
const GAME = "drv-test";

function passableTiles(seed: number): Axial[] {
  const map = new GameMap(seed, MAP_SIZE);
  const out: Axial[] = [];
  for (let r = 0; r < map.height; r++) {
    for (let q = 0; q < map.width; q++) {
      if (map.isPassable(q, r) && map.resourceTileAt(q, r) === undefined) out.push({ q, r });
    }
  }
  return out;
}

function firstAdjacentPassablePair(seed: number): [Axial, Axial] | null {
  const tiles = passableTiles(seed);
  for (const a of tiles) {
    for (const b of tiles) {
      if (hexDistance(a, b) === 1) return [a, b];
    }
  }
  return null;
}

const SEED = (() => {
  for (let seed = 1; seed < 500; seed++) {
    if (firstAdjacentPassablePair(seed)) return seed;
  }
  throw new Error("no seed under 500 has an adjacent passable pair");
})();
const HERO_TILE = passableTiles(SEED)[0];
const PAIR = firstAdjacentPassablePair(SEED);
assert.ok(PAIR, "the fixture seed must contain an adjacent passable pair");

function troopStacks(unitTypeId: string, count: number) {
  return normalizePlatoons([{ entries: [{ unitTypeId, count }] }]);
}

function aiTurnWorld(
  heroes: ReturnType<typeof makeHero>[],
  opts?: {
    gameId?: number;
    round?: number;
    seed?: number;
    settlements?: ReturnType<typeof makeSettlement>[];
  },
): AiDriverGameSnapshot {
  const state = makeState({
    players: [
      makePlayer(0, "player", [], (opts?.settlements ?? []).filter((s) => s.ownerId === 0).map((s) => s.id)),
      makePlayer(1, "ai", heroes.map((h) => h.id as HeroId), (opts?.settlements ?? []).filter((s) => s.ownerId === 1).map((s) => s.id)),
    ],
    heroes: [...heroes, makeHero("h0", 0, 22, 16, { movementRemaining: 0 })],
    settlements: opts?.settlements ?? [],
    activePlayerId: 1,
    phase: { kind: "AI_TURN", playerId: 1 },
    round: opts?.round ?? 1,
  });
  // The snapshot seed MUST be the seed the fixture geometry (hero/settlement
  // tiles) was chosen from -- the driver reconstructs GameMap from it.
  return {
    gameId: opts?.gameId ?? 1,
    seed: opts?.seed ?? SEED,
    mapSize: MAP_SIZE,
    pendingBattle: null,
    state,
  };
}

interface ScriptedHarness {
  commands: Command[];
  endTurns: Command[];
  audits: Array<{ gameName: string; kind: string; payload: unknown }>;
  stamps: AiDriverCandidate[];
  adoptions: Array<{ candidate: AiDriverCandidate; previousToken: string }>;
  gameGone: { value: boolean };
}

// Scripted dispatch mirroring the real handlers' narrow behavior: the
// MoveHero staleness guard, position application, walk-in capture owner
// flip, settlement-battle outcome application, and a per-kind outcome
// override map for rejection scenarios.
function installHarness(
  world: AiDriverGameSnapshot,
  opts?: {
    candidates?: AiDriverCandidate[];
    actionBudget?: number;
    passDeadlineMs?: number;
    defenderWaitTimeoutMs?: number;
    now?: () => number;
    watchdogStaleMs?: number;
    driverToken?: string;
    scanIntervalMs?: number;
    stampHeartbeats?: (candidates: AiDriverCandidate[]) => Promise<void>;
    adoptGame?: (candidate: AiDriverCandidate, previousToken: string) => Promise<boolean>;
    override?: (command: Command) => AiDriverCommandOutcome | undefined;
  },
): ScriptedHarness {
  const candidates = opts?.candidates ?? [{ name: GAME, id: world.gameId, active_player_id: 1 }];
  const harness: ScriptedHarness = {
    commands: [],
    endTurns: [],
    audits: [],
    stamps: [],
    adoptions: [],
    gameGone: { value: false },
  };
  const clock = opts?.now ?? (() => 1_000_000);
  const options: Parameters<typeof configureAiDriver>[0] = {
    scanIntervalMs: opts?.scanIntervalMs ?? 5_000,
    pacingMs: 0,
    actionBudget: opts?.actionBudget ?? AI_TURN_ACTION_BUDGET,
    passDeadlineMs: opts?.passDeadlineMs ?? AI_TURN_PASS_DEADLINE_MS,
    defenderWaitTimeoutMs: opts?.defenderWaitTimeoutMs ?? AI_DEFENDER_WAIT_TIMEOUT_MS,
    watchdogStaleMs: opts?.watchdogStaleMs ?? AI_TURN_HEARTBEAT_STALE_MS,
    now: clock,
    loadCandidates: async () => candidates,
    loadGame: async () => (harness.gameGone.value ? null : world),
    loadCatalog: async () => CATALOG,
    runCommand: async (command): Promise<AiDriverCommandOutcome> => {
      const overridden = opts?.override?.(command);
      harness.commands.push(command);
      if (overridden) return overridden;
      if (command.kind === "MoveHero") {
        const hero = world.state.heroes[command.heroId];
        if (!hero || hero.q !== command.fromTile.q || hero.r !== command.fromTile.r) {
          return { ok: false, reason: "hero_not_at_fromTile" };
        }
        hero.q = command.toTile.q;
        hero.r = command.toTile.r;
        hero.movementRemaining -= command.cost;
        return { ok: true };
      }
      if (command.kind === "EndTurn") {
        harness.endTurns.push(command);
        return { ok: true };
      }
      if (command.kind === "CaptureSettlement") {
        const hero = world.state.heroes[command.heroId];
        const settlement = world.state.settlements[command.settlementId];
        if (!hero || !settlement || hero.q !== settlement.q || hero.r !== settlement.r) {
          return { ok: false, reason: "hero_not_at_settlement" };
        }
        settlement.ownerId = hero.ownerId;
        return { ok: true };
      }
      if (command.kind === "SubmitSettlementBattleResult") {
        const settlement = world.state.settlements[command.settlementId];
        if (!settlement) return { ok: false, reason: "no_settlement" };
        if (command.outcome === "attackerWon") {
          settlement.stacks = normalizePlatoons([]);
          settlement.ownerId = world.state.heroes[command.attackerId]?.ownerId ?? null;
        } else {
          settlement.stacks = normalizePlatoons(command.defenderStacks);
        }
        return { ok: true };
      }
      if (command.kind === "EnterBattle") {
        // The handler persists games.lobby.pendingBattle (attacker, defender,
        // since) and appends BattleOffered; the driver only consumes the
        // marker, so the scripted branch mirrors the persisted shape, stamped
        // with the harness clock.
        world.pendingBattle = {
          attackerId: command.attackerId,
          defenderId: command.defenderId,
          since: clock(),
        } satisfies PendingBattleMarker;
        return { ok: true };
      }
      if (command.kind === "ResolveBattle") {
        const attacker = world.state.heroes[command.attackerId];
        if (!attacker) return { ok: false, reason: "hero_not_found" };
        delete world.state.heroes[command.defenderId];
        world.state.players = world.state.players.map((p) =>
          p.id !== attacker.ownerId ? { ...p, heroIds: p.heroIds.filter((id) => id !== command.defenderId) } : p,
        );
        // Resolving the offered pair clears the pending marker and hands the
        // turn back to the AI seat (the handler's behavior on success).
        world.pendingBattle = null;
        world.state.phase = { kind: "AI_TURN", playerId: world.state.activePlayerId };
        return { ok: true };
      }
      return { ok: true };
    },
    appendAudit: async (gameName, kind, payload) => {
      harness.audits.push({ gameName, kind, payload });
    },
    stampHeartbeats: opts?.stampHeartbeats ?? (async (stamped) => {
      harness.stamps.push(...stamped);
    }),
    adoptGame: opts?.adoptGame ?? (async () => false),
  };
  if (opts?.driverToken !== undefined) options.driverToken = opts.driverToken;
  configureAiDriver(options);
  return harness;
}

// Captures driveGameTurn's outcome through the withGameLock seam -- the only
// place scanOnce exposes the per-game AiDriveOutcome to a test.
function captureOutcome(): { captured: AiDriveOutcome[]; withGameLock: WithGameLock } {
  const captured: AiDriveOutcome[] = [];
  const withGameLock: WithGameLock = async (_gameName, _gameId, drive) => {
    const value = await drive();
    if (typeof value === "string") captured.push(value as AiDriveOutcome);
    return { locked: true, value } satisfies GameLockOutcome<AiDriveOutcome>;
  };
  return { captured, withGameLock };
}

beforeEach(() => {
  resetAiDriver();
});

function commandsOfKind<K extends Command["kind"]>(commands: Command[], kind: K): Extract<Command, { kind: K }>[] {
  return commands.filter((c): c is Extract<Command, { kind: K }> => c.kind === kind);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

test("constants match the plan values (D3/D12)", () => {
  assert.equal(AI_TURN_ACTION_BUDGET, 64);
  assert.equal(AI_TURN_PASS_DEADLINE_MS, 25_000);
  assert.equal(AI_DEFENDER_WAIT_TIMEOUT_MS, 300_000);
  assert.equal(AI_TURN_HEARTBEAT_STALE_MS, 60_000);
  assert.equal(AI_TURN_ADOPTED_AUDIT_KIND, "ai_turn_adopted");
});

test("whole-turn drive per pass: two heroes spend their movement across sweeps, then EndTurn with no growthRate", async () => {
  const world = aiTurnWorld([
    makeHero("h1", 1, HERO_TILE.q, HERO_TILE.r, { movementRemaining: 2, troops: 5, stacks: troopStacks("swordsman", 5) }),
    makeHero("h2", 1, passableTiles(SEED)[20].q, passableTiles(SEED)[20].r, { movementRemaining: 2, troops: 5, stacks: troopStacks("swordsman", 5) }),
  ]);
  const harness = installHarness(world);

  await scanOnce();

  const moves = commandsOfKind(harness.commands, "MoveHero");
  assert.ok(moves.length >= 2, `both heroes must move (got ${moves.length} moves)`);
  const movers = new Set(moves.map((m) => m.heroId));
  assert.ok(movers.has("h1"), "hero h1 moved");
  assert.ok(movers.has("h2"), "hero h2 moved");
  // Terrain step costs vary, so "spent" = not enough left for even the
  // cheapest (cost-1) step -- exactly the condition pickAiMove stops on.
  assert.ok(world.state.heroes["h1"].movementRemaining < 1, "h1 spent its movement");
  assert.ok(world.state.heroes["h2"].movementRemaining < 1, "h2 spent its movement");
  assert.equal(harness.endTurns.length, 1, "exactly one EndTurn closes the turn");
  assert.equal("growthRate" in harness.endTurns[0], false, "D14: the driver's EndTurn omits growthRate");
  assert.equal(harness.audits.length, 0, "a clean turn appends no audit row");
});

test("a hero with no movement (or no plan) ends the turn in the same pass", async () => {
  const world = aiTurnWorld([makeHero("h1", 1, HERO_TILE.q, HERO_TILE.r, { movementRemaining: 0 })]);
  const harness = installHarness(world);

  await scanOnce();

  assert.equal(commandsOfKind(harness.commands, "MoveHero").length, 0);
  assert.equal(harness.endTurns.length, 1, "no hero moved in a full sweep -> EndTurn");
  assert.equal("growthRate" in harness.endTurns[0], false);
});

test("re-entrancy: a second scan while a game is driving is a no-op for that game", async () => {
  const world = aiTurnWorld([
    makeHero("h1", 1, HERO_TILE.q, HERO_TILE.r, { movementRemaining: 1, troops: 5, stacks: troopStacks("swordsman", 5) }),
  ]);
  const log: Command[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let released = false;
  configureAiDriver({
    scanIntervalMs: 60_000,
    pacingMs: 0,
    now: () => 1_000_000,
    loadCandidates: async () => [{ name: GAME, id: 1, active_player_id: 1 }],
    loadGame: async () => world,
    loadCatalog: async () => CATALOG,
    runCommand: async (command) => {
      log.push(command);
      if (!released) await gate;
      if (command.kind === "MoveHero") {
        const hero = world.state.heroes[command.heroId];
        hero.q = command.toTile.q;
        hero.r = command.toTile.r;
        hero.movementRemaining -= command.cost;
      }
      return { ok: true };
    },
    appendAudit: async () => {},
    stampHeartbeats: async () => {},
  });

  const first = scanOnce();
  for (let i = 0; i < 500 && log.length === 0; i++) await sleep(1);
  assert.equal(log.length, 1, "the first drive is parked inside its first command");

  await scanOnce();
  assert.equal(log.length, 1, "the second scan added no commands while the drive holds the game");

  released = true;
  release();
  await first;
  assert.equal(log.length, 2, "MoveHero then EndTurn completed after release");
  assert.equal(log[1].kind, "EndTurn");
});

test("capture chained after the move that lands on an empty enemy settlement", async () => {
  const [heroTile, settlementTile] = firstAdjacentPassablePair(SEED + 1) ?? [HERO_TILE, PAIR[1]];
  const settlement = makeSettlement("s-enc", 0, settlementTile.q, settlementTile.r);
  const world = aiTurnWorld(
    [makeHero("h1", 1, heroTile.q, heroTile.r, { movementRemaining: 4, troops: 5, stacks: troopStacks("swordsman", 5) })],
    { settlements: [settlement], seed: SEED + 1 },
  );
  const harness = installHarness(world);

  await scanOnce();

  const sequence = harness.commands.map((c) => c.kind);
  assert.ok(sequence.includes("MoveHero"), "the approach move fired");
  assert.ok(sequence.includes("CaptureSettlement"), "the walk-in capture fired");
  assert.ok(
    sequence.indexOf("CaptureSettlement") > sequence.indexOf("MoveHero"),
    "the capture chains behind its triggering move",
  );
  assert.equal(settlement.ownerId, 1, "the capture flipped the owner to the AI seat");
  assert.equal(harness.endTurns.length, 1);
});

test("settlement battle: compute-once pin -- the driver submits the engine resolver's survivors and never re-fires", async () => {
  const [heroTile, settlementTile] = firstAdjacentPassablePair(SEED + 2) ?? [HERO_TILE, PAIR[1]];
  const settlement = makeSettlement("s-gar", 0, settlementTile.q, settlementTile.r);
  settlement.stacks = troopStacks("peasant", 2);
  const hero = makeHero("h1", 1, heroTile.q, heroTile.r, {
    movementRemaining: 4,
    troops: 10,
    stacks: troopStacks("swordsman", 10),
  });
  const world = aiTurnWorld([hero], { settlements: [settlement], seed: SEED + 2 });
  const harness = installHarness(world);

  await scanOnce();

  const submits = commandsOfKind(harness.commands, "SubmitSettlementBattleResult");
  assert.equal(submits.length, 1, "exactly one settlement battle submit");
  const submit = submits[0];
  assert.equal(submit.outcome, "attackerWon");
  // Compute-once pin: replay the pure resolver with the SAME inputs and the
  // obstacleSeed the driver recorded on the command -- the submitted stacks
  // must be that battle's survivors.
  const replay = resolveBattle(troopStacks("swordsman", 10), troopStacks("peasant", 2), {
    obstacleSeed: submit.obstacleSeed,
    unitTypes: CATALOG,
  });
  assert.deepEqual(submit.attackerStacks, replay.attackerPlatoons);
  assert.deepEqual(submit.defenderStacks, replay.defenderPlatoons);
  assert.equal(submit.rounds, replay.rounds);
  assert.ok(Number.isInteger(submit.obstacleSeed) && submit.obstacleSeed >= 0, "obstacleSeed is a non-negative int");

  await scanOnce();
  assert.equal(
    commandsOfKind(harness.commands, "SubmitSettlementBattleResult").length,
    1,
    "a second scan never re-fires the battle (no local apply, no storm)",
  );
});

test("D15 immediate-submit chaining: after an ok hero battle on a garrisoned tile the garrison battle is submitted in the same pass", async () => {
  const [heroTile, settlementTile] = firstAdjacentPassablePair(SEED + 3) ?? [HERO_TILE, PAIR[1]];
  const settlement = makeSettlement("s-chain", 0, settlementTile.q, settlementTile.r);
  settlement.stacks = troopStacks("peasant", 1);
  const world = aiTurnWorld(
    [makeHero("h1", 1, heroTile.q, heroTile.r, { movementRemaining: 4, troops: 9, stacks: troopStacks("swordsman", 9) })],
    { settlements: [settlement], seed: SEED + 3 },
  );
  // Geometry: the settlement tile is occupied by a defending enemy hero, so
  // the move ends beside it and the post-move adjacency battle fires; the
  // scripted ResolveBattle removes the defender and lands the attacker ON
  // the (still-garrisoned) settlement tile -- exactly the D15 shape. The
  // defender is AI-seat 2: a HUMAN-defender owner would now be offered an
  // EnterBattle and stop the pass (the pending-defender flow), which would
  // never reach the chaining under test.
  const defender = makeHero("h0d", 2, settlementTile.q, settlementTile.r, { troops: 1, stacks: troopStacks("peasant", 1) });
  world.state.heroes["h0d"] = defender;
  world.state.players = [...world.state.players, makePlayer(2, "ai", ["h0d"], [])];
  const harness = installHarness(world, {
    override: (command) => {
      if (command.kind === "ResolveBattle") {
        delete world.state.heroes["h0d"];
        const attacker = world.state.heroes[command.attackerId];
        attacker.q = settlementTile.q;
        attacker.r = settlementTile.r;
        world.state.players = world.state.players.map((p) =>
          p.id === 2 ? { ...p, heroIds: p.heroIds.filter((id) => id !== "h0d") } : p,
        );
        return { ok: true };
      }
      return undefined;
    },
  });

  await scanOnce();

  const sequence = harness.commands.map((c) => c.kind);
  const resolveIdx = sequence.indexOf("ResolveBattle");
  const submitIdx = sequence.indexOf("SubmitSettlementBattleResult");
  assert.ok(resolveIdx >= 0, "the adjacent-hero battle was dispatched (never pre-computed)");
  assert.ok(submitIdx > resolveIdx, "the garrison battle was submitted after the hero battle");
  assert.equal(submitIdx - resolveIdx, 1, "D15: submitted IMMEDIATELY, no intervening scan");
});

test("D9 backoff: a bounced assault is recorded, excludes the settlement, and expires by round", async () => {
  const [heroTile, settlementTile] = firstAdjacentPassablePair(SEED + 4) ?? [HERO_TILE, PAIR[1]];
  const settlement = makeSettlement("s-bnc", 0, settlementTile.q, settlementTile.r);
  settlement.stacks = troopStacks("peasant", 2);
  const world = aiTurnWorld(
    [makeHero("h1", 1, heroTile.q, heroTile.r, { movementRemaining: 4, troops: 9, stacks: troopStacks("swordsman", 9) })],
    { settlements: [settlement], round: 1, seed: SEED + 4 },
  );
  const harness = installHarness(world, {
    override: (command) =>
      command.kind === "SubmitSettlementBattleResult" ? { ok: false, reason: "hero_not_at_settlement" } : undefined,
  });

  await scanOnce();
  const sequence = harness.commands.map((c) => c.kind);
  const submitIdx = sequence.indexOf("SubmitSettlementBattleResult");
  assert.ok(submitIdx >= 0, "one assault attempt in round 1");
  const movesBeforeSubmit = sequence.slice(0, submitIdx).filter((k) => k === "MoveHero").length;
  const movesAfterBounce = commandsOfKind(harness.commands, "MoveHero").slice(movesBeforeSubmit);
  assert.ok(
    !movesAfterBounce.some((m) => m.toTile.q === settlementTile.q && m.toTile.r === settlementTile.r),
    "after the bounce the excluded settlement is never re-entered in the same pass",
  );

  world.state.round = 2;
  world.state.heroes["h1"].movementRemaining = 4;
  world.state.heroes["h1"].q = heroTile.q;
  world.state.heroes["h1"].r = heroTile.r;
  world.state.heroes["h1"].trail = [heroTile];
  await scanOnce();
  assert.equal(
    commandsOfKind(harness.commands, "SubmitSettlementBattleResult").length,
    1,
    "round 2 is still inside the backoff window: no re-attack",
  );

  world.state.round = 3;
  world.state.heroes["h1"].movementRemaining = 4;
  world.state.heroes["h1"].q = heroTile.q;
  world.state.heroes["h1"].r = heroTile.r;
  world.state.heroes["h1"].trail = [heroTile];
  await scanOnce();
  assert.equal(
    commandsOfKind(harness.commands, "SubmitSettlementBattleResult").length,
    2,
    "round 3 (recorded 1 + GARRISON_BACKOFF_ROUNDS 2): the exclusion expired and the assault re-fires",
  );
  assert.ok(isGameTrackedByDriver(GAME), "memory persists for the living game");
});

function recruitWorld(gameId?: number): AiDriverGameSnapshot {
  const settlement = makeSettlement("s-own", 1, 20, 14, {
    gold: 5000,
    warehouse: emptyWarehouse({ wood: 500, stone: 500 }),
    buildings: [{ gx: 2, gy: 2, kind: "barracks", level: 1, style: "classic" }],
  });
  const world = aiTurnWorld(
    [makeHero("h1", 1, HERO_TILE.q, HERO_TILE.r, { movementRemaining: 0 })],
    { settlements: [settlement], gameId },
  );
  world.state.heroes["h0"] = makeHero("h0", 0, 22, 16, { troops: 3, stacks: troopStacks("swordsman", 3) });
  const expected = pickGarrisonRecruitment(world.state, 1, CATALOG);
  assert.ok(expected.length > 0, "the recruit fixture must produce at least one item");
  return world;
}

test("D13 recruitment runs once per round+seat", async () => {
  const world = recruitWorld();
  const expected = pickGarrisonRecruitment(world.state, 1, CATALOG);
  const harness = installHarness(world);

  await scanOnce();
  assert.equal(commandsOfKind(harness.commands, "RecruitUnits").length, expected.length, "one dispatch per planned item");
  assert.equal(harness.endTurns.length, 1, "the turn still completes");

  await scanOnce();
  assert.equal(
    commandsOfKind(harness.commands, "RecruitUnits").length,
    expected.length,
    "the guard blocks a second recruitment in the same round+seat",
  );
});

test("D13 per-item rejection is tolerated and the turn still ends", async () => {
  const world = recruitWorld();
  const expected = pickGarrisonRecruitment(world.state, 1, CATALOG);
  const harness = installHarness(world, {
    override: (command) => (command.kind === "RecruitUnits" ? { ok: false, reason: "garrison_full" } : undefined),
  });

  await scanOnce();
  assert.equal(commandsOfKind(harness.commands, "RecruitUnits").length, expected.length, "every item was still dispatched");
  assert.equal(harness.endTurns.length, 1, "the turn still completes after rejected recruits");
  assert.equal(harness.audits.length, 0, "a tolerated recruit rejection is not a turn-skipping audit");
});

test("game-recreate invalidation: same name with a new numeric id resets the recruit guard", async () => {
  const world = recruitWorld(1);
  const expected = pickGarrisonRecruitment(world.state, 1, CATALOG);
  const harness = installHarness(world);

  await scanOnce();
  assert.equal(commandsOfKind(harness.commands, "RecruitUnits").length, expected.length);

  world.gameId = 2; // POST /games ON CONFLICT(name) resurrection with a new id
  await scanOnce();
  assert.equal(
    commandsOfKind(harness.commands, "RecruitUnits").length,
    expected.length * 2,
    "the id mismatch reset the per-game memory, so the guard re-arms in the same round",
  );

  await scanOnce();
  assert.equal(commandsOfKind(harness.commands, "RecruitUnits").length, expected.length * 2, "the new memory's guard holds again");
});

// ── Phase 5: trade-route auto-accept ───────────────────────────────────────

function tradeWorld(): AiDriverGameSnapshot {
  // s-rich is the food surplus source AND can afford wagons; s-low is below
  // 25% of its weekly food requirement. One recommendation total.
  const rich = makeSettlement("s-rich", 1, 20, 14, {
    gold: 1000,
    warehouse: emptyWarehouse({ wood: 100, food: 500 }),
  });
  const low = makeSettlement("s-low", 1, 24, 14, { population: 400, warehouse: emptyWarehouse() });
  return aiTurnWorld(
    [makeHero("h1", 1, HERO_TILE.q, HERO_TILE.r, { movementRemaining: 0 })],
    { settlements: [rich, low] },
  );
}

function tradeOverride(world: AiDriverGameSnapshot) {
  return (command: Command): AiDriverCommandOutcome | undefined => {
    if (command.kind === "BuyWagons") {
      const settlement = world.state.settlements[command.settlementId];
      if (!settlement || settlement.gold < 200 * command.count) return { ok: false, reason: "not_enough_gold" };
      settlement.gold -= 200 * command.count;
      world.state.players = world.state.players.map((p) =>
        p.id === command.actor
          ? { ...p, wagonsOwned: (p.wagonsOwned ?? 0) + command.count, wagonsUnassigned: (p.wagonsUnassigned ?? 0) + command.count }
          : p,
      );
      return { ok: true };
    }
    if (command.kind === "CreateTradeRoute") {
      const player = world.state.players.find((p) => p.id === command.actor);
      if ((player?.wagonsUnassigned ?? 0) < command.wagons) return { ok: false, reason: "not_enough_wagons_unassigned" };
      world.state.tradeRoutes = [
        ...(world.state.tradeRoutes ?? []),
        {
          id: `route${world.state.tradeRoutes?.length ?? 0}`,
          from: command.from,
          to: command.to,
          payload: command.payload,
          wagons: command.wagons,
          caravan: null,
        },
      ];
      world.state.players = world.state.players.map((p) =>
        p.id === command.actor ? { ...p, wagonsUnassigned: (p.wagonsUnassigned ?? 0) - command.wagons } : p,
      );
      return { ok: true };
    }
    return undefined;
  };
}

test("constants: AI_MAX_ROUTES_PER_SEAT matches the plan", () => {
  assert.equal(AI_MAX_ROUTES_PER_SEAT, 3);
});

test("Phase 5 auto-accept: BuyWagons (empty pool) then CreateTradeRoute with the suggested wagons, once per round+seat", async () => {
  const world = tradeWorld();
  const expected = evaluateTradeNeeds(world.state, 1, CATALOG);
  assert.equal(expected.length, 1, "the fixture produces exactly one recommendation");
  assert.equal(expected[0].wagons, 1, "need 4 food -> 1 wagon suggested");
  const harness = installHarness(world, { override: tradeOverride(world) });

  await scanOnce();

  const buys = commandsOfKind(harness.commands, "BuyWagons");
  const creates = commandsOfKind(harness.commands, "CreateTradeRoute");
  assert.equal(buys.length, 1, "the empty pool triggered exactly one wagon buy");
  assert.equal(buys[0].settlementId, "s-rich", "wagons are bought at the ORIGIN settlement");
  assert.equal(buys[0].count, 1);
  assert.equal(creates.length, 1, "one route created from the accepted recommendation");
  assert.equal(creates[0].from.id, "s-rich");
  assert.equal(creates[0].to.id, "s-low");
  assert.deepEqual(creates[0].payload, { kind: "resource", resource: "food" });
  assert.equal(creates[0].wagons, expected[0].wagons);
  assert.ok(
    harness.commands.indexOf(buys[0]) < harness.commands.indexOf(creates[0]),
    "the wagon buy is ensured BEFORE the create",
  );
  assert.equal(harness.endTurns.length, 1, "the turn still completes");
  assert.equal(world.state.tradeRoutes?.length, 1, "the scripted handler applied the route");

  await scanOnce();
  assert.equal(commandsOfKind(harness.commands, "CreateTradeRoute").length, 1, "the round+seat guard blocks a second accept");
});

test("Phase 5 auto-accept: a rejected CreateTradeRoute is tolerated and the turn still ends", async () => {
  const world = tradeWorld();
  const harness = installHarness(world, {
    override: (command) => (command.kind === "CreateTradeRoute" ? { ok: false, reason: "not_enough_wagons_unassigned" } : tradeOverride(world)(command)),
  });

  await scanOnce();

  assert.equal(commandsOfKind(harness.commands, "CreateTradeRoute").length, 1, "the create was still dispatched");
  assert.equal(harness.endTurns.length, 1, "the turn still completes after the rejection");
  assert.equal(harness.audits.length, 0, "a tolerated route rejection is not a turn-skipping audit");
});

test("Phase 5 auto-accept: every command is budget-counted (a tiny budget stops the accept, the turn still ends)", async () => {
  const world = tradeWorld();
  const harness = installHarness(world, { actionBudget: 1, override: tradeOverride(world) });

  await scanOnce();

  assert.equal(commandsOfKind(harness.commands, "BuyWagons").length, 1, "the buy consumed the one budgeted action");
  assert.equal(commandsOfKind(harness.commands, "CreateTradeRoute").length, 0, "the create never fit the budget");
  assert.equal(harness.endTurns.length, 1, "the exhaustion path still best-effort EndTurns");
  assert.equal(harness.audits.length, 1);
  assert.equal(harness.audits[0].kind, "turn_skipped");
});

test("per-game isolation: one throwing game never skips the others", async () => {
  const good = aiTurnWorld([makeHero("h1", 1, HERO_TILE.q, HERO_TILE.r, { movementRemaining: 0 })]);
  configureAiDriver({
    scanIntervalMs: 60_000,
    pacingMs: 0,
    now: () => 1_000_000,
    loadCandidates: async () => [
      { name: "drv-bad", id: 1, active_player_id: 1 },
      { name: "drv-good", id: 1, active_player_id: 1 },
    ],
    loadGame: async (name) => {
      if (name === "drv-bad") throw new Error("poisoned hydration");
      return name === "drv-good" ? good : null;
    },
    loadCatalog: async () => CATALOG,
    runCommand: async () => ({ ok: true }),
    appendAudit: async () => {},
  });

  await scanOnce();

  assert.equal(isGameTrackedByDriver("drv-bad"), false, "the poisoned game drove nothing and left no memory");
  assert.equal(isGameTrackedByDriver("drv-good"), true, "the healthy game was still driven");
});

test("game_gone evicts all per-game driver memory", async () => {
  const world = aiTurnWorld([makeHero("h1", 1, HERO_TILE.q, HERO_TILE.r, { movementRemaining: 0 })]);
  const harness = installHarness(world);

  await scanOnce();
  assert.ok(isGameTrackedByDriver(GAME), "memory exists after driving");

  harness.gameGone.value = true;
  await scanOnce();
  assert.equal(isGameTrackedByDriver(GAME), false, "a gone game's memory is evicted");
});

test("D12 budget exhaustion best-effort EndTurns and appends one turn_skipped-convention audit row", async () => {
  const world = aiTurnWorld([
    makeHero("h1", 1, HERO_TILE.q, HERO_TILE.r, { movementRemaining: 99, troops: 5, stacks: troopStacks("swordsman", 5) }),
  ]);
  const harness = installHarness(world, { actionBudget: 2 });

  await scanOnce();

  assert.ok(commandsOfKind(harness.commands, "MoveHero").length >= 1, "real work happened before the cap");
  assert.equal(harness.endTurns.length, 1, "the exhaustion path still best-effort EndTurns");
  assert.equal(harness.audits.length, 1, "exactly one audit row");
  assert.equal(harness.audits[0].kind, "turn_skipped");
  const payload = harness.audits[0].payload as { playerId: number; reason: string; actions: number };
  assert.equal(payload.playerId, 1);
  assert.equal(payload.reason, "ai_turn_budget_exhausted");
  assert.equal(payload.actions, 2, "the audit carries the spent action count");
});

test("D12 pass deadline exhaustion appends the deadline audit reason", async () => {
  const world = aiTurnWorld([
    makeHero("h1", 1, HERO_TILE.q, HERO_TILE.r, { movementRemaining: 99, troops: 5, stacks: troopStacks("swordsman", 5) }),
  ]);
  const harness: ScriptedHarness = { commands: [], endTurns: [], audits: [], gameGone: { value: false } };
  let commandCount = 0;
  configureAiDriver({
    scanIntervalMs: 60_000,
    pacingMs: 0,
    passDeadlineMs: 5_000,
    now: () => 1_000_000 + commandCount * 6_000,
    loadCandidates: async () => [{ name: GAME, id: 1, active_player_id: 1 }],
    loadGame: async () => world,
    loadCatalog: async () => CATALOG,
    runCommand: async (command) => {
      commandCount += 1;
      harness.commands.push(command);
      if (command.kind === "MoveHero") {
        const hero = world.state.heroes[command.heroId];
        hero.q = command.toTile.q;
        hero.r = command.toTile.r;
        hero.movementRemaining -= command.cost;
        return { ok: true };
      }
      if (command.kind === "EndTurn") harness.endTurns.push(command);
      return { ok: true };
    },
    appendAudit: async (gameName, kind, payload) => {
      harness.audits.push({ gameName, kind, payload });
    },
  });

  await scanOnce();

  assert.ok(harness.commands.length >= 2);
  assert.equal(harness.endTurns.length, 1, "the deadline path still best-effort EndTurns");
  assert.equal(harness.audits.length, 1);
  const payload = harness.audits[0].payload as { reason: string };
  assert.equal(payload.reason, "ai_turn_deadline_exceeded");
});

// The D4 fixture: an INTERIOR tile (all 6 neighbors passable) turned into a
// no-target world by blanketing every resource within reach 8 with an OWN
// settlement -- own settlements are skipped as targets outright, and any
// resource within 2 of an owned settlement is skipped as a resource target
// -- so every pickAiMove call reaches pickWanderStep and consumes EXACTLY 40
// rng draws (20 tries x 2 draws, unconditional in the engine source). With
// every move rejected the state stays identical across scans, so scan k must
// plan with the stream at draw offset 40*(k-1) -- an exact, non-vacuous
// continuation pin (a per-scan reset would replay scan 1's plan forever).
function d4World(seed: number): AiDriverGameSnapshot | null {
  const map = new GameMap(seed, MAP_SIZE);
  let tile: Axial | null = null;
  outer: for (let r = 2; r < map.height - 2; r++) {
    for (let q = 2; q < map.width - 2; q++) {
      if (!map.isPassable(q, r)) continue;
      if (!HEX_DIRECTIONS.every((d) => map.isPassable(q + d.q, r + d.r))) continue;
      tile = { q, r };
      break outer;
    }
  }
  if (!tile) return null;
  const settlements: ReturnType<typeof makeSettlement>[] = [];
  for (let r = 0; r < map.height; r++) {
    for (let q = 0; q < map.width; q++) {
      if (map.resourceTileAt(q, r) && hexDistance(tile, { q, r }) <= 8) {
        settlements.push(makeSettlement(`s-blanket-${q}-${r}`, 1, q, r));
      }
    }
  }
  const state = makeState({
    players: [
      makePlayer(0, "player", [], []),
      makePlayer(1, "ai", ["h1"], settlements.map((s) => s.id)),
    ],
    heroes: [
      makeHero("h1", 1, tile.q, tile.r, { movementRemaining: 3, troops: 5, stacks: troopStacks("swordsman", 5) }),
      makeHero("h0", 0, 22, 16, { movementRemaining: 0 }),
    ],
    settlements,
    activePlayerId: 1,
    phase: { kind: "AI_TURN", playerId: 1 },
  });
  return { gameId: 1, seed, mapSize: MAP_SIZE, state };
}

const D4_WANDER_DRAWS_PER_CALL = 40;
const D4 = (() => {
  for (let seed = 1; seed < 500; seed++) {
    const world = d4World(seed);
    if (!world) continue;
    const map = new GameMap(seed, MAP_SIZE);
    const planAt = (offset: number): Axial | undefined => {
      const stream = mulberry32((seed ^ 1 ^ 1) >>> 0);
      for (let i = 0; i < offset; i++) stream();
      return pickAiMove(world.state, "h1", map, stream, CATALOG, new Set<string>())?.toTile;
    };
    const first = planAt(0);
    const second = planAt(D4_WANDER_DRAWS_PER_CALL);
    if (!first || !second) continue;
    if (first.q === second.q && first.r === second.r) continue;
    return { seed, world, planAt };
  }
  throw new Error("no seed under 500 separates a fresh wander plan from its continuation");
})();

test("D4 stream continuation: identical state with a progressed stream re-plans a different wander step", async () => {
  const world = D4.world;
  const moves: Axial[] = [];
  configureAiDriver({
    scanIntervalMs: 60_000,
    pacingMs: 0,
    now: () => 1_000_000,
    loadCandidates: async () => [{ name: GAME, id: 1, active_player_id: 1 }],
    loadGame: async () => world,
    loadCatalog: async () => CATALOG,
    runCommand: async (command) => {
      if (command.kind === "MoveHero") {
        moves.push(command.toTile);
        // Always reject: the state never changes, so every scan re-plans
        // the identical world and only the stream position can differ.
        return { ok: false, reason: "occupied" };
      }
      return { ok: true };
    },
    appendAudit: async () => {},
  });

  await scanOnce();
  await scanOnce();
  await scanOnce();

  assert.deepEqual(moves, [D4.planAt(0), D4.planAt(D4_WANDER_DRAWS_PER_CALL), D4.planAt(D4_WANDER_DRAWS_PER_CALL * 2)],
    "scan k planned with the stream continued to draw offset 40*(k-1) -- a per-scan reset would replay scan 1's plan",
  );
  assert.notDeepEqual(moves[0], moves[1], "the retried wander step differs (continued stream -> no livelock)");
});

test("boot-token scoping: matching-token and tokenless candidates are driven, foreign tokens are skipped", async () => {
  const world = aiTurnWorld([makeHero("h1", 1, HERO_TILE.q, HERO_TILE.r, { movementRemaining: 0 })]);
  const endTurns: Command[] = [];
  configureAiDriver({
    scanIntervalMs: 60_000,
    pacingMs: 0,
    now: () => 1_000_000,
    driverToken: "tok-mine",
    withGameLock: async (_gameName, _gameId, drive) => ({ locked: true, value: await drive() }),
    loadCandidates: async () => [
      { name: "drv-mine", id: 1, active_player_id: 1, aiDriverToken: "tok-mine" },
      { name: "drv-foreign", id: 2, active_player_id: 1, aiDriverToken: "tok-other" },
      { name: "drv-legacy", id: 3, active_player_id: 1, aiDriverToken: null },
      { name: "drv-empty", id: 4, active_player_id: 1, aiDriverToken: "" },
    ],
    loadGame: async () => world,
    loadCatalog: async () => CATALOG,
    runCommand: async (command) => {
      if (command.kind === "EndTurn") endTurns.push(command);
      return { ok: true };
    },
    appendAudit: async () => {},
  });

  await scanOnce();

  const ended = endTurns.map((c) => c.gameName);
  assert.ok(ended.includes("drv-mine"), "the matching-token game was driven");
  assert.ok(ended.includes("drv-legacy"), "a tokenless legacy flagged game was adopted");
  assert.ok(ended.includes("drv-empty"), "an empty token reads as tokenless (adoption path)");
  assert.ok(!ended.includes("drv-foreign"), "a foreign-token game is never driven by this process");
  assert.equal(isGameTrackedByDriver("drv-foreign"), false, "the skipped game left no driver memory");
});

test("advisory lock: a game whose lock is held by another server is skipped, then driven once it frees", async () => {
  const world = aiTurnWorld([makeHero("h1", 1, HERO_TILE.q, HERO_TILE.r, { movementRemaining: 0 })]);
  const endTurns: Command[] = [];
  const LOCK_KEY = 987_654_321_000; // bigint key far above any real serial game id
  const holder = await pool.connect();
  try {
    const locked = await holder.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_lock($1::bigint) AS locked`,
      [LOCK_KEY],
    );
    assert.ok(locked.rows[0].locked, "the test took the foreign server's advisory lock");
    configureAiDriver({
      scanIntervalMs: 60_000,
      pacingMs: 0,
      now: () => 1_000_000,
      loadCandidates: async () => [{ name: GAME, id: LOCK_KEY, active_player_id: 1 }],
      loadGame: async () => world,
      loadCatalog: async () => CATALOG,
      runCommand: async (command) => {
        if (command.kind === "EndTurn") endTurns.push(command);
        return { ok: true };
      },
      appendAudit: async () => {},
    });

    await scanOnce();
    assert.equal(endTurns.length, 0, "another server holds the advisory lock -> this scan skipped the game");

    await holder.query(`SELECT pg_advisory_unlock($1::bigint)`, [LOCK_KEY]);
    await scanOnce();
    assert.equal(endTurns.length, 1, "with the lock freed, the next scan drives the game (real-SQL lock path)");
  } finally {
    holder.release();
  }
});

test("forbidden_not_your_turn passes over: no EndTurn, no audit, driving stops", async () => {
  const world = aiTurnWorld([
    makeHero("h1", 1, HERO_TILE.q, HERO_TILE.r, { movementRemaining: 2, troops: 5, stacks: troopStacks("swordsman", 5) }),
  ]);
  const harness = installHarness(world, {
    override: (command) => (command.kind === "MoveHero" ? { ok: false, reason: "forbidden_not_your_turn" } : undefined),
  });

  await scanOnce();

  assert.equal(harness.endTurns.length, 0, "a stolen turn is never closed by the driver");
  assert.equal(harness.audits.length, 0);
});

test("staleness rejections drop only the action: the pass still terminates with EndTurn", async () => {
  const world = aiTurnWorld([
    makeHero("h1", 1, HERO_TILE.q, HERO_TILE.r, { movementRemaining: 2, troops: 5, stacks: troopStacks("swordsman", 5) }),
  ]);
  const harness = installHarness(world, {
    override: (command) => (command.kind === "MoveHero" ? { ok: false, reason: "hero_not_at_fromTile" } : undefined),
  });

  await scanOnce();

  assert.equal(commandsOfKind(harness.commands, "MoveHero").length, 1, "exactly one attempt per pass (the action is dropped, not retried)");
  assert.equal(harness.endTurns.length, 1, "the pass still terminates with EndTurn");
  assert.equal(harness.audits.length, 0);
});

test("every dispatched command names the game and carries the AI seat as actor", async () => {
  const world = aiTurnWorld([
    makeHero("h1", 1, HERO_TILE.q, HERO_TILE.r, { movementRemaining: 2, troops: 5, stacks: troopStacks("swordsman", 5) }),
  ]);
  const harness = installHarness(world);

  await scanOnce();

  assert.ok(harness.commands.length > 0);
  for (const command of harness.commands) {
    assert.equal(command.gameName, GAME);
    assert.equal(command.actor, 1, "the AI seat is the actor on every dispatched command");
  }
});

test("a live garrison fights a settlement battle and is never walk-in captured", async () => {
  const [heroTile, settlementTile] = firstAdjacentPassablePair(SEED + 5) ?? [HERO_TILE, PAIR[1]];
  const garrisoned = makeSettlement("s-g", 0, settlementTile.q, settlementTile.r);
  garrisoned.stacks = troopStacks("peasant", 3);
  const world = aiTurnWorld(
    [makeHero("h1", 1, heroTile.q, heroTile.r, { movementRemaining: 4, troops: 12, stacks: troopStacks("swordsman", 12) })],
    { settlements: [garrisoned], seed: SEED + 5 },
  );
  const harness = installHarness(world);

  await scanOnce();

  const sequence = harness.commands.map((c) => c.kind);
  assert.ok(sequence.includes("SubmitSettlementBattleResult"), "a live garrison fights a settlement battle");
  assert.ok(!sequence.includes("CaptureSettlement"), "a live garrison is never walk-in captured");
});

// ---------------------------------------------------------------------------
// Pending-defender battles: the EnterBattle offer for HUMAN defenders, the
// wait, the force-resolve past the wait deadline, and the AI-defender
// regression. The fixture seed is chosen by SIMULATING pickAiMove so the
// approach move is guaranteed to land the AI hero inside the defender's
// adjacency on the first move (the D4 fixture's simulation precedent).
// ---------------------------------------------------------------------------

function firstDefenderApproachTriple(seed: number): [Axial, Axial, Axial] | null {
  const map = new GameMap(seed, MAP_SIZE);
  const usable = (q: number, r: number) => map.isPassable(q, r) && map.resourceTileAt(q, r) === undefined;
  for (const mid of passableTiles(seed)) {
    for (const dir of HEX_DIRECTIONS) {
      const defender = { q: mid.q + dir.q, r: mid.r + dir.r };
      const hero = { q: mid.q - dir.q, r: mid.r - dir.r };
      if (usable(defender.q, defender.r) && usable(hero.q, hero.r)) return [hero, mid, defender];
    }
  }
  return null;
}

const APPROACH = (() => {
  for (let seed = 1; seed < 500; seed++) {
    const triple = firstDefenderApproachTriple(seed);
    if (!triple) continue;
    const [heroTile, , defenderTile] = triple;
    const state = makeState({
      players: [makePlayer(0, "player", ["d0"], []), makePlayer(1, "ai", ["h1"], [])],
      heroes: [
        makeHero("h1", 1, heroTile.q, heroTile.r, { movementRemaining: 4, troops: 5, stacks: troopStacks("swordsman", 5) }),
        makeHero("d0", 0, defenderTile.q, defenderTile.r, { troops: 1, stacks: troopStacks("peasant", 1) }),
      ],
      activePlayerId: 1,
      phase: { kind: "AI_TURN", playerId: 1 },
    });
    const move = pickAiMove(
      state,
      "h1",
      new GameMap(seed, MAP_SIZE),
      mulberry32((seed ^ 1 ^ 1) >>> 0),
      CATALOG,
      new Set<string>(),
    );
    if (!move) continue;
    if (move.cost > 4) continue;
    if (hexDistance(move.toTile, defenderTile) !== 1) continue;
    return { seed, heroTile, defenderTile };
  }
  throw new Error("no seed under 500 gives a one-move approach into the defender's adjacency");
})();

// The AI seat's hero one move away from a defender (owner configurable by
// the caller's surgery); the fixture's distant h0 is dropped so the defender
// is the ONLY enemy target and the approach is deterministic.
function defenderApproachWorld(): AiDriverGameSnapshot {
  const world = aiTurnWorld(
    [makeHero("h1", 1, APPROACH.heroTile.q, APPROACH.heroTile.r, { movementRemaining: 4, troops: 5, stacks: troopStacks("swordsman", 5) })],
    { seed: APPROACH.seed },
  );
  delete world.state.heroes["h0"];
  world.state.players = world.state.players.map((p) =>
    p.id === 0 ? { ...p, heroIds: p.heroIds.filter((id) => id !== "h0") } : p,
  );
  return world;
}

function humanDefenderWorld(): AiDriverGameSnapshot {
  const world = defenderApproachWorld();
  world.state.heroes["d0"] = makeHero("d0", 0, APPROACH.defenderTile.q, APPROACH.defenderTile.r, {
    troops: 1,
    stacks: troopStacks("peasant", 1),
  });
  world.state.players = world.state.players.map((p) =>
    p.id === 0 ? { ...p, heroIds: [...p.heroIds, "d0"] } : p,
  );
  return world;
}

test("human-defender adjacency: the driver offers EnterBattle and waits instead of auto-resolving", async () => {
  const world = humanDefenderWorld();
  const harness = installHarness(world);
  const cap = captureOutcome();
  configureAiDriver({ withGameLock: cap.withGameLock });

  await scanOnce();

  assert.equal(cap.captured[0], "waiting_for_defender", "the pass stops to wait after the offer");
  const enters = commandsOfKind(harness.commands, "EnterBattle");
  assert.equal(enters.length, 1, "exactly one EnterBattle offer");
  assert.equal(enters[0].attackerId, "h1");
  assert.equal(enters[0].defenderId, "d0");
  assert.equal(enters[0].actor, 1, "the AI seat offers as the actor");
  assert.equal(commandsOfKind(harness.commands, "ResolveBattle").length, 0, "a human defender is never auto-resolved");
  assert.equal(harness.endTurns.length, 0, "NO EndTurn while an offer is pending");
  assert.equal(harness.audits.length, 0);
  assert.deepEqual(
    world.pendingBattle,
    { attackerId: "h1", defenderId: "d0", since: 1_000_000 },
    "the pending-battle marker is persisted for the handler",
  );
  const sequence = harness.commands.map((c) => c.kind);
  assert.ok(sequence.indexOf("EnterBattle") > sequence.indexOf("MoveHero"), "the offer chains behind the approach move");
});

test("pending defender battle (fresh marker): the pass waits with zero dispatched commands and no audit", async () => {
  const world = recruitWorld();
  world.pendingBattle = { attackerId: "h1", defenderId: "h0", since: 1_000_000 };
  world.state.phase = { kind: "BATTLE", attackerId: "h1", defenderId: "h0" };
  const harness = installHarness(world);
  const cap = captureOutcome();
  configureAiDriver({ withGameLock: cap.withGameLock });

  await scanOnce();

  assert.equal(cap.captured[0], "waiting_for_defender");
  assert.equal(harness.commands.length, 0, "no recruitment, no moves, nothing dispatched while waiting");
  assert.equal(harness.endTurns.length, 0);
  assert.equal(harness.audits.length, 0, "waiting appends no audit row");
});

test("pending defender battle past the deadline: one force-resolve, wait-expired audit, then the sweep continues", async () => {
  const world = humanDefenderWorld();
  world.pendingBattle = { attackerId: "h1", defenderId: "d0", since: 1_000_000_000 };
  world.state.phase = { kind: "BATTLE", attackerId: "h1", defenderId: "d0" };
  const harness = installHarness(world, {
    defenderWaitTimeoutMs: 5_000,
    now: () => 1_000_006_000,
  });
  const cap = captureOutcome();
  configureAiDriver({ withGameLock: cap.withGameLock });

  await scanOnce();

  const resolves = commandsOfKind(harness.commands, "ResolveBattle");
  assert.equal(resolves.length, 1, "exactly one force-resolve for the pending pair");
  assert.equal(resolves[0].attackerId, "h1");
  assert.equal(resolves[0].defenderId, "d0");
  assert.equal(commandsOfKind(harness.commands, "EnterBattle").length, 0, "no NEW offer is dispatched");
  const sequence = harness.commands.map((c) => c.kind);
  assert.ok(
    sequence.indexOf("ResolveBattle") < sequence.indexOf("MoveHero"),
    "the force-resolve precedes the resumed sweep",
  );
  assert.ok(commandsOfKind(harness.commands, "MoveHero").length >= 1, "the sweep resumed after the force-resolve");
  assert.equal(harness.endTurns.length, 1, "the resumed turn terminates with EndTurn");
  assert.equal(cap.captured[0], "ended_turn");
  assert.equal(harness.audits.length, 1, "exactly one wait-expired audit row");
  assert.equal(harness.audits[0].kind, AI_DEFENDER_WAIT_EXPIRED_AUDIT_KIND);
  const payload = harness.audits[0].payload as { attackerId: string; defenderId: string; waitedMs: number; round: number };
  assert.equal(payload.attackerId, "h1");
  assert.equal(payload.defenderId, "d0");
  assert.equal(payload.waitedMs, 6_000);
  assert.equal(payload.round, 1);
});

test("resolved defender battle: a snapshot without the marker resumes the normal sweep", async () => {
  const world = humanDefenderWorld();
  // The handler resolved the pair: the defender is gone and no marker is set.
  delete world.state.heroes["d0"];
  world.state.players = world.state.players.map((p) =>
    p.id === 0 ? { ...p, heroIds: p.heroIds.filter((id) => id !== "d0") } : p,
  );
  const harness = installHarness(world);
  const cap = captureOutcome();
  configureAiDriver({ withGameLock: cap.withGameLock });

  await scanOnce();

  assert.equal(cap.captured[0], "ended_turn", "the pass drives normally, no waiting");
  assert.ok(commandsOfKind(harness.commands, "MoveHero").length >= 1);
  assert.equal(commandsOfKind(harness.commands, "ResolveBattle").length, 0);
  assert.equal(commandsOfKind(harness.commands, "EnterBattle").length, 0);
  assert.equal(harness.endTurns.length, 1);
  assert.equal(harness.audits.length, 0);
});

test("AI defender regression: an adjacent AI-seat defender still auto-resolves via ResolveBattle", async () => {
  const world = defenderApproachWorld();
  world.state.players = [...world.state.players, makePlayer(2, "ai", ["d2"], [])];
  world.state.heroes["d2"] = makeHero("d2", 2, APPROACH.defenderTile.q, APPROACH.defenderTile.r, {
    troops: 1,
    stacks: troopStacks("peasant", 1),
  });
  const harness = installHarness(world);
  const cap = captureOutcome();
  configureAiDriver({ withGameLock: cap.withGameLock });

  await scanOnce();

  assert.equal(commandsOfKind(harness.commands, "EnterBattle").length, 0, "an AI defender is never offered the battle");
  const resolves = commandsOfKind(harness.commands, "ResolveBattle");
  assert.equal(resolves.length, 1, "the old path auto-resolves an AI defender");
  assert.equal(resolves[0].attackerId, "h1");
  assert.equal(resolves[0].defenderId, "d2");
  assert.equal(resolves[0].actor, 1);
  assert.equal(cap.captured[0], "ended_turn", "the AI-vs-AI battle does not stop the pass");
});

test("missing defender owner: the collision is audited and skipped without ResolveBattle or EnterBattle", async () => {
  const world = humanDefenderWorld();
  // Corrupt/desynced snapshot: the defender hero exists with troops, but its
  // owner player is absent from state.players. Neither battle command can
  // succeed; the driver must surface the anomaly and skip the collision
  // instead of falling through to a doomed ResolveBattle.
  world.state.players = world.state.players.filter((p) => p.id !== 0);
  const harness = installHarness(world);
  const cap = captureOutcome();
  configureAiDriver({ withGameLock: cap.withGameLock });

  await scanOnce();

  assert.ok(commandsOfKind(harness.commands, "MoveHero").length >= 1, "the approach move still happened");
  assert.equal(commandsOfKind(harness.commands, "EnterBattle").length, 0, "no offer for an unowned defender");
  assert.equal(commandsOfKind(harness.commands, "ResolveBattle").length, 0, "no auto-resolve for an unowned defender");
  assert.equal(harness.audits.length, 1, "exactly one missing-owner audit row");
  assert.equal(harness.audits[0].kind, AI_DEFENDER_OWNER_MISSING_AUDIT_KIND);
  const payload = harness.audits[0].payload as {
    attackerId: string;
    defenderId: string;
    reason: string;
    round: number;
  };
  assert.equal(payload.attackerId, "h1");
  assert.equal(payload.defenderId, "d0");
  assert.equal(payload.reason, "defender_owner_missing");
  assert.equal(payload.round, 1);
  assert.equal(cap.captured[0], "ended_turn", "the pass terminates normally instead of stalling");
  assert.equal(harness.endTurns.length, 1, "the turn still ends");
});

test("budget exhaustion cannot EndTurn past a pending offer (the offer returns before the exhaustion block)", async () => {
  const world = humanDefenderWorld();
  const harness = installHarness(world, { actionBudget: 2 });
  const cap = captureOutcome();
  configureAiDriver({ withGameLock: cap.withGameLock });

  await scanOnce();

  assert.equal(cap.captured[0], "waiting_for_defender");
  assert.equal(harness.endTurns.length, 0, "no exhaustion EndTurn may follow an offer");
  assert.equal(harness.audits.length, 0, "no turn_skipped audit may follow an offer");
  const enters = commandsOfKind(harness.commands, "EnterBattle");
  assert.equal(enters.length, 1);
  // The gate strictly follows a successful MoveHero dispatch, so the
  // tightest budget that can REACH an offer is 2 (move + offer): the pin is
  // that the offer may spend the LAST budgeted action and the pass still
  // returns waiting_for_defender instead of falling into the exhaustion
  // EndTurn + audit.
  assert.equal(harness.commands.length, 2);
});

test("aiStillActive accepts the offered-battle BATTLE phase for the seat's own attacker", async () => {
  const world = humanDefenderWorld();
  world.pendingBattle = { attackerId: "h1", defenderId: "d0", since: 1_000_000 };
  world.state.phase = { kind: "BATTLE", attackerId: "h1", defenderId: "d0" };
  const harness = installHarness(world);
  const cap = captureOutcome();
  configureAiDriver({ withGameLock: cap.withGameLock });

  await scanOnce();
  assert.equal(
    cap.captured[0],
    "waiting_for_defender",
    "the BATTLE phase derived from the marker is not a lost turn",
  );
  assert.equal(harness.commands.length, 0);

  // Contrast: a BATTLE phase whose attacker is NOT the seat's hero is a
  // genuinely lost turn (the marker gate is seat-checked).
  const foreign = humanDefenderWorld();
  foreign.pendingBattle = { attackerId: "d0", defenderId: "h1", since: 1_000_000 };
  foreign.state.phase = { kind: "BATTLE", attackerId: "d0", defenderId: "h1" };
  installHarness(foreign);
  const capForeign = captureOutcome();
  configureAiDriver({ withGameLock: capForeign.withGameLock });

  await scanOnce();
  assert.equal(capForeign.captured[0], "turn_lost", "a BATTLE phase attacking from another seat is a lost turn");
});

// ---------------------------------------------------------------------------
// Phase 3 watchdog: heartbeat stamps, stale-boot adoption, CAS races. The
// harness clock is pinned so beat ages are exact.
// ---------------------------------------------------------------------------

const NOW = 10_000_000;

function foreignCandidates(
  beat: AiDriverBeat | null,
  over: Partial<AiDriverCandidate> = {},
): AiDriverCandidate[] {
  return [
    {
      name: GAME,
      id: 1,
      active_player_id: 1,
      aiDriverToken: "dead-boot-token",
      aiDriverBeat: beat,
      updatedAt: null,
      ...over,
    },
  ];
}

function recorderAdopt(
  adoptions: Array<{ candidate: AiDriverCandidate; previousToken: string }>,
  result: boolean,
) {
  return async (candidate: AiDriverCandidate, previousToken: string): Promise<boolean> => {
    adoptions.push({ candidate, previousToken });
    return result;
  };
}

test("owned candidates are heartbeat-stamped each scan; foreign tokens are not", async () => {
  const world = aiTurnWorld([makeHero("h1", 1, HERO_TILE.q, HERO_TILE.r, { movementRemaining: 0 })]);
  const harness = installHarness(world, {
    driverToken: "boot-A",
    candidates: [{ name: GAME, id: 1, active_player_id: 1, aiDriverToken: "boot-A" }],
  });

  await scanOnce();

  assert.equal(harness.stamps.length, 1, "the owned candidate was stamped");
  assert.equal(harness.stamps[0].aiDriverToken, "boot-A");
  assert.equal(harness.endTurns.length, 1, "the owned game drives normally");
});

test("a foreign token with a fresh beat is left completely alone", async () => {
  const world = aiTurnWorld([makeHero("h1", 1, HERO_TILE.q, HERO_TILE.r, { movementRemaining: 0 })]);
  const adoptions: Array<{ candidate: AiDriverCandidate; previousToken: string }> = [];
  const harness = installHarness(world, {
    now: () => NOW,
    watchdogStaleMs: 60_000,
    candidates: foreignCandidates({ token: "dead-boot-token", at: NOW - 1_000 }),
    adoptGame: recorderAdopt(adoptions, true),
  });

  await scanOnce();

  assert.equal(adoptions.length, 0, "no adoption attempted for a fresh beat");
  assert.equal(harness.stamps.length, 0, "foreign games are never stamped");
  assert.equal(harness.commands.length, 0, "a foreign game is never driven");
  assert.equal(harness.audits.length, 0);
});

test("a foreign token with a stale beat is adopted, audited, and driven", async () => {
  const world = aiTurnWorld([makeHero("h1", 1, HERO_TILE.q, HERO_TILE.r, { movementRemaining: 0 })]);
  const adoptions: Array<{ candidate: AiDriverCandidate; previousToken: string }> = [];
  const harness = installHarness(world, {
    now: () => NOW,
    watchdogStaleMs: 60_000,
    candidates: foreignCandidates({ token: "dead-boot-token", at: NOW - 61_000 }),
    adoptGame: recorderAdopt(adoptions, true),
  });

  await scanOnce();

  assert.equal(adoptions.length, 1, "the stale-boot game was adopted");
  assert.equal(adoptions[0].previousToken, "dead-boot-token");
  assert.equal(harness.audits.length, 1, "exactly one adoption audit row");
  assert.equal(harness.audits[0].kind, AI_TURN_ADOPTED_AUDIT_KIND);
  const payload = harness.audits[0].payload as {
    gameId: number;
    fromToken: string;
    toToken: string;
    beatAt: number | null;
    beatAgeMs: number | null;
  };
  assert.equal(payload.gameId, 1);
  assert.equal(payload.fromToken, "dead-boot-token");
  assert.ok(typeof payload.toToken === "string" && payload.toToken.length > 0, "toToken is this boot");
  assert.equal(payload.beatAt, NOW - 61_000);
  assert.equal(payload.beatAgeMs, 61_000);
  assert.equal(harness.endTurns.length, 1, "the adopted turn is driven to its EndTurn");
  assert.equal(harness.stamps.length, 1, "the adopted game is stamped as ours after adoption");
});

test("a foreign token with NO beat adopts on games.updated_at staleness, not before", async () => {
  const world = aiTurnWorld([makeHero("h1", 1, HERO_TILE.q, HERO_TILE.r, { movementRemaining: 0 })]);
  const adoptions: Array<{ candidate: AiDriverCandidate; previousToken: string }> = [];
  const harness = installHarness(world, {
    now: () => NOW,
    watchdogStaleMs: 60_000,
    candidates: foreignCandidates(null, { updatedAt: NOW - 1_000 }),
    adoptGame: recorderAdopt(adoptions, true),
  });

  await scanOnce();
  assert.equal(adoptions.length, 0, "a freshly-updated beat-less row belongs to a live pre-watchdog boot");
  assert.equal(harness.commands.length, 0);

  const harness2 = installHarness(world, {
    now: () => NOW,
    watchdogStaleMs: 60_000,
    candidates: foreignCandidates(null, { updatedAt: NOW - 61_000 }),
    adoptGame: recorderAdopt(adoptions, true),
  });
  await scanOnce();
  assert.equal(adoptions.length, 1, "a silent beat-less row is adopted");
  assert.equal(harness2.audits[0]?.kind, AI_TURN_ADOPTED_AUDIT_KIND);
  const payload = harness2.audits[0].payload as { beatAt: number | null; beatAgeMs: number | null };
  assert.equal(payload.beatAt, null);
  assert.equal(payload.beatAgeMs, null);
});

test("a lost adoption CAS drives nothing", async () => {
  const world = aiTurnWorld([makeHero("h1", 1, HERO_TILE.q, HERO_TILE.r, { movementRemaining: 0 })]);
  const adoptions: Array<{ candidate: AiDriverCandidate; previousToken: string }> = [];
  const harness = installHarness(world, {
    now: () => NOW,
    watchdogStaleMs: 60_000,
    candidates: foreignCandidates({ token: "dead-boot-token", at: NOW - 61_000 }),
    adoptGame: recorderAdopt(adoptions, false),
  });

  await scanOnce();

  assert.equal(adoptions.length, 1, "the CAS was attempted");
  assert.equal(harness.commands.length, 0, "a lost race drives nothing");
  assert.equal(harness.stamps.length, 0);
  assert.equal(harness.audits.length, 0, "no audit row for a lost race");
});

test("a legacy NULL-token candidate never enters the watchdog", async () => {
  const world = aiTurnWorld([makeHero("h1", 1, HERO_TILE.q, HERO_TILE.r, { movementRemaining: 0 })]);
  const adoptions: Array<{ candidate: AiDriverCandidate; previousToken: string }> = [];
  const harness = installHarness(world, {
    now: () => NOW,
    watchdogStaleMs: 60_000,
    candidates: foreignCandidates(null, { aiDriverToken: null, updatedAt: NOW - 10_000_000 }),
    adoptGame: recorderAdopt(adoptions, true),
  });

  await scanOnce();

  assert.equal(adoptions.length, 0, "NULL tokens use the existing any-boot adoption, not the watchdog");
  assert.equal(harness.endTurns.length, 1, "the legacy game drives normally");
});

test("the stale threshold scales with the candidate count (single-flight scan lag)", async () => {
  const world = aiTurnWorld([makeHero("h1", 1, HERO_TILE.q, HERO_TILE.r, { movementRemaining: 0 })]);
  const adoptions: Array<{ candidate: AiDriverCandidate; previousToken: string }> = [];
  // N=2: threshold = max(1_000, 2*(5_000+5_000)+5_000) = 25_000 -> beat age
  // 20_000 stays fresh. N=1: threshold = 15_000 -> the same age is stale.
  const pairHarness = installHarness(world, {
    now: () => NOW,
    watchdogStaleMs: 1_000,
    passDeadlineMs: 5_000,
    scanIntervalMs: 5_000,
    candidates: [
      ...foreignCandidates({ token: "dead-boot-token", at: NOW - 20_000 }),
      { name: "drv-owned", id: 2, active_player_id: 1, aiDriverToken: undefined, aiDriverBeat: null, updatedAt: null },
    ],
    adoptGame: recorderAdopt(adoptions, true),
  });
  await scanOnce();
  assert.equal(adoptions.length, 0, "N=2 keeps the 20s-old beat fresh");
  assert.ok(pairHarness.commands.every((c) => c.gameName !== GAME), "the foreign game was never driven");

  installHarness(world, {
    now: () => NOW,
    watchdogStaleMs: 1_000,
    passDeadlineMs: 5_000,
    scanIntervalMs: 5_000,
    candidates: foreignCandidates({ token: "dead-boot-token", at: NOW - 20_000 }),
    adoptGame: recorderAdopt(adoptions, true),
  });
  await scanOnce();
  assert.equal(adoptions.length, 1, "N=1 makes the same age stale");
});

// ---------------------------------------------------------------------------
// Default-seam coverage (real Postgres): the candidate scan SQL + the
// loadGame hydration against a real row.
// ---------------------------------------------------------------------------

const PLAYERS = [
  { id: 0, faction: "player", name: "P0", color: "#000000", heroIds: [], settlementIds: [] },
  { id: 1, faction: "ai", name: "AI", color: "#111111", heroIds: [], settlementIds: [] },
];

async function seedRow(name: string, lobby: Record<string, unknown>, activePlayerId: number): Promise<void> {
  await pool.query(
    `INSERT INTO games (name, seed, hero_q, hero_r, active_player_id, players, lobby, map_size)
     VALUES ($1, 1, 2, 2, $2, $3::jsonb, $4::jsonb, 'small')`,
    [name, activePlayerId, JSON.stringify(PLAYERS), JSON.stringify(lobby)],
  );
}

async function cleanupRow(name: string): Promise<void> {
  await pool.query(`DELETE FROM games WHERE name = $1`, [name]);
}

test("default loadCandidates/loadGame pick up flagged games with an active AI seat and skip unflagged ones", async () => {
  const flagged = `test-ai-driver-flagged-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const unflagged = `test-ai-driver-plain-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const foreign = `test-ai-driver-foreign-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const endTurns: Command[] = [];
  try {
    await seedRow(flagged, { aiDriver: "server" }, 1);
    await seedRow(unflagged, {}, 1);
    await seedRow(foreign, { aiDriver: "server", aiDriverToken: "another-servers-boot-token", aiDriverBeat: { token: "another-servers-boot-token", at: Date.now() } }, 1);
    resetAiDriver();
    configureAiDriver({
      scanIntervalMs: 60_000,
      pacingMs: 0,
      now: () => Date.now(),
      runCommand: async (command) => {
        if (command.kind === "EndTurn") endTurns.push(command);
        return { ok: true };
      },
      appendAudit: async () => {},
    });

    await scanOnce();

    assert.ok(
      endTurns.some((c) => c.gameName === flagged),
      "the flagged fixture game was driven (contains, not exact-set: the scan reads the SHARED game_db, where live flagged games may legitimately exist)",
    );
    assert.ok(
      !endTurns.some((c) => c.gameName === unflagged),
      "the unflagged fixture game was never driven",
    );
    assert.ok(
      !endTurns.some((c) => c.gameName === foreign),
      "a flagged game stamped with another server's boot token is never driven (default SQL + token filter; a fresh beat means a live peer owns it)",
    );
    const active = await pool.query<{ active_player_id: number }>(
      `SELECT active_player_id FROM games WHERE name = $1`,
      [flagged],
    );
    assert.equal(active.rows[0].active_player_id, 1, "the scripted EndTurn ran against the default hydration of a real row");
  } finally {
    await cleanupRow(flagged);
    await cleanupRow(unflagged);
    await cleanupRow(foreign);
  }
});

test("default watchdog SQL: a stale-beat foreign row is adopted via the real CAS; a fresh-beat row is not", async () => {
  const fresh = `test-ai-wd-fresh-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const stale = `test-ai-wd-stale-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const endTurns: Command[] = [];
  const audits: Array<{ gameName: string; kind: string; payload: unknown }> = [];
  try {
    await seedRow(fresh, { aiDriver: "server", aiDriverToken: "another-boot", aiDriverBeat: { token: "another-boot", at: Date.now() } }, 1);
    await seedRow(stale, { aiDriver: "server", aiDriverToken: "another-boot", aiDriverBeat: { token: "another-boot", at: Date.now() - 10 * 60_000 } }, 1);
    await pool.query(`UPDATE games SET updated_at = now() - interval '10 minutes' WHERE name = $1`, [stale]);
    resetAiDriver();
    configureAiDriver({
      scanIntervalMs: 60_000,
      pacingMs: 0,
      now: () => Date.now(),
      runCommand: async (command) => {
        if (command.kind === "EndTurn") endTurns.push(command);
        return { ok: true };
      },
      appendAudit: async (gameName, kind, payload) => {
        audits.push({ gameName, kind, payload });
      },
      // The DEFAULT SQL runs, but ONLY the stale fixture may adopt: shared-
      // game_db rows of other boots are off-limits to this test process.
      stampHeartbeats: (stamped) => defaultStampHeartbeats(stamped),
      adoptGame: (candidate, previousToken) =>
        candidate.name === stale ? defaultAdoptGame(candidate, previousToken) : Promise.resolve(false),
    });

    await scanOnce();

    const freshRow = await pool.query<{ token: string | null; beat: unknown }>(
      `SELECT lobby->>'aiDriverToken' AS token, lobby->'aiDriverBeat' AS beat FROM games WHERE name = $1`,
      [fresh],
    );
    assert.equal(freshRow.rows[0].token, "another-boot", "a live peer's game is never restamped");
    assert.ok(endTurns.every((c) => c.gameName !== fresh), "the fresh-beat game was never driven");

    const staleRow = await pool.query<{ token: string | null; beat: { token?: string; at?: number } | null }>(
      `SELECT lobby->>'aiDriverToken' AS token, lobby->'aiDriverBeat' AS beat FROM games WHERE name = $1`,
      [stale],
    );
    assert.equal(staleRow.rows[0].token, aiDriverBootToken(), "the CAS restamped the row to THIS boot's token");
    assert.equal(staleRow.rows[0].beat?.token, aiDriverBootToken(), "the adoption wrote this boot's beat");
    assert.ok(endTurns.some((c) => c.gameName === stale), "the adopted game was driven to EndTurn");
    const adoption = audits.find((a) => a.gameName === stale && a.kind === AI_TURN_ADOPTED_AUDIT_KIND);
    assert.ok(adoption, "exactly the adoption audit was appended for the stale fixture");
    const payload = adoption.payload as { fromToken: string; beatAgeMs: number | null };
    assert.equal(payload.fromToken, "another-boot");
    assert.ok(payload.beatAgeMs !== null && payload.beatAgeMs > 9 * 60_000, "the beat age reflects the 10-minute-old stamp");
  } finally {
    await cleanupRow(fresh);
    await cleanupRow(stale);
  }
});
