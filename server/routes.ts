import { Router } from "express";
import { pool, withTransaction } from "./db";
import { GameMap } from "../src/map/gameMap";
import { mulberry32 } from "../src/core/rng";
import { makeInitialStatePayload } from "../src/game/initState";
import type { PoolClient } from "pg";
import type {
  GameState,
  HeroState,
  Player,
  SettlementState,
} from "../src/state/gameState";

export const router = Router();

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
  created_at: string;
  updated_at: string;
};

const GAME_COLUMNS =
  "id, name, seed, hero_q, hero_r, turn, gold, enemy_positions, round, day, active_player_id, players, heroes, settlements, created_at, updated_at";

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

function sumPlayerGold(players: Player[]): number {
  return players.reduce((acc, p) => acc + (Number.isFinite(p.gold) ? p.gold : 0), 0);
}

router.get("/health", async (_req, res) => {
  const r = await pool.query("SELECT 1 AS ok");
  res.json({ ok: r.rows[0].ok === 1 });
});

router.get("/games", async (_req, res) => {
  const r = await pool.query<FullGameRow>(
    `SELECT ${GAME_COLUMNS} FROM games ORDER BY id DESC`
  );
  res.json(r.rows);
});

router.get("/games/:name", async (req, res) => {
  const r = await pool.query<FullGameRow>(
    `SELECT ${GAME_COLUMNS} FROM games WHERE name = $1`,
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
    const map = new GameMap(seed);
    const initial = makeInitialStatePayload(map, mulberry32(seed ^ 0x706c6179));
    const game = await withTransaction(async (client) => {
      const r = await client.query<FullGameRow>(
        `INSERT INTO games (
            name, seed, hero_q, hero_r, enemy_positions,
            round, day, active_player_id, players, heroes, settlements
          ) VALUES (
            $1, $2, $3, $4, $5::jsonb,
            $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb
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
        ]
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
  const body = req.body ?? {};

  // New action: spend_movement
  if (body && body.action === "spend_movement") {
    const { heroId, fromTile, toTile, cost } = body;
    if (
      typeof heroId !== "string" ||
      !fromTile ||
      typeof fromTile.q !== "number" ||
      typeof fromTile.r !== "number" ||
      !toTile ||
      typeof toTile.q !== "number" ||
      typeof toTile.r !== "number" ||
      typeof cost !== "number"
    ) {
      res.status(400).json({ error: "invalid spend_movement payload" });
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
        const hero = row.heroes[heroId];
        if (!hero) return { status: 404 as const, error: "hero not found" };
        if (hero.q !== fromTile.q || hero.r !== fromTile.r) {
          return { status: 409 as const, error: "hero not at fromTile" };
        }
        // V1: human movement allowed any time; AI movement only during AI turn.
        const activePlayer = row.players.find((p) => p.id === row.active_player_id);
        if (hero.ownerId !== row.active_player_id && activePlayer?.faction === "ai") {
          return { status: 409 as const, error: "not AI turn" };
        }
        const updatedHero: HeroState = {
          ...hero,
          q: toTile.q,
          r: toTile.r,
          movementRemaining: hero.movementRemaining - cost,
        };
        const newHeroes = { ...row.heroes, [heroId]: updatedHero };
        const incomingSettlements = (body && typeof body === "object" && body.settlements) || null;
        const newSettlements = incomingSettlements ?? row.settlements;
        await client.query(
          `UPDATE games SET heroes = $1::jsonb, settlements = $2::jsonb, updated_at = now() WHERE id = $3`,
          [JSON.stringify(newHeroes), JSON.stringify(newSettlements), row.id]
        );
        await client.query(
          `INSERT INTO game_events (game_id, kind, payload) VALUES ($1, $2, $3::jsonb)`,
          [
            row.id,
            "move_completed",
            JSON.stringify({ heroId, fromTile, toTile, cost }),
          ]
        );
        return { status: 200 as const, hero: updatedHero };
      });
      if (result.status === 404) {
        if ("error" in result && result.error) {
          res.status(404).json({ error: result.error });
        } else {
          res.status(404).json({ error: "not found" });
        }
        return;
      }
      if (result.status === 409) {
        res.status(409).json({ error: result.error });
        return;
      }
      res.json(result.hero);
    } catch (err) {
      console.error("[api] PATCH /games/:name spend_movement threw:", err);
      res.status(500).json({
        error: "internal",
        message: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

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
  const r = await pool.query<GameRow>(
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
        heroIds: Array.isArray(p.heroIds) ? [...p.heroIds] : [],
        settlementIds: Array.isArray(p.settlementIds) ? [...p.settlementIds] : [],
        gold: Number.isFinite(p.gold) ? p.gold : 0,
      }));

      // Award gold based on each owned settlement's population × goldTax.
      // Use the DB row's gold as the authoritative base (incomingState.players may
      // already include a client-side mirror of this same income).
      const endingPlayer = players.find((p) => p.id === row.active_player_id);
      const dbEndingPlayer = row.players.find((p) => p.id === row.active_player_id);
      if (endingPlayer && dbEndingPlayer) {
        const goldEarned = Object.values(incomingState.settlements)
          .filter((s) => s.ownerId === endingPlayer.id)
          .reduce((acc, s) => acc + s.population * s.goldTax, 0);
        endingPlayer.gold = Number(dbEndingPlayer.gold) + goldEarned;
      }

      // Advance active_player_id; wrap when we go past the last player, incrementing round + day.
      const playerCount = players.length;
      const wrapped = playerCount > 0 && row.active_player_id + 1 >= playerCount;
      const nextActive = playerCount === 0 ? 0 : (row.active_player_id + 1) % playerCount;
      const newRound = wrapped ? row.round + 1 : row.round;
      const newDay = wrapped ? (incomingState.day ?? row.day) + 1 : (incomingState.day ?? row.day);

      // Legacy `gold` column is the sum of all players' gold (backward compat).
      const legacyGold = sumPlayerGold(players);

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
          JSON.stringify(incomingState.heroes),
          JSON.stringify(incomingState.settlements),
          legacyGold,
          row.id,
        ]
      );

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

router.post("/games/:name/resolve-battle", async (req, res) => {
  const body = req.body ?? {};
  const { attackerId, defenderId, state } = body;
  if (
    typeof attackerId !== "string" ||
    typeof defenderId !== "string" ||
    !state ||
    typeof state !== "object" ||
    !Array.isArray(state.players) ||
    typeof state.heroes !== "object"
  ) {
    res.status(400).json({ error: "invalid resolve-battle payload" });
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

      const attackersHero = row.heroes[attackerId];
      const defendersHero = row.heroes[defenderId];
      if (!attackersHero || !defendersHero) {
        return { status: 404 as const, error: "hero not found" };
      }

      const players: Player[] = (state.players as Player[]).map((p) => ({
        id: p.id,
        faction: p.faction,
        name: p.name,
        heroIds: Array.isArray(p.heroIds) ? [...p.heroIds] : [],
        settlementIds: Array.isArray(p.settlementIds) ? [...p.settlementIds] : [],
        gold: Number.isFinite(p.gold) ? p.gold : 0,
      }));
      const heroes: Record<string, HeroState> = { ...row.heroes };
      delete heroes[defenderId];

      // Remove defender from its owner's heroIds; award +50 gold to attacker's owner.
      for (const p of players) {
        if (p.id === defendersHero.ownerId) {
          p.heroIds = p.heroIds.filter((id) => id !== defenderId);
        }
        if (p.id === attackersHero.ownerId) {
          p.gold += 50;
        }
      }

      const legacyGold = sumPlayerGold(players);

      await client.query(
        `UPDATE games SET
           players = $1::jsonb,
           heroes = $2::jsonb,
           gold = $3,
           updated_at = now()
         WHERE id = $4`,
        [
          JSON.stringify(players),
          JSON.stringify(heroes),
          legacyGold,
          row.id,
        ]
      );

      await client.query(
        `INSERT INTO game_events (game_id, kind, payload) VALUES ($1, $2, $3::jsonb)`,
        [
          row.id,
          "combat_won",
          JSON.stringify({
            attackerId,
            defenderId,
            attackerOwnerId: attackersHero.ownerId,
            rewardGold: 50,
          }),
        ]
      );

      return {
        status: 200 as const,
        result: { players, heroes },
      };
    });

    if (result.status === 404) {
      if ("error" in result && result.error) {
        res.status(404).json({ error: result.error });
      } else {
        res.status(404).json({ error: "not found" });
      }
      return;
    }
    res.json(result.result);
  } catch (err) {
    console.error("[api] POST /games/:name/resolve-battle threw:", err);
    res.status(500).json({
      error: "internal",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});
