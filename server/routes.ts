import { Router } from "express";
import { pool, withTransaction } from "./db";
import { GameMap, type MapSize } from "@heroes/engine";
import { mulberry32 } from "@heroes/engine";
import { makeInitialStatePayload } from "../src/game/initState";
import { applyEndOfTurnDetailed } from "@heroes/engine";
import type { AutoTradeTransfer } from "@heroes/contracts";
import type { PoolClient } from "pg";
import type {
  GameState,
  HeroState,
  Player,
  SettlementState,
} from "../src/state/gameState";
import type { UnitType } from "@heroes/engine";
import { assetRouter } from "./assetRoutes";
import { authRouter } from "./auth";
import { validateGameRow, isHealthy } from "@heroes/engine";
import { commandsRouter } from "./http/routes/commands";
import { telemetryRouter } from "./http/routes/telemetry";

export const router = Router();

router.use("/assets", assetRouter);
router.use("/auth", authRouter);
router.use("/games/:name/commands", commandsRouter);
router.use("/games/:name/telemetry", telemetryRouter);

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
  claimed?: Record<string, { handle: string; claimedAt: string }>;
  startedAt?: string;
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

function sumPlayerGold(
  players: Player[],
  heroes: Record<string, HeroState>,
  settlements: Record<string, SettlementState>,
): number {
  let total = 0;
  const playerIds = new Set(players.map((p) => p.id));
  for (const h of Object.values(heroes)) {
    if (playerIds.has(h.ownerId) && Number.isFinite(h.gold)) total += h.gold;
  }
  for (const s of Object.values(settlements)) {
    if (s.ownerId !== null && playerIds.has(s.ownerId) && Number.isFinite(s.gold)) total += s.gold;
  }
  return total;
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
};

