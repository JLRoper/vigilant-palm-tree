import { Router } from "express";
import { pool, withTransaction } from "./db";
import {
  GameMap,
  isHealthy,
  makeInitialStatePayload,
  mulberry32,
  validateGameRow,
  MAX_PLAYERS,
  type MapSize,
  type UnitType,
} from "@heroes/engine";
import type {
  HeroState,
  Player,
  SettlementState,
} from "@heroes/contracts";
import type { PoolClient } from "pg";
import { assetRouter } from "./assetRoutes";
import { authRouter, attachAuth } from "./auth";
import { invalidateMembershipCache } from "./middleware/attachPlayerSeat";
import { commandsRouter, invalidateAiSeatCache } from "./http/routes/commands";
import { aiDriverBootToken } from "./app/aiDriverToken";
import { telemetryRouter } from "./http/routes/telemetry";
import { battleActionsRouter } from "./http/routes/battleActions";
import {
  eventStreamRouter,
  ROWS_AFTER_SQL,
} from "./http/routes/eventStream";

export const router = Router();

router.use("/assets", assetRouter);
router.use("/auth", authRouter);
router.use("/games/:name/commands", commandsRouter);
router.use("/games/:name/telemetry", telemetryRouter);
router.use("/games/:name/battle-actions", battleActionsRouter);
router.use("/games/:name/events/stream", eventStreamRouter);

type EnemyPos = { q: number; r: number };
type TileRow = {
  q: number;
  r: number;
  terrain: string;
  resource: string | null;
};

type FullGameRow = {
  id: number;
  name: string;
  seed: number;
  hero_q: number;
  hero_r: number;
  turn: number;
  gold: number;
  enemy_positions: EnemyPos[];
  round: number;
  day: number;
  active_player_id: number;
  players: Player[];
  heroes: Record<string, HeroState>;
  settlements: Record<string, SettlementState>;
  map_size: string;
  lobby: LobbyState;
  created_at: string;
  updated_at: string;
};

export interface LobbyState {
  seats?: number;
  humanSlots?: number;
  // email (server-derived from req.authEmail, never client-supplied) binds
  // this seat to the caller's identity when they were signed in at claim
  // time; sign-in is optional (issue #179 follow-up), so an anonymous claim
  // leaves it unset. handle stays purely cosmetic either way.
  claimed?: Record<string, { handle: string; email?: string; claimedAt: string }>;
  startedAt?: string;
  // Drop-policy presence (docs/multiplayer.md, shipped 2026-09-27), keyed by
  // seat index. Written by server/app/dropPolicy.ts on connected->disconnected
  // and disconnect-cleared transitions only (never per 2s heartbeat); this is
  // the disconnected-seat signal every client reads off the existing game
  // poll. Seats with no entry have not transitioned since this API process
  // started tracking the game -- absence reads as "nothing to flag".
  presence?: Record<string, { lastSeenAt: string; connected: boolean }>;
  // Server-side AI actor flag (plan/2026-09-30-server-side-ai-actor.md D1):
  // "server" on any game created with enemySlots > 0 -- the API's
  // aiDriver scanner owns those AI seats' turns end-to-end. Absent (=
  // browser-driven) on legacy/starter/lobby games (D2).
  aiDriver?: "server";
  // Boot token of the API process that created this game (cross-server
  // race fix, 2026-09-30): the scanner only drives games stamped with its
  // own aiDriverBootToken(), so dev worktrees sharing one game_db never
  // drive each other's AI games. Absent on legacy flagged games =
  // adoption path (any server, arbitrated by the per-game advisory lock).
  aiDriverToken?: string;
  // Legacy instant auto-trade gate (2026-10-02, Rec 4): ON for existing
  // saves, OFF for new games. ABSENT reads as `true` -- every pre-flag save
  // (created before POST /games started writing this) keeps the instant
  // end-of-turn auto-trade it was balanced around. New games are written
  // with an explicit `false` (optional `legacyAutoTrade` request body, an
  // opt-IN for the legacy behaviour), so their food logistics go through the
  // caravan recommender (economy/tradeNeeds.ts) instead of the teleport.
  legacyAutoTrade?: boolean;
}

