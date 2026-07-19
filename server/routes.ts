import { Router } from "express";
import { pool } from "./db";

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
  const r = await pool.query<GameRow>(
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
  res.status(201).json(r.rows[0]);
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
