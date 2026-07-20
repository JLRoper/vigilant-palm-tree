import { Router } from "express";
import { pool, withTransaction } from "./db";
import { GameMap } from "../src/map/gameMap";
import type { PoolClient } from "pg";

export const router = Router();

type EnemyPos = { q: number; r: number };
type GameRow = {
  id: number;
  name: string;
  seed: number;
  hero_q: number;
  hero_r: number;
  turn: number;
  gold: number;
  enemy_positions: EnemyPos[];
  created_at: string;
  updated_at: string;
};
type TileRow = {
  q: number;
  r: number;
  terrain: string;
  resource: string | null;
};

async function generateAndInsertTiles(
  client: PoolClient,
  gameId: number,
  seed: number,
  onConflict: "upsert" | "skip"
): Promise<void> {
  const map = new GameMap(seed);
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

router.get("/games", async (_req, res) => {
  const r = await pool.query<GameRow>(
    "SELECT id, name, seed, hero_q, hero_r, turn, gold, enemy_positions, created_at, updated_at FROM games ORDER BY id DESC"
  );
  res.json(r.rows);
});

router.get("/games/:name", async (req, res) => {
  const r = await pool.query<GameRow>(
    "SELECT id, name, seed, hero_q, hero_r, turn, gold, enemy_positions, created_at, updated_at FROM games WHERE name = $1",
    [req.params.name]
  );
  if (r.rowCount === 0) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json(r.rows[0]);
});

router.post("/games", async (req, res) => {
  try {
    const {
      name,
      seed = 42,
      hero_q = 2,
      hero_r = 2,
      enemy_positions = [],
    } = req.body ?? {};
    if (typeof name !== "string" || !name) {
      res.status(400).json({ error: "name required" });
      return;
    }
    console.log(`[api] POST /games name=${name} hero=(${hero_q},${hero_r})`);
    const game = await withTransaction(async (client) => {
      const r = await client.query<GameRow>(
        `INSERT INTO games (name, seed, hero_q, hero_r, enemy_positions)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         ON CONFLICT (name) DO UPDATE
           SET seed = EXCLUDED.seed,
               hero_q = EXCLUDED.hero_q,
               hero_r = EXCLUDED.hero_r,
               enemy_positions = EXCLUDED.enemy_positions,
               updated_at = now()
         RETURNING id, name, seed, hero_q, hero_r, turn, gold, enemy_positions, created_at, updated_at`,
        [name, seed, hero_q, hero_r, JSON.stringify(enemy_positions)]
      );
      const row = r.rows[0];
      await generateAndInsertTiles(client, row.id, row.seed, "upsert");
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
  const { hero_q, hero_r, turn, gold, enemy_positions } = req.body ?? {};
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
  const r = await pool.query<GameRow>(
    `UPDATE games SET ${sets.join(", ")} WHERE name = $${i}
     RETURNING id, name, seed, hero_q, hero_r, turn, gold, enemy_positions, created_at, updated_at`,
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
  const game = await pool.query<{ id: number }>(
    "SELECT id FROM games WHERE name = $1",
    [req.params.name]
  );
  if (game.rowCount === 0) {
    res.status(404).json({ error: "game not found" });
    return;
  }
  const r = await pool.query(
    "SELECT id, kind, payload, created_at FROM game_events WHERE game_id = $1 ORDER BY id ASC",
    [game.rows[0].id]
  );
  res.json(r.rows);
});

router.get("/games/:name/tiles", async (req, res) => {
  const game = await pool.query<{ id: number; seed: number }>(
    "SELECT id, seed FROM games WHERE name = $1",
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
    await withTransaction((client) =>
      generateAndInsertTiles(client, gameRow.id, gameRow.seed, "skip")
    );
  }
  const tiles = await pool.query<TileRow>(
    "SELECT q, r, terrain, resource FROM tiles WHERE game_id = $1 ORDER BY r ASC, q ASC",
    [gameRow.id]
  );
  res.json(tiles.rows);
});
