-- Manual battle action stream (plan/2026-09-27-manual-battle-wiring.md,
-- work item 4b). Every action played out in the manual arena is written
-- here as it happens, keyed to the battle it belongs to. v1 writes and
-- reads nothing back -- the future async legality-check consumer (same
-- plan, "Future work") re-simulates these rows against the recorded battle
-- state and writes violation records when an action couldn't have been
-- legal.
--
-- seq is the per-battle action ordinal (client-assigned, seed row = 0), so
-- (game_name, attacker_id, defender_id, seq) is the replay order for one
-- battle. phase is the arena-level action kind; payload is the full action
-- plus state context (round, time-of-day, acting slot, from/to or
-- attacker/target -- and for the seed row, obstacleSeed + initial stacks +
-- sides, which is what makes any future re-simulation possible).
--
-- game_name is stored directly (no games FK), telemetry-style: the arena
-- posts fire-and-forget and must never fail or block on game-row
-- bookkeeping, same posture as the presence/telemetry planes. seat is
-- stamped server-side from the session/claim where available and nullable
-- for anonymous callers (same convention as game_events.actor_seat,
-- migration 010).
CREATE TABLE IF NOT EXISTS battle_actions (
  id BIGSERIAL PRIMARY KEY,
  game_name TEXT NOT NULL,
  seat INTEGER,
  attacker_id TEXT NOT NULL,
  defender_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  phase TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS battle_actions_battle_idx
  ON battle_actions(game_name, attacker_id, defender_id, seq);
