import { Router, type Request } from "express";
import { pool } from "../../persistence/db";
import { attachAuth } from "../../auth";
import { attachPlayerSeat } from "../../middleware/attachPlayerSeat";

// POST /api/games/:name/battle-actions -- the manual arena's live action
// stream (plan/2026-09-27-manual-battle-wiring.md, work item 4b). Telemetry
// posture end to end: the client posts fire-and-forget and swallows every
// failure (a dropped row must never block or fail the arena), so this route
// is deliberately plain -- validate the row shape, stamp the seat from the
// session/claim where available, insert, ack. No game-row lookup, no
// transaction, no validation of the action's legality: v1 writes the table
// and leaves the reading/re-simulating to the future consumer (same plan,
// "Future work").
//
// { mergeParams: true } for :name, same as commandsRouter/telemetryRouter --
// see commands.ts's header for why a child router silently loses the
// parent's params without it.
export const battleActionsRouter = Router({ mergeParams: true });

// Same optional-identity wiring the commands route uses: req.playerSeat is
// only set when the caller is signed in AND has claimed a seat in this game;
// anonymous callers insert with seat NULL (migration 012's convention,
// matching game_events.actor_seat).
battleActionsRouter.use(attachAuth, attachPlayerSeat);

// The arena-level action kinds. Mirrors the plan's phase enum; the seed row
// ("start") and the terminal row ("end") are posted by the arena itself,
// move/attack/retreat/surrender come from the arena/state.ts action sites.
const VALID_PHASES = ["start", "move", "attack", "retreat", "surrender", "end"] as const;

function parseBattleAction(
  body: unknown,
): { attackerId: string; defenderId: string; seq: number; phase: (typeof VALID_PHASES)[number]; payload: unknown } | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.attackerId !== "string" || b.attackerId.length === 0) return null;
  if (typeof b.defenderId !== "string" || b.defenderId.length === 0) return null;
  if (typeof b.seq !== "number" || !Number.isInteger(b.seq) || b.seq < 0) return null;
  if (typeof b.phase !== "string" || !VALID_PHASES.includes(b.phase as (typeof VALID_PHASES)[number])) {
    return null;
  }
  // payload is free-form jsonb by design (full action + state context); it
  // only has to be an object so the column always holds a JSON document.
  if (!b.payload || typeof b.payload !== "object" || Array.isArray(b.payload)) return null;
  return {
    attackerId: b.attackerId,
    defenderId: b.defenderId,
    seq: b.seq,
    phase: b.phase as (typeof VALID_PHASES)[number],
    payload: b.payload,
  };
}

battleActionsRouter.post("/", async (req: Request<{ name: string }>, res) => {
  const action = parseBattleAction(req.body);
  if (!action) {
    res.status(400).json({ error: "invalid battle action" });
    return;
  }
  try {
    await pool.query(
      `INSERT INTO battle_actions (game_name, seat, attacker_id, defender_id, seq, phase, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        req.params.name,
        req.playerSeat ?? null,
        action.attackerId,
        action.defenderId,
        action.seq,
        action.phase,
        JSON.stringify(action.payload),
      ],
    );
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error("[api] POST /games/:name/battle-actions threw:", err);
    res.status(500).json({
      error: "internal",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});