router.get("/units", async (_req, res) => {
  try {
    const r = await pool.query<UnitTypeRow>(
      `SELECT id, name, attack, defence, health, speed, description, advantage_type, specialty, specialty_priority
         FROM unit_types ORDER BY attack ASC, id ASC`
    );
    const units: UnitType[] = r.rows.map((row) => ({
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
    }));
    res.json(units);
  } catch (err) {
    console.error("[api] GET /units threw:", err);
    res.status(500).json({
      error: "internal",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

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

router.post("/games/:name/lobby/claim", async (req, res) => {
  const { seat, handle } = req.body ?? {};
  if (!Number.isInteger(seat) || typeof handle !== "string" || !handle.trim()) {
    res.status(400).json({ error: "seat (int) and handle (string) required" });
    return;
  }
  const cleanHandle = handle.trim().slice(0, 32);
  try {
    const result = await withTransaction(async (client) => {
      const gr = await client.query<FullGameRow>(
        `SELECT ${GAME_COLUMNS} FROM games WHERE name = $1`,
        [req.params.name]
      );
      if (gr.rowCount === 0) return { status: 404 as const };
      const row = gr.rows[0];
      if (row.lobby?.startedAt) {
        return { status: 409 as const, error: "lobby_already_started" };
      }
      const seats = row.lobby?.seats ?? row.players.length;
      if (seat < 0 || seat >= seats) {
        return { status: 400 as const, error: "seat_out_of_range" };
      }
      const claimed = { ...(row.lobby?.claimed ?? {}) };
      if (claimed[String(seat)]) {
        return { status: 409 as const, error: "seat_already_claimed" };
      }
      claimed[String(seat)] = { handle: cleanHandle, claimedAt: new Date().toISOString() };
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
    const initOpts =
      humanCount !== null
        ? { playerCount: humanCount, humanSeatCount: humanCount }
        : undefined;
    const initial = makeInitialStatePayload(map, mulberry32(seed ^ 0x706c6179), initOpts);

    let lobbyState: LobbyState = {};
    const explicitSeats =
      lobbyObj && Number.isInteger(lobbyObj.seats) ? (lobbyObj.seats as number) : null;
    const seats = explicitSeats ?? (humanCount !== null ? initial.players.length : null);
    if (seats !== null && seats >= 1 && humanCount !== null && humanCount >= 1 && humanCount <= seats) {
      lobbyState = { seats, humanSlots: humanCount, claimed: {} };
    }
    if (lobbyState.humanSlots !== undefined && lobbyState.humanSlots < 1) {
      res.status(400).json({ error: "humanSlots must be >= 1" });
      return;
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
    res.status(201).json(game);
  } catch (err) {
    console.error("[api] POST /games threw:", err);
    res.status(500).json({
      error: "internal",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

router.patch("/games/:name", async (req, res) => {
  const body = req.body ?? {};

  // Legacy patch behavior
  const { hero_q, hero_r, turn, gold, enemy_positions } = body;
  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  if (typeof hero_q === "number") {
    sets.push(`hero_q = $${i++}`);
    vals.push(hero_q);
  }
  if (typeof hero_r === "number") {
    sets.push(`hero_r = $${i++}`);
    vals.push(hero_r);
  }
  if (typeof turn === "number") {
    sets.push(`turn = $${i++}`);
    vals.push(turn);
  }
  if (typeof gold === "number") {
    sets.push(`gold = $${i++}`);
    vals.push(gold);
  }
  if (Array.isArray(enemy_positions)) {
    sets.push(`enemy_positions = $${i++}::jsonb`);
    vals.push(JSON.stringify(enemy_positions));
  }
  if (sets.length === 0) {
    res.status(400).json({ error: "nothing to update" });
    return;
  }
  sets.push("updated_at = now()");
  vals.push(req.params.name);
  const r = await pool.query<FullGameRow>(
    `UPDATE games SET ${sets.join(", ")} WHERE name = $${i}
     RETURNING ${GAME_COLUMNS}`,
    vals
  );
  if (r.rowCount === 0) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json(r.rows[0]);
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
  const game = await pool.query<{ id: number }>(
    "SELECT id FROM games WHERE name = $1",
    [req.params.name]
  );
  if (game.rowCount === 0) {
    res.status(404).json({ error: "game not found" });
    return;
  }
  const r = await pool.query(
    "INSERT INTO game_events (game_id, kind, payload) VALUES ($1, $2, $3) RETURNING id, kind, payload, created_at",
    [game.rows[0].id, kind, payload]
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
  const r = await pool.query(
    "SELECT id, kind, payload, actor_seat, created_at FROM game_events WHERE game_id = $1 AND id > $2 ORDER BY id ASC",
    [game.rows[0].id, after]
  );
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

router.post("/games/:name/end-turn", async (req, res) => {
  const body = req.body ?? {};
  const incomingState = body.state as GameState | undefined;
  if (
    !incomingState ||
    typeof incomingState !== "object" ||
    typeof incomingState.activePlayerId !== "number" ||
    !Array.isArray(incomingState.players) ||
    typeof incomingState.heroes !== "object" ||
    typeof incomingState.settlements !== "object"
  ) {
    res.status(400).json({ error: "state payload required" });
    return;
  }
  try {
    const result = await withTransaction(async (client) => {
      const gr = await client.query<FullGameRow>(
        `SELECT ${GAME_COLUMNS} FROM games WHERE name = $1`,
        [req.params.name]
      );
      if (gr.rowCount === 0) return { status: 404 as const };
      const row = gr.rows[0];

      if (incomingState.activePlayerId !== row.active_player_id) {
        return {
          status: 409 as const,
          error: "activePlayerId mismatch",
          serverActivePlayerId: row.active_player_id,
        };
      }

      const players: Player[] = incomingState.players.map((p) => ({
        id: p.id,
        faction: p.faction,
        name: p.name,
        color: p.color,
        heroIds: Array.isArray(p.heroIds) ? [...p.heroIds] : [],
        settlementIds: Array.isArray(p.settlementIds) ? [...p.settlementIds] : [],
      }));


      // Run the full per-day pipeline (produce -> auto-trade -> consume -> morale -> effective income).
      // The client computes this too; we re-run here so DB matches client state (drift-safe).
      const pipeline = applyEndOfTurnDetailed({
        ...incomingState,
        activePlayerId: row.active_player_id,
      } as GameState);
      const newSettlements: Record<string, SettlementState> = { ...pipeline.state.settlements };
      const transfers: AutoTradeTransfer[] = pipeline.transfers;
      // Advance active_player_id; wrap when we go past the last player, incrementing round + day.
      const playerCount = players.length;
      const wrapped = playerCount > 0 && row.active_player_id + 1 >= playerCount;
      const nextActive = playerCount === 0 ? 0 : (row.active_player_id + 1) % playerCount;
      const newRound = wrapped ? row.round + 1 : row.round;
      const newDay = wrapped ? (incomingState.day ?? row.day) + 1 : (incomingState.day ?? row.day);

      // Apply weekly upkeep when wrapping into a new round on a day divisible by 7.
      let workingHeroes: Record<string, HeroState> = incomingState.heroes;
      if (wrapped && newDay % 7 === 0) {
        const updated: Record<string, HeroState> = { ...incomingState.heroes };
        for (const [id, h] of Object.entries(incomingState.heroes)) {
          const cost = (h.troops ?? 1) * 1;
          if ((Number(h.gold) || 0) >= cost) {
            updated[id] = { ...h, gold: (Number(h.gold) || 0) - cost };
          } else {
            updated[id] = { ...h, gold: 0, troops: (Number(h.gold) || 0) };
          }
        }
        workingHeroes = updated;
      }

      // Legacy `gold` column is the sum of all players' purses (backward compat).
      const legacyGold = sumPlayerGold(players, incomingState.heroes, newSettlements);

      await client.query(
        `UPDATE games SET
           round = $1,
           day = $2,
           active_player_id = $3,
           players = $4::jsonb,
           heroes = $5::jsonb,
           settlements = $6::jsonb,
           gold = $7,
           updated_at = now()
         WHERE id = $8`,
        [
          newRound,
          newDay,
          nextActive,
          JSON.stringify(players),
          JSON.stringify(workingHeroes),
          JSON.stringify(newSettlements),
          legacyGold,
          row.id,
        ]
      );


      // Insert settlement_snapshots rows (one per settlement, for the new day).
      // Only snapshot settlements owned by the player whose turn just ended.
      const snapshotDay = wrapped ? newDay : (incomingState.day ?? row.day);
      for (const [sid, s] of Object.entries(newSettlements)) {
        if (s.ownerId !== row.active_player_id) continue;
        const inc = s.population * s.goldTax;
        const morale = Math.max(0, Math.min(100, Math.round(Number(s.morale ?? 100))));
        await client.query(
          `INSERT INTO settlement_snapshots
             (game_id, settlement_id, day, gold, warehouse, morale, effective_income)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
           ON CONFLICT (game_id, settlement_id, day) DO NOTHING`,
          [
            row.id,
            sid,
            snapshotDay,
            Number(s.gold ?? 0),
            JSON.stringify(s.warehouse ?? {}),
            morale,
            Math.round((inc * morale) / 100),
          ]
        );
      }

      // Log resource_transactions rows for any auto-trade transfers that fired.
      for (const t of transfers) {
        await client.query(
          `INSERT INTO resource_transactions
             (game_id, from_settlement_id, to_settlement_id, resource, amount, gold_paid, reason)
           VALUES ($1, $2, $3, $4, $5, $6, 'auto_trade')`,
          [
            row.id,
            t.fromSettlementId,
            t.toSettlementId,
            t.resource,
            t.amount,
            t.goldPaid,
          ]
        );
      }

      const events: Array<{ kind: string; payload: Record<string, unknown> }> = [
        {
          kind: "turn_ended",
          payload: {
            playerId: row.active_player_id,
            round: row.round,
          },
        },
      ];
      if (wrapped) {
        events.push({ kind: "round_ended", payload: { round: row.round } });
        events.push({ kind: "round_started", payload: { round: newRound } });
      }
      const nextPlayer = players.find((p) => p.id === nextActive);
      if (nextPlayer && nextPlayer.faction === "ai") {
        events.push({
          kind: "ai_turn_started",
          payload: { playerId: nextActive, round: newRound },
        });
      }
      for (const ev of events) {
        await client.query(
          `INSERT INTO game_events (game_id, kind, payload) VALUES ($1, $2, $3::jsonb)`,
          [row.id, ev.kind, JSON.stringify(ev.payload)]
        );
      }

      return {
        status: 200 as const,
        result: {
          round: newRound,
          day: newDay,
          activePlayerId: nextActive,
          players,
        },
      };
    });

    if (result.status === 404) {
      res.status(404).json({ error: "not found" });
      return;
    }
    if (result.status === 409) {
      res.status(409).json({
        error: result.error,
        serverActivePlayerId: result.serverActivePlayerId,
      });
      return;
    }
    res.json(result.result);
  } catch (err) {
    console.error("[api] POST /games/:name/end-turn threw:", err);
    res.status(500).json({
      error: "internal",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

// POST /games/:name/resolve-battle and POST /games/:name/trade were
// retired here (Phase 3 Track A Week 3+,
// plan/2026-08-16-phase-3-parallel-dev-plan.md) -- both are now
// ResolveBattle/TradeResources on the POST /games/:name/commands bus
// (server/http/routes/commands.ts, server/app/commandHandler.ts), the
// same cutover Week 2 already did for spend_movement/transfer/end-turn.

