import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../../server/persistence/db";
import {
  DISCONNECT_AFTER_MS,
  SKIP_GRACE_MS,
  configureDropPolicy,
  drainPresenceWrites,
  enforceSkipForSeat,
  getPresence,
  resetDropPolicy,
  scanOnce,
  touchSeat,
} from "../../server/app/dropPolicy";
import {
  TURN_SKIPPED_AUDIT_KIND,
  createLiveCommandDeps,
  runServerEndTurnForSeat,
} from "../../server/app/commandHandler";

// Real Postgres, same harness pattern as attachPlayerSeat.test.ts: the
// drop-policy module's row reads/writes (presence flush, active-turn
// lookup, EndTurn pipeline) are the behavior under test, so a mock would
// just re-describe the SQL. No HTTP server is needed -- dropPolicy talks
// to the pool directly and the skip pipeline goes through
// createLiveCommandDeps against the shared pool. Everything timer-shaped
// is made deterministic the same way presenceRegistry's SnapshotOptions
// .now is: an injected clock for detection windows, plus tiny injected
// grace/recheck delays for the real setTimeout half of the lifecycle.
after(async () => {
  await pool.end();
});

function uniqueName(): string {
  return `test-drop-policy-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Two human players, so an EndTurn on seat 0 advances to seat 1.
const PLAYERS = [
  { id: 0, faction: "player", name: "P0", color: "#000000", heroIds: [], settlementIds: [] },
  { id: 1, faction: "player", name: "P1", color: "#111111", heroIds: [], settlementIds: [] },
];

async function seedGame(
  name: string,
  opts: { activePlayerId?: number; lobby?: Record<string, unknown> } = {},
): Promise<void> {
  await pool.query(
    `INSERT INTO games (name, seed, hero_q, hero_r, active_player_id, players, lobby)
     VALUES ($1, 1, 0, 0, $2, $3::jsonb, $4::jsonb)`,
    [
      name,
      opts.activePlayerId ?? 0,
      JSON.stringify(PLAYERS),
      JSON.stringify(opts.lobby ?? {}),
    ],
  );
}

async function cleanupGame(name: string): Promise<void> {
  await pool.query(`DELETE FROM games WHERE name = $1`, [name]);
}

type RowPresence = Record<string, { lastSeenAt: string; connected: boolean }> | null;

async function rowPresence(name: string): Promise<RowPresence> {
  const r = await pool.query<{ presence: RowPresence }>(
    `SELECT lobby->'presence' AS presence FROM games WHERE name = $1`,
    [name],
  );
  return r.rows[0]?.presence ?? null;
}

// Injected clock + recording stubs, re-installed for every test
// (resetDropPolicy in beforeEach wipes both state and config).
let clock = 0;
const endTurnCalls: Array<{ gameName: string; seat: number }> = [];
let phaseQueue: Array<"PLAYER_TURN" | "BATTLE"> = [];

function installTestPolicy(): void {
  clock = 1_000_000;
  endTurnCalls.length = 0;
  phaseQueue = [];
  configureDropPolicy({
    // Compressed detection window; the production constants are pinned by
    // their own test below.
    disconnectAfterMs: 1_000,
    skipGraceMs: 40,
    battleRecheckMs: 20,
    scanIntervalMs: 60_000,
    now: () => clock,
    loadPhaseKind: async () => phaseQueue.shift() ?? "PLAYER_TURN",
    runEndTurn: async (gameName, seat) => {
      endTurnCalls.push({ gameName, seat });
    },
  });
}

beforeEach(() => {
  resetDropPolicy();
  installTestPolicy();
});

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

test("the policy constants match the locked spec values", () => {
  assert.equal(DISCONNECT_AFTER_MS, 60_000);
  assert.equal(SKIP_GRACE_MS, 120_000);
});

test("touchSeat records a heartbeat and getPresence exposes the wire shape", () => {
  const name = uniqueName();
  touchSeat(name, 0);
  const presence = getPresence(name);
  assert.equal(presence["0"].connected, true);
  assert.ok(!Number.isNaN(Date.parse(presence["0"].lastSeenAt)), "lastSeenAt must be ISO");
  // No games-row write yet: staying connected never touches the row.
  assert.equal(presence["1"], undefined);
});

test("a silent seat crosses into disconnected and the marking is flushed to the games row", async () => {
  const name = uniqueName();
  await seedGame(name);
  try {
    touchSeat(name, 0);
    await scanOnce();
    assert.equal((await rowPresence(name))?.["0"], undefined, "connected seats are not flushed");

    clock += 1_001; // past the injected 1s disconnect window
    await scanOnce();
    const presence = await rowPresence(name);
    assert.equal(presence?.["0"]?.connected, false, "the row now carries the disconnect");
    assert.ok(!Number.isNaN(Date.parse(presence?.["0"]?.lastSeenAt ?? "x")));
    assert.equal(getPresence(name)["0"].connected, false);
  } finally {
    await cleanupGame(name);
  }
});

test("a returning heartbeat clears the disconnect, flushes connected:true, and cancels the skip", async () => {
  const name = uniqueName();
  await seedGame(name, { activePlayerId: 0 });
  try {
    touchSeat(name, 0);
    clock += 1_001;
    await scanOnce(); // marks disconnected + schedules a grace skip (seat 0 is active)
    assert.equal(getPresence(name)["0"].connected, false);

    touchSeat(name, 0); // heartbeat -> disconnect cleared
    await drainPresenceWrites();
    assert.equal((await rowPresence(name))?.["0"]?.connected, true);
    assert.equal(getPresence(name)["0"].connected, true);

    await sleep(150); // the 40ms grace would have fired long ago
    assert.equal(endTurnCalls.length, 0, "the heartbeat must cancel the pending skip");
  } finally {
    await cleanupGame(name);
  }
});

test("the skip fires after the grace when the disconnected seat holds the active turn", async () => {
  const name = uniqueName();
  await seedGame(name, { activePlayerId: 0 });
  try {
    touchSeat(name, 0);
    clock += 1_001;
    await scanOnce();
    await sleep(150);
    assert.deepEqual(endTurnCalls, [{ gameName: name, seat: 0 }]);
  } finally {
    await cleanupGame(name);
  }
});

test("a disconnected seat that does not hold the active turn is never skipped", async () => {
  const name = uniqueName();
  await seedGame(name, { activePlayerId: 1 });
  try {
    touchSeat(name, 0);
    clock += 1_001;
    await scanOnce();
    await sleep(150);
    assert.equal(endTurnCalls.length, 0);
    assert.equal(await enforceSkipForSeat(name, 0), "canceled_not_active");
  } finally {
    await cleanupGame(name);
  }
});

test("a BATTLE phase holds the skip and the re-check fires it once the phase resolves", async () => {
  const name = uniqueName();
  await seedGame(name, { activePlayerId: 0 });
  try {
    touchSeat(name, 0);
    clock += 1_001;
    await scanOnce(); // marks seat 0 disconnected + would schedule the grace skip
    phaseQueue = ["BATTLE", "PLAYER_TURN"];
    // Drive the due skip by hand so the phase sequence is deterministic.
    assert.equal(await enforceSkipForSeat(name, 0), "deferred_battle");
    assert.equal(endTurnCalls.length, 0, "a battle must never be resolved by the skip");

    await sleep(120); // the 20ms battle-recheck re-fires and finds PLAYER_TURN
    assert.deepEqual(endTurnCalls, [{ gameName: name, seat: 0 }]);
  } finally {
    await cleanupGame(name);
  }
});

test("a seat that is connected when the skip is enforced is left alone", async () => {
  const name = uniqueName();
  await seedGame(name, { activePlayerId: 0 });
  try {
    touchSeat(name, 0);
    assert.equal(await enforceSkipForSeat(name, 0), "canceled_reconnected");
    assert.equal(endTurnCalls.length, 0);
  } finally {
    await cleanupGame(name);
  }
});

test("enforcing a skip for a game that no longer exists reports game_gone", async () => {
  assert.equal(await enforceSkipForSeat(`nope-${Date.now()}`, 0), "game_gone");
});

test("a pre-restart disconnect survives the restart via the games-row seed", async () => {
  const name = uniqueName();
  await seedGame(name, { activePlayerId: 0 });
  try {
    // Simulate a previous process life: seat 0 went dark and was flushed.
    await pool.query(`UPDATE games SET lobby = $1::jsonb WHERE name = $2`, [
      JSON.stringify({
        presence: { "0": { lastSeenAt: new Date(clock - 500_000).toISOString(), connected: false } },
      }),
      name,
    ]);

    resetDropPolicy();
    installTestPolicy(); // memory wiped, as after an API restart

    // Another seat's first heartbeat triggers the one-time seed.
    touchSeat(name, 1);
    let seeded = false;
    for (let i = 0; i < 100 && !seeded; i++) {
      seeded = getPresence(name)["0"] !== undefined;
      if (!seeded) await sleep(10);
    }
    assert.ok(seeded, "the seed should pull persisted presence into memory");
    assert.equal(getPresence(name)["0"].connected, false, "the old disconnect must not resurrect");

    clock += 1_001;
    await scanOnce(); // seat 0 already disconnected + active -> grace scheduled
    await sleep(150);
    assert.deepEqual(endTurnCalls, [{ gameName: name, seat: 0 }]);
  } finally {
    await cleanupGame(name);
  }
});

test("runServerEndTurnForSeat runs the real EndTurn pipeline and appends the turn_skipped audit", async () => {
  const name = uniqueName();
  await seedGame(name, { activePlayerId: 0 });
  try {
    const deps = await createLiveCommandDeps();
    const result = await runServerEndTurnForSeat(name, 0, deps);
    assert.equal(result.ok, true, `pipeline failed: ${result.reason}`);
    assert.equal(result.activePlayerId, 1, "the turn advanced to seat 1");

    const r = await pool.query<{
      kind: string;
      payload: Record<string, unknown>;
      actor_seat: number | null;
    }>(
      `SELECT kind, payload, actor_seat FROM game_events
        WHERE game_id = (SELECT id FROM games WHERE name = $1) ORDER BY id ASC`,
      [name],
    );
    const kinds = r.rows.map((row) => row.kind);
    assert.ok(kinds.includes("TurnEnded"), "the ordinary TurnEnded event is still appended");
    assert.ok(kinds.includes("turn_ended"), "the legacy audit kind is preserved");

    const skipped = r.rows.filter((row) => row.kind === TURN_SKIPPED_AUDIT_KIND);
    assert.equal(skipped.length, 1, "exactly one turn_skipped audit row");
    assert.equal(skipped[0].actor_seat, null, "server-initiated, not attributable to the seat");
    assert.equal(skipped[0].payload.playerId, 0);
    assert.equal(skipped[0].payload.reason, "disconnected_grace_expired");
  } finally {
    await cleanupGame(name);
  }
});

test("runServerEndTurnForSeat declines a seat that does not hold the active turn", async () => {
  const name = uniqueName();
  await seedGame(name, { activePlayerId: 1 });
  try {
    const deps = await createLiveCommandDeps();
    const result = await runServerEndTurnForSeat(name, 0, deps);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "forbidden_not_your_turn");
    const r = await pool.query(
      `SELECT 1 FROM game_events
        WHERE kind = $1 AND game_id = (SELECT id FROM games WHERE name = $2)`,
      [TURN_SKIPPED_AUDIT_KIND, name],
    );
    assert.equal(r.rowCount, 0, "a declined skip appends no audit row");
  } finally {
    await cleanupGame(name);
  }
});
