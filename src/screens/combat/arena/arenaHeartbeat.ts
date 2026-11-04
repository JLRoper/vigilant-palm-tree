// The arena's liveness row (the reader's card, half one): while the manual
// arena is open the client re-posts a battle_actions row for the pair on a
// timer, so the server's AI driver can tell a fight that is still being
// played from a browser that is genuinely gone. server/app/aiDriver.ts's
// AI_DEFENDER_WAIT_TIMEOUT_MS is an IDLE window measured from the newest row
// for the pair, so the heartbeat is what keeps an actively fought battle open
// past 300s -- and its absence (a closed tab, a dead browser) is what lets
// the deadline still fire.
//
// Kept as its own tiny module so the cadence and the stop contract are
// testable without a DOM (test/screens/combat/arenaHeartbeat.test.ts).
export const ARENA_HEARTBEAT_INTERVAL_MS = 30_000;

export interface ArenaHeartbeatTimers {
  setInterval(fn: () => void, ms: number): number;
  clearInterval(handle: number): void;
}

export interface ArenaHeartbeatOptions {
  intervalMs?: number;
  /** Test seams: the clock the payload carries, and the timer pair. */
  now?: () => number;
  timers?: ArenaHeartbeatTimers;
}

/**
 * Posts one heartbeat row per interval until the returned stop() runs. The
 * post is fire-and-forget by contract (the same telemetry posture as every
 * other arena row): a dropped heartbeat must never disturb the fight.
 */
export function startArenaHeartbeat(
  post: (nowMs: number) => void,
  opts: ArenaHeartbeatOptions = {},
): () => void {
  const now = opts.now ?? (() => Date.now());
  const timers: ArenaHeartbeatTimers = opts.timers ?? {
    setInterval: (fn: () => void, ms: number) => globalThis.setInterval(fn, ms) as unknown as number,
    clearInterval: (handle: number) => globalThis.clearInterval(handle),
  };
  const handle = timers.setInterval(() => {
    post(now());
  }, opts.intervalMs ?? ARENA_HEARTBEAT_INTERVAL_MS);
  return () => timers.clearInterval(handle);
}