const GAME_COLUMNS =
  "id, name, seed, hero_q, hero_r, turn, gold, enemy_positions, round, day, active_player_id, players, heroes, settlements, map_size, lobby, created_at, updated_at";

async function generateAndInsertTiles(
  client: PoolClient,
  gameId: number,
  seed: number,
  onConflict: "upsert" | "skip",
  mapSize?: MapSize,
): Promise<void> {
  const map = new GameMap(seed, mapSize);
  const values: string[] = [];
  const params: unknown[] = [];
  let i = 0;
  for (let r = 0; r < map.height; r++) {
    for (let q = 0; q < map.width; q++) {
      const t = map.get(q, r);
      const res = map.resourceTileAt(q, r);
      const base = i * 5;
      values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`);
      params.push(gameId, q, r, t ?? "grass", res?.resource ?? null);
      i++;
    }
  }
  const suffix =
    onConflict === "upsert"
      ? `ON CONFLICT (game_id, q, r) DO UPDATE SET terrain = EXCLUDED.terrain, resource = EXCLUDED.resource`
      : `ON CONFLICT (game_id, q, r) DO NOTHING`;
  await client.query(
    `INSERT INTO tiles (game_id, q, r, terrain, resource) VALUES ${values.join(", ")} ${suffix}`,
    params
  );
}

router.get("/health", async (_req, res) => {
  const r = await pool.query("SELECT 1 AS ok");
  res.json({ ok: r.rows[0].ok === 1 });
});

type UnitTypeRow = {
  id: string;
  name: string;
  attack: number;
  defence: number;
  health: number;
  speed: number;
  description: string;
  advantage_type: UnitType["advantageType"];
  specialty: string;
  specialty_priority: number;
  tier: number;
  upkeep_gold: number;
  upkeep_food: number;
  range: number;
};

router.get("/units", async (_req, res) => {
  try {
    res.json(await loadUnitCatalog());
  } catch (err) {
    console.error("[api] GET /units threw:", err);
    res.status(500).json({
      error: "internal",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

/**
 * The unit catalog as `Record<id, UnitType>`, straight from `unit_types`. Used by
 * GET /units and by POST /games, which needs it to price the starting heroes'
 * weekly food bill against the seeded starter farmland (engine init.ts's
 * seedStarterBuildings reads BuildInitialOptions.unitTypes).
 */
async function loadUnitCatalog(): Promise<UnitType[]> {
  const r = await pool.query<UnitTypeRow>(
    `SELECT id, name, attack, defence, health, speed, description, advantage_type, specialty, specialty_priority,
            tier, upkeep_gold, upkeep_food, range
       FROM unit_types ORDER BY attack ASC, id ASC`,
  );
  return r.rows.map((row) => ({
    id: row.id,
    name: row.name,
    attack: row.attack,
    defence: row.defence,
    health: row.health,
    speed: row.speed,
    description: row.description,
    advantageType: row.advantage_type,
    specialty: row.specialty,
    specialtyPriority: row.specialty_priority,
    tier: row.tier as UnitType["tier"],
    upkeepGold: row.upkeep_gold,
    upkeepFood: row.upkeep_food,
range: row.range,
  }));
}

router.get("/games", async (_req, res) => {
  const r = await pool.query<FullGameRow>(
    `SELECT ${GAME_COLUMNS} FROM games ORDER BY id DESC`
  );
  res.json(r.rows);
});

router.get("/games/:name", async (req, res) => {
  // last_event_id is the poll cursor a fresh client load seeds from (#146):
  // taken in the same statement as the state it labels, so no event can slip
  // between the snapshot and the cursor. ::text because game_events.id is a
  // BIGSERIAL -- node-postgres hands int8 back as a string either way, and
  // the client Number()s it (same reasoning as eventRepo.append's own).
  const r = await pool.query<FullGameRow & { last_event_id: string }>(
    `SELECT ${GAME_COLUMNS},
            COALESCE((SELECT MAX(e.id) FROM game_events e WHERE e.game_id = games.id), 0)::text
              AS last_event_id
       FROM games WHERE name = $1`,
    [req.params.name]
  );
  if (r.rowCount === 0) {
    res.status(404).json({ error: "not found" });
    return;
  }
  const row = r.rows[0];
  const claimed = row.lobby?.claimed ?? {};
  const availableSeats = Object.keys(claimed)
    .map((k) => Number(k))
    .filter((n) => Number.isInteger(n))
    .filter((n) => !claimed[String(n)])
    .sort((a, b) => a - b);
  const seatTotal = row.lobby?.seats ?? row.players.length;
  res.json({ ...row, availableSeats, seatTotal });
});

router.get("/games/:name/validate", async (req, res) => {
  const r = await pool.query<FullGameRow>(
    `SELECT ${GAME_COLUMNS} FROM games WHERE name = $1`,
    [req.params.name]
  );
  if (r.rowCount === 0) {
    res.status(404).json({ error: "not found" });
    return;
  }
  const issues = validateGameRow(r.rows[0]);
  res.json({
    healthy: isHealthy(issues),
    errorCount: issues.filter((i) => i.severity === "error").length,
    warningCount: issues.filter((i) => i.severity === "warning").length,
    issues,
  });
});

// attachAuth only, not attachPlayerSeat -- claiming is how you become a
// member in the first place. Sign-in is optional (issue #179 follow-up):
// a signed-in caller's claim gets bound to their email for the commands
// route's optional actor-vs-seat check; an anonymous claim still works,
// same as before #179, just without that extra binding.
router.post("/games/:name/lobby/claim", attachAuth, async (req, res) => {
  const { seat, handle } = req.body ?? {};
  if (!Number.isInteger(seat) || typeof handle !== "string" || !handle.trim()) {
    res.status(400).json({ error: "seat (int) and handle (string) required" });
    return;
  }
  const cleanHandle = handle.trim().slice(0, 32);
  const email = req.authEmail;
  try {
    const result = await withTransaction(async (client) => {
      const gr = await client.query<FullGameRow>(
        `SELECT ${GAME_COLUMNS} FROM games WHERE name = $1`,
        [req.params.name]
      );
      if (gr.rowCount === 0) return { status: 404 as const };
      const row = gr.rows[0];
      const started = Boolean(row.lobby?.startedAt);
      const existingClaim = row.lobby?.claimed?.[String(seat)];
      // Drop-policy rejoin reclaim (docs/multiplayer.md, shipped 2026-09-27):
      // a STARTED game's seat whose claim is bound to the caller's
      // server-derived auth email can be reclaimed by that same identity
      // (a closed laptop rejoins without a new seat). Handle-only (anonymous)
      // claims cannot rebind, and brand-new seats still cannot be claimed
      // once the lobby has started -- only the email match unlocks this path.
      const reclaimable = started && !!email && existingClaim?.email === email;
      if (started && !reclaimable) {
        return { status: 409 as const, error: "lobby_already_started" };
      }
      const seats = row.lobby?.seats ?? row.players.length;
      if (seat < 0 || seat >= seats) {
        return { status: 400 as const, error: "seat_out_of_range" };
      }
      const claimed = { ...(row.lobby?.claimed ?? {}) };
      if (claimed[String(seat)] && !reclaimable) {
        return { status: 409 as const, error: "seat_already_claimed" };
      }
      // On reclaim the handle/claimedAt refresh to the rejoining client's
      // current values (both are cosmetic bookkeeping); the email binding
      // is re-asserted, unchanged by definition since it authorized this.
      claimed[String(seat)] = { handle: cleanHandle, email, claimedAt: new Date().toISOString() };
      const newPlayers = row.players.map((p) =>
        p.id === seat ? { ...p, faction: "player" as const, name: cleanHandle } : p,
      );
      const newLobby: LobbyState = { ...(row.lobby ?? {}), claimed, seats };
      const ur = await client.query<FullGameRow>(
        `UPDATE games SET lobby = $1::jsonb, players = $2::jsonb, updated_at = now()
         WHERE id = $3 RETURNING ${GAME_COLUMNS}`,
        [JSON.stringify(newLobby), JSON.stringify(newPlayers), row.id]
      );
      return { status: 200 as const, game: ur.rows[0] };
    });
    if (result.status === 404) {
      res.status(404).json({ error: "not found" });
      return;
    }
    if (result.status === 400 || result.status === 409) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    invalidateMembershipCache(String(req.params.name));
    res.json(result.game);
  } catch (err) {
    console.error("[api] POST /games/:name/lobby/claim threw:", err);
    res.status(500).json({ error: "internal", message: err instanceof Error ? err.message : String(err) });
  }
});

router.post("/games/:name/lobby/start", async (req, res) => {
  try {
    const result = await withTransaction(async (client) => {
      const gr = await client.query<FullGameRow>(
        `SELECT ${GAME_COLUMNS} FROM games WHERE name = $1`,
        [req.params.name]
      );
      if (gr.rowCount === 0) return { status: 404 as const };
      const row = gr.rows[0];
      const seats = row.lobby?.seats ?? row.players.length;
      const claimed = row.lobby?.claimed ?? {};
      const missing: number[] = [];
      for (let i = 0; i < seats; i++) {
        if (!claimed[String(i)]) missing.push(i);
      }
      if (missing.length > 0) {
        return { status: 409 as const, error: "seats_unclaimed", missing };
      }
      if (row.lobby?.startedAt) {
        return { status: 409 as const, error: "lobby_already_started" };
      }
      const newLobby: LobbyState = { ...(row.lobby ?? {}), startedAt: new Date().toISOString() };
      const ur = await client.query<FullGameRow>(
        `UPDATE games SET lobby = $1::jsonb, updated_at = now()
         WHERE id = $2 RETURNING ${GAME_COLUMNS}`,
        [JSON.stringify(newLobby), row.id]
      );
      return { status: 200 as const, game: ur.rows[0] };
    });
    if (result.status === 404) {
      res.status(404).json({ error: "not found" });
      return;
    }
    if (result.status === 409) {
      res.status(409).json({ error: result.error, missing: "missing" in result ? result.missing : undefined });
      return;
    }
    res.json(result.game);
  } catch (err) {
    console.error("[api] POST /games/:name/lobby/start threw:", err);
    res.status(500).json({ error: "internal", message: err instanceof Error ? err.message : String(err) });
  }
});

router.post("/games", async (req, res) => {
  try {
    const {
      name,
      seed = 42,
      hero_q = 2,
      hero_r = 2,
      enemy_positions = [],
      mapSize,
      lobby,
      humanSlots,
      enemySlots,
      legacyAutoTrade: legacyAutoTradeOptIn,
    } = req.body ?? {};
    if (typeof name !== "string" || !name) {
      res.status(400).json({ error: "name required" });
      return;
    }
    const storedMapSize = ["small", "medium", "large"].includes(mapSize) ? mapSize : "small";
    console.log(`[api] POST /games name=${name} hero=(${hero_q},${hero_r}) mapSize=${storedMapSize}`);
    const map = new GameMap(seed, storedMapSize as MapSize);
    const topHumanSlots = Number.isInteger(humanSlots) ? (humanSlots as number) : null;
    const lobbyObj = lobby && typeof lobby === "object" ? lobby : null;
    const lobbyHumanSlots =
      lobbyObj && Number.isInteger(lobbyObj.humanSlots) ? (lobbyObj.humanSlots as number) : null;
    const humanCount = topHumanSlots ?? lobbyHumanSlots;
    const rawEnemySlots =
      Number.isInteger(enemySlots) && (enemySlots as number) >= 0 ? (enemySlots as number) : 0;
    const enemySlotsSafe =
      humanCount !== null
        ? Math.max(0, Math.min(rawEnemySlots, MAX_PLAYERS - humanCount))
        : 0;
    const initOptsBase =
      humanCount !== null
        ? {
            playerCount: humanCount + enemySlotsSafe,
            humanSeatCount: humanCount,
            enemyCount: enemySlotsSafe,
          }
        : {};
    // The catalog prices the starting heroes' weekly food bill against the
    // seeded starter farmland. Best-effort: without it the engine falls back to
    // the flat 1g/1f per-unit default rather than failing game creation.
    let initUnitTypes: Record<string, UnitType> = {};
    try {
      initUnitTypes = Object.fromEntries((await loadUnitCatalog()).map((u) => [u.id, u]));
    } catch (err) {
      console.warn("[api] POST /games: unit catalog unavailable, starter food bill uses 1g/1f defaults:", err);
    }
    const initOpts = { ...initOptsBase, unitTypes: initUnitTypes };
    const initial = makeInitialStatePayload(map, mulberry32(seed ^ 0x706c6179), initOpts);

    let lobbyState: LobbyState = {
      // Rec 4: new games run WITHOUT instant auto-trade (explicit false, so
      // "absent → true" can never resurrect it on a fresh row); a request
      // body of `legacyAutoTrade: true` opts a new game back into the legacy
      // behaviour. Non-boolean junk reads as the default (false).
      legacyAutoTrade: legacyAutoTradeOptIn === true,
    };
    const explicitSeats =
      lobbyObj && Number.isInteger(lobbyObj.seats) ? (lobbyObj.seats as number) : null;
    const seats = explicitSeats ?? (humanCount !== null ? humanCount : null);
    if (seats !== null && seats >= 1 && humanCount !== null && humanCount >= 1 && humanCount <= seats) {
      lobbyState = { seats, humanSlots: humanCount, claimed: {} };
    }
    if (lobbyState.humanSlots !== undefined && lobbyState.humanSlots < 1) {
      res.status(400).json({ error: "humanSlots must be >= 1" });
      return;
    }
    // D1: any game created with AI enemies is server-driven -- the flag
    // rides the lobby jsonb (no schema migration) out on every
    // game-bearing response via GAME_COLUMNS. The boot token scopes it to
    // THIS process so shared-DB neighbor servers never race its AI turns;
    // the ON CONFLICT (name) resurrection replaces the whole lobby (token
    // included) with the fresh write.
    if (enemySlotsSafe > 0) {
      lobbyState = { ...lobbyState, aiDriver: "server", aiDriverToken: aiDriverBootToken() };
    }

    const game = await withTransaction(async (client) => {
      const r = await client.query<FullGameRow>(
        `INSERT INTO games (
            name, seed, hero_q, hero_r, enemy_positions,
            round, day, active_player_id, players, heroes, settlements,
            map_size, lobby
          ) VALUES (
            $1, $2, $3, $4, $5::jsonb,
            $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb,
            $12, $13::jsonb
          )
          ON CONFLICT (name) DO UPDATE
            SET seed = EXCLUDED.seed,
                hero_q = EXCLUDED.hero_q,
                hero_r = EXCLUDED.hero_r,
                enemy_positions = EXCLUDED.enemy_positions,
                round = EXCLUDED.round,
                day = EXCLUDED.day,
                active_player_id = EXCLUDED.active_player_id,
                players = EXCLUDED.players,
                heroes = EXCLUDED.heroes,
                settlements = EXCLUDED.settlements,
                map_size = EXCLUDED.map_size,
                lobby = EXCLUDED.lobby,
                updated_at = now()
          RETURNING ${GAME_COLUMNS}`,
        [
          name,
          seed,
          hero_q,
          hero_r,
          JSON.stringify(enemy_positions),
          initial.round,
          initial.day,
          initial.active_player_id,
          JSON.stringify(initial.players),
          JSON.stringify(initial.heroes),
          JSON.stringify(initial.settlements),
          storedMapSize,
          JSON.stringify(lobbyState),
        ]
      );
    const row = r.rows[0];
    await generateAndInsertTiles(client, row.id, row.seed, "upsert", storedMapSize as MapSize);
    return row;
  });
  // The recreation (ON CONFLICT (name)) may have flipped the aiDriver flag;
  // the commands route's cached ai-seat info must not outlive it.
  invalidateAiSeatCache(name);
  res.status(201).json(game);
  } catch (err) {
    console.error("[api] POST /games threw:", err);
    res.status(500).json({
      error: "internal",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

router.delete("/games/:name", async (req, res) => {
  const r = await pool.query("DELETE FROM games WHERE name = $1", [req.params.name]);
  if (r.rowCount === 0) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.status(204).end();
});

router.post("/games/:name/events", async (req, res) => {
  const { kind, payload = {} } = req.body ?? {};
  if (typeof kind !== "string" || !kind) {
    res.status(400).json({ error: "kind required" });
    return;
  }
  if (!/^[a-z0-9_]{1,64}$/.test(kind)) {
    res.status(400).json({ error: "invalid kind" });
    return;
  }
  const payloadJson = JSON.stringify(payload ?? {});
  if (payloadJson.length > 8192) {
    res.status(400).json({ error: "payload too large" });
    return;
  }
  const game = await pool.query<{ id: number }>(
    "SELECT id FROM games WHERE name = $1",
    [req.params.name]
  );
  if (game.rowCount === 0) {
    res.status(404).json({ error: "game not found" });
    return;
  }
  const r = await pool.query(
    "INSERT INTO game_events (game_id, kind, payload) VALUES ($1, $2, $3::jsonb) RETURNING id, kind, payload, created_at",
    [game.rows[0].id, kind, payloadJson]
  );
  res.status(201).json(r.rows[0]);
});

router.get("/games/:name/events", async (req, res) => {
  // ?after=<id> is the poll cursor (game_events.id, BIGSERIAL -- strictly
  // monotonic per row, so it doubles as a cursor with no separate seq
  // column needed; see server/migrations/010_event_seq.sql's header).
  // Defaults to 0 (the whole log) so existing callers with no cursor yet
  // keep working unchanged. Rejected outright rather than silently ignored
  // when present but not a valid non-negative integer, so a client bug
  // (e.g. passing NaN or a stringified object) surfaces immediately
  // instead of quietly refetching the entire log forever.
  const afterRaw = req.query.after;
  let after = 0;
  if (afterRaw !== undefined) {
    if (typeof afterRaw !== "string" || !/^\d+$/.test(afterRaw)) {
      res.status(400).json({ error: "invalid after cursor" });
      return;
    }
    after = Number(afterRaw);
  }
  const game = await pool.query<{ id: number }>(
    "SELECT id FROM games WHERE name = $1",
    [req.params.name]
  );
  if (game.rowCount === 0) {
    res.status(404).json({ error: "game not found" });
    return;
  }
  // A cursor past the end of the log is a normal "nothing new yet" poll
  // result, not an error -- returns an empty array, not a 404.
  // actor_seat is returned so the client can skip events its own commands
  // caused (it already applied them locally) -- the read half of #144's
  // column, which had a writer but no reader until this cursor sync.
  const r = await pool.query(ROWS_AFTER_SQL, [game.rows[0].id, after]);
  res.json(r.rows);
});

router.get("/games/:name/tiles", async (req, res) => {
  const game = await pool.query<{ id: number; seed: number; map_size: string }>(
    "SELECT id, seed, map_size FROM games WHERE name = $1",
    [req.params.name]
  );
  if (game.rowCount === 0) {
    res.status(404).json({ error: "game not found" });
    return;
  }
  const gameRow = game.rows[0];
  const count = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM tiles WHERE game_id = $1",
    [gameRow.id]
  );
  if (Number(count.rows[0].count) === 0) {
    const fallbackSize: MapSize = ["small", "medium", "large"].includes(gameRow.map_size)
      ? (gameRow.map_size as MapSize)
      : "small";
    await withTransaction((client) =>
      generateAndInsertTiles(client, gameRow.id, gameRow.seed, "skip", fallbackSize)
    );
  }
  const tiles = await pool.query<TileRow>(
    "SELECT q, r, terrain, resource FROM tiles WHERE game_id = $1 ORDER BY r ASC, q ASC",
    [gameRow.id]
  );
  res.json(tiles.rows);
});

// POST /games/:name/resolve-battle and POST /games/:name/trade were
// retired here (Phase 3 Track A Week 3+,
// plan/2026-08-16-phase-3-parallel-dev-plan.md) -- both are now
// ResolveBattle on the POST /games/:name/commands bus
// (server/http/routes/commands.ts, server/app/commandHandler.ts), the
// same cutover Week 2 already did for spend_movement/transfer/end-turn.
// POST /games/:name/end-turn was retired 2026-09-30 -- it was the
// client-supplied-state variant kept for stale LAN bundles after every
// repo caller moved to EndTurn on the POST /games/:name/commands bus,
// which recomputes the same pipeline server-side and writes the same
// settlement_snapshots / resource_transactions / turn-lifecycle audit
// rows; stale bundles POSTing here now get a 404 and must use the
// command bus.

