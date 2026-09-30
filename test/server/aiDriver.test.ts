import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  GameMap,
  mulberry32,
  normalizePlatoons,
  pickAiMove,
  pickGarrisonRecruitment,
  resolveBattle,
  type MapSize,
  type UnitType,
} from "@heroes/engine";
import { hexDistance, HEX_DIRECTIONS } from "@heroes/contracts";
import type { Axial, Command, HeroId } from "@heroes/contracts";
import {
  AI_TURN_ACTION_BUDGET,
  AI_TURN_PASS_DEADLINE_MS,
  configureAiDriver,
  isGameTrackedByDriver,
  resetAiDriver,
  scanOnce,
  type AiDriverCommandOutcome,
  type AiDriverGameSnapshot,
} from "../../server/app/aiDriver";
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
  return { gameId: opts?.gameId ?? 1, seed: opts?.seed ?? SEED, mapSize: MAP_SIZE, state };
}

interface ScriptedHarness {
  commands: Command[];
  endTurns: Command[];
  audits: Array<{ gameName: string; kind: string; payload: unknown }>;
  gameGone: { value: boolean };
}

// Scripted dispatch mirroring the real handlers' narrow behavior: the
// MoveHero staleness guard, position application, walk-in capture owner
// flip, settlement-battle outcome application, and a per-kind outcome
// override map for rejection scenarios.
function installHarness(
  world: AiDriverGameSnapshot,
  opts?: {
    candidates?: Array<{ name: string; id: number; active_player_id: number }>;
    actionBudget?: number;
    passDeadlineMs?: number;
    override?: (command: Command) => AiDriverCommandOutcome | undefined;
  },
): ScriptedHarness {
  const candidates = opts?.candidates ?? [{ name: GAME, id: world.gameId, active_player_id: 1 }];
  const harness: ScriptedHarness = { commands: [], endTurns: [], audits: [], gameGone: { value: false } };
  configureAiDriver({
    scanIntervalMs: 60_000,
    pacingMs: 0,
    actionBudget: opts?.actionBudget ?? AI_TURN_ACTION_BUDGET,
    passDeadlineMs: opts?.passDeadlineMs ?? AI_TURN_PASS_DEADLINE_MS,
    now: () => 1_000_000,
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
      if (command.kind === "ResolveBattle") {
        const attacker = world.state.heroes[command.attackerId];
        if (!attacker) return { ok: false, reason: "hero_not_found" };
        delete world.state.heroes[command.defenderId];
        world.state.players = world.state.players.map((p) =>
          p.id !== attacker.ownerId ? { ...p, heroIds: p.heroIds.filter((id) => id !== command.defenderId) } : p,
        );
        return { ok: true };
      }
      return { ok: true };
    },
    appendAudit: async (gameName, kind, payload) => {
      harness.audits.push({ gameName, kind, payload });
    },
  });
  return harness;
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
});

test("whole-turn drive per pass: two heroes spend their movement across sweeps, then EndTurn with no growthRate", async () => {
  const world = aiTurnWorld([
    makeHero("h1", 1, HERO_TILE.q, HERO_TILE.r, { movementRemaining: 2, troops: 5, stacks: troopStacks("swordsman", 5) }),
    makeHero("h2", 1, passableTiles(SEED)[50].q, passableTiles(SEED)[50].r, { movementRemaining: 2, troops: 5, stacks: troopStacks("swordsman", 5) }),
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
  // the (still-garrisoned) settlement tile -- exactly the D15 shape.
  const defender = makeHero("h0d", 0, settlementTile.q, settlementTile.r, { troops: 1, stacks: troopStacks("peasant", 1) });
  world.state.heroes["h0d"] = defender;
  world.state.players = world.state.players.map((p) =>
    p.id === 0 ? { ...p, heroIds: [...p.heroIds, "h0d"] } : p,
  );
  const harness = installHarness(world, {
    override: (command) => {
      if (command.kind === "ResolveBattle") {
        delete world.state.heroes["h0d"];
        const attacker = world.state.heroes[command.attackerId];
        attacker.q = settlementTile.q;
        attacker.r = settlementTile.r;
        world.state.players = world.state.players.map((p) =>
          p.id === 0 ? { ...p, heroIds: p.heroIds.filter((id) => id !== "h0d") } : p,
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
  const endTurns: Command[] = [];
  try {
    await seedRow(flagged, { aiDriver: "server" }, 1);
    await seedRow(unflagged, {}, 1);
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

    assert.deepEqual(endTurns.map((c) => c.gameName), [flagged], "only the flagged game was driven");
    const active = await pool.query<{ active_player_id: number }>(
      `SELECT active_player_id FROM games WHERE name = $1`,
      [flagged],
    );
    assert.equal(active.rows[0].active_player_id, 1, "the scripted EndTurn ran against the default hydration of a real row");
  } finally {
    await cleanupRow(flagged);
    await cleanupRow(unflagged);
  }
});
