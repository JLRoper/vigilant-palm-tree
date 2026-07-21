import { Router } from "express";
import { pool, withTransaction } from "./db";
import { GameMap } from "../src/map/gameMap";
import { mulberry32 } from "../src/core/rng";
import { makeInitialStatePayload } from "../src/game/initState";
import { tradeResources as tradeResourcesReducer } from "../src/state/gameState";
import type { PoolClient } from "pg";
import type {
  GameState,
  HeroState,
  Player,
  SettlementState,
  WarehouseResource,
} from "../src/state/gameState";
import type { UnitType } from "../src/state/units";

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

router.get("/units", async (_req, res) => {
  try {
    const r = await pool.query<UnitType>(
      `SELECT id, name, attack, defence, health, speed, description FROM unit_types ORDER BY attack ASC, id ASC`
    );
    res.json(r.rows);
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
      }));

      // Award gold into each owned settlement's treasury based on population × goldTax.
      // Income stays at the settlement — never auto-routes to a hero.
      // Also accumulate resource production into each settlement's warehouse.
      const newSettlements: Record<string, SettlementState> = {};
      for (const [id, s] of Object.entries(incomingState.settlements)) {
        const baseGold = s.ownerId === row.active_player_id
          ? (Number(s.gold) || 0) + s.population * s.goldTax
          : (Number(s.gold) || 0);
        const newWarehouse = { ...(s.warehouse ?? { wood: 0, stone: 0, iron: 0, arcane: 0 }) };
        for (const r of ["wood", "stone", "iron", "arcane"] as const) {
          const rate = s.resourceRates?.[r] ?? 0;
          if (rate > 0) newWarehouse[r] = (newWarehouse[r] ?? 0) + rate;
        }
        newSettlements[id] = { ...s, gold: baseGold, warehouse: newWarehouse };
      }

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
      }));
      const heroes: Record<string, HeroState> = { ...row.heroes };
      const lootedGold = Number(defendersHero.gold) || 0;
      if (heroes[attackerId]) {
        heroes[attackerId] = {
          ...heroes[attackerId],
          gold: (Number(heroes[attackerId].gold) || 0) + lootedGold,
        };
      }
      delete heroes[defenderId];

      // Remove defender from its owner's heroIds. Gold transfer happens via heroes JSONB above.
      for (const p of players) {
        if (p.id === defendersHero.ownerId) {
          p.heroIds = p.heroIds.filter((id) => id !== defenderId);
        }
      }

      const legacyGold = sumPlayerGold(players, heroes, row.settlements);

      await client.query(
        `UPDATE games SET
           players = $1::jsonb,
           heroes = $2::jsonb,
           settlements = $3::jsonb,
           gold = $4,
           updated_at = now()
         WHERE id = $5`,
        [
          JSON.stringify(players),
          JSON.stringify(heroes),
          JSON.stringify(row.settlements),
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
            rewardGold: lootedGold,
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

router.post("/games/:name/transfer", async (req, res) => {
  const body = req.body ?? {};
  const { heroId, settlementId, direction } = body;
  if (
    typeof heroId !== "string" ||
    typeof settlementId !== "string" ||
    (direction !== "deposit" && direction !== "withdraw")
  ) {
    res.status(400).json({ error: "invalid transfer payload" });
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
      const settlement = row.settlements[settlementId];
      if (!hero) return { status: 404 as const, error: "hero not found" };
      if (!settlement) return { status: 404 as const, error: "settlement not found" };
      if (hero.q !== settlement.q || hero.r !== settlement.r) {
        return { status: 409 as const, error: "hero_not_at_settlement" };
      }
      if (settlement.ownerId === null || settlement.ownerId !== hero.ownerId) {
        return { status: 409 as const, error: "not_owned_settlement" };
      }

      const amount =
        direction === "deposit"
          ? Number(hero.gold) || 0
          : Number(settlement.gold) || 0;
      if (amount <= 0) {
        return { status: 409 as const, error: "nothing_to_transfer" };
      }

      const newHeroes: Record<string, HeroState> = {
        ...row.heroes,
        [heroId]: direction === "deposit"
          ? { ...hero, gold: 0 }
          : { ...hero, gold: (Number(hero.gold) || 0) + amount },
      };
      const newSettlements: Record<string, SettlementState> = {
        ...row.settlements,
        [settlementId]: direction === "withdraw"
          ? { ...settlement, gold: 0 }
          : { ...settlement, gold: (Number(settlement.gold) || 0) + amount },
      };

      const players: Player[] = row.players.map((p) => ({
        id: p.id,
        faction: p.faction,
        name: p.name,
        heroIds: Array.isArray(p.heroIds) ? [...p.heroIds] : [],
        settlementIds: Array.isArray(p.settlementIds) ? [...p.settlementIds] : [],
      }));
      const legacyGold = sumPlayerGold(players, newHeroes, newSettlements);

      await client.query(
        `UPDATE games SET
           players = $1::jsonb,
           heroes = $2::jsonb,
           settlements = $3::jsonb,
           gold = $4,
           updated_at = now()
         WHERE id = $5`,
        [
          JSON.stringify(players),
          JSON.stringify(newHeroes),
          JSON.stringify(newSettlements),
          legacyGold,
          row.id,
        ]
      );

      await client.query(
        `INSERT INTO game_events (game_id, kind, payload) VALUES ($1, $2, $3::jsonb)`,
        [
          row.id,
          "transfer_gold",
          JSON.stringify({ heroId, settlementId, direction, amount }),
        ]
      );

      return {
        status: 200 as const,
        result: {
          hero: newHeroes[heroId],
          settlement: newSettlements[settlementId],
        },
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
    if (result.status === 409) {
      res.status(409).json({ error: result.error });
      return;
    }
    res.json(result.result);
  } catch (err) {
    console.error("[api] POST /games/:name/transfer threw:", err);
    res.status(500).json({
      error: "internal",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

router.post("/games/:name/trade", async (req, res) => {
  const body = req.body ?? {};
  const { fromSettlementId, toSettlementId, resource, amount } = body;
  const VALID_RESOURCES: WarehouseResource[] = ["wood", "stone", "iron", "arcane"];
  if (
    typeof fromSettlementId !== "string" ||
    typeof toSettlementId !== "string" ||
    typeof resource !== "string" ||
    !VALID_RESOURCES.includes(resource as WarehouseResource) ||
    typeof amount !== "number" ||
    !Number.isInteger(amount) ||
    amount <= 0
  ) {
    res.status(400).json({ error: "invalid trade payload" });
    return;
  }
  try {
    const result = await withTransaction(async (client) => {
      const gr = await client.query<FullGameRow>(
        `SELECT ${GAME_COLUMNS} FROM games WHERE name = $1`,
        [req.params.name]
      );
      if (gr.rowCount === 0) return { status: 404 as const, error: "game not found" };
      const row = gr.rows[0];

      const tradeResult = tradeResourcesReducer(
        { ...row, dirty: false } as GameState,
        fromSettlementId,
        toSettlementId,
        resource as WarehouseResource,
        amount,
      );
      if (!tradeResult.ok) {
        return { status: 409 as const, error: tradeResult.reason };
      }

      const newSettlements = tradeResult.state.settlements;
      const legacyGold = sumPlayerGold(row.players, row.heroes, newSettlements);

      await client.query(
        `UPDATE games SET
           settlements = $1::jsonb,
           gold = $2,
           updated_at = now()
         WHERE id = $3`,
        [
          JSON.stringify(newSettlements),
          legacyGold,
          row.id,
        ]
      );

      await client.query(
        `INSERT INTO game_events (game_id, kind, payload) VALUES ($1, $2, $3::jsonb)`,
        [
          row.id,
          "resources_traded",
          JSON.stringify({ fromSettlementId, toSettlementId, resource, amount }),
        ]
      );

      return {
        status: 200 as const,
        result: {
          from: newSettlements[fromSettlementId],
          to: newSettlements[toSettlementId],
        },
      };
    });

    if (result.status === 404) {
      res.status(404).json({ error: result.error });
      return;
    }
    if (result.status === 409) {
      res.status(409).json({ error: result.error });
      return;
    }
    res.json(result.result);
  } catch (err) {
    console.error("[api] POST /games/:name/trade threw:", err);
    res.status(500).json({
      error: "internal",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});
