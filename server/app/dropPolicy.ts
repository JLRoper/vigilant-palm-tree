import type { GamePhase } from "@heroes/contracts";
import { pool } from "../persistence/db";
import { hydrateGame } from "../persistence/hydrate";
import {
  createLiveCommandDeps,
  runServerEndTurnForSeat,
  type LiveCommandDeps,
} from "./commandHandler";

// Enforcement-grade seat presence + the server-side turn-skip timer
// (docs/multiplayer.md, "Drop policy" -- decided 2026-09-27, shipped
// 2026-09-27). Two-tier policy for LAN games:
//
//   1. A seat whose client stops reporting (per-poll telemetry reports +
//      commands both count as heartbeats) is marked DISCONNECTED after
//      DISCONNECT_AFTER_MS of silence. The marking is flushed into the
//      games row's `lobby` jsonb (LobbyState.presence) so every client
//      learns it from the existing GET /games/:name read; the per-poll
//      POST /games/:name/telemetry response also carries the live
//      in-memory view.
//   2. If the disconnected seat holds the active turn, a SKIP_GRACE_MS
//      grace timer starts; on expiry the SERVER auto-EndTurns for that
//      seat via runServerEndTurnForSeat (same pipeline as the seat's own
//      EndTurn command). Any heartbeat or valid command from the seat
//      cancels the timer. While the game's phase is BATTLE the skip
//      holds -- it re-checks on a short interval and only fires once the
//      phase resolves. The skip never cancels a move or resolves a
//      battle; it is exactly one EndTurn.
//
// This module is the single home for the two policy constants; they are
// server-enforced, not per-lobby configurable (locked decision 3).
//
// Relationship to server/telemetry/presenceRegistry.ts: that registry is
// the dev Network Map's ephemeral debug view (~6s freshness, never
// persisted, never touches games). This module is the enforcement-grade
// counterpart: per-seat last-seen with 60s detection, transition-driven
// flushes into the games row, and the skip-timer lifecycle. They run
// side by side off the same POST /telemetry call without either
// depending on the other.
//
// Restart semantics (locked decision 2): everything here is in-process.
// An API restart mid-grace restarts the grace clock -- worst case is a
// longer wait, never a wrong action. Restart correctness for the
// presence *display* is preserved by seeding each game's in-memory map
// from the row's persisted presence the first time any seat of that game
// is touched in this process, so a seat that was already disconnected
// before the restart stays disconnected (and skippable) instead of
// silently resurrecting to "connected forever".

/** A seat is marked disconnected after this long without a heartbeat. */
export const DISCONNECT_AFTER_MS = 60_000;

/** After disconnection, a disconnected seat holding the active turn gets this long before the server skips it. */
export const SKIP_GRACE_MS = 120_000;

/** Scanner cadence: how often disconnected seats / due skips are re-examined. */
const DEFAULT_SCAN_INTERVAL_MS = 5_000;

/** While phase.kind === "BATTLE" holds a due skip, this is the re-check cadence. */
const DEFAULT_BATTLE_RECHECK_MS = 5_000;

/** Wire shape of one seat's presence, as stored in lobby.presence and returned by the telemetry POST. */
export interface SeatPresenceReport {
  /** Server-side epoch ms of the last heartbeat, ISO-8601 encoded. */
  lastSeenAt: string;
  connected: boolean;
}

interface SeatPresenceEntry {
  /** Epoch ms (raw clock), converted to ISO only at the wire. */
  lastSeenAt: number;
  connected: boolean;
}

// gameName -> seat -> entry. In-process truth; the games row only ever
// sees transition-driven flushes (see writeSeatPresence), never the 2s
// heartbeat cadence.
const presence = new Map<string, Map<number, SeatPresenceEntry>>();

// One pending grace/battle-recheck timer per game+seat. Keyed
// "gameName:seat" -- multiple concurrent games each get their own entries,
// and a seat re disconnecting after a canceled timer simply re-schedules
// on the next scan.
type SkipTimerKind = "grace" | "battle-recheck";
interface SkipTimer {
  timer: ReturnType<typeof setTimeout>;
  kind: SkipTimerKind;
}
const skipTimers = new Map<string, SkipTimer>();

interface ResolvedConfig {
  disconnectAfterMs: number;
  skipGraceMs: number;
  battleRecheckMs: number;
  scanIntervalMs: number;
  now: () => number;
  // Test seams. Production defaults: hydrate the row and read its phase;
  // run the full commandHandler EndTurn pipeline. Tests override these to
  // drive the BATTLE hold and observe the skip without the live pipeline
  // (same injectable-clock spirit as presenceRegistry's SnapshotOptions.now).
  loadPhaseKind: (gameName: string) => Promise<GamePhase["kind"]>;
  runEndTurn: (gameName: string, seat: number) => Promise<void>;
}

async function defaultLoadPhaseKind(gameName: string): Promise<GamePhase["kind"]> {
  const { state } = await hydrateGame(pool, gameName);
  return state.phase.kind;
}

// Memoized once-per-process live deps for the skip's EndTurn, mirroring
// server/http/routes/commands.ts's own lazy-memoize-on-first-use pattern
// (createLiveCommandDeps is async and pre-reads unit_types).
let liveDepsPromise: Promise<LiveCommandDeps> | null = null;
function getLiveDeps(): Promise<LiveCommandDeps> {
  if (!liveDepsPromise) {
    liveDepsPromise = createLiveCommandDeps().catch((err) => {
      liveDepsPromise = null;
      throw err;
    });
  }
  return liveDepsPromise;
}

async function defaultRunEndTurn(gameName: string, seat: number): Promise<void> {
  const deps = await getLiveDeps();
  const result = await runServerEndTurnForSeat(gameName, seat, deps);
  if (!result.ok) {
    throw new Error(`server EndTurn rejected: ${result.reason ?? "unknown"}`);
  }
}

function resolveConfig(): ResolvedConfig {
  return {
    disconnectAfterMs: DISCONNECT_AFTER_MS,
    skipGraceMs: SKIP_GRACE_MS,
    battleRecheckMs: DEFAULT_BATTLE_RECHECK_MS,
    scanIntervalMs: DEFAULT_SCAN_INTERVAL_MS,
    now: () => Date.now(),
    loadPhaseKind: defaultLoadPhaseKind,
    runEndTurn: defaultRunEndTurn,
  };
}

let cfg: ResolvedConfig = resolveConfig();

export interface DropPolicyOptions {
  disconnectAfterMs?: number;
  skipGraceMs?: number;
  battleRecheckMs?: number;
  scanIntervalMs?: number;
  now?: () => number;
  loadPhaseKind?: (gameName: string) => Promise<GamePhase["kind"]>;
  runEndTurn?: (gameName: string, seat: number) => Promise<void>;
}

/** Test/timing seam: override any of the clocks, delays, or pipeline hooks. */
export function configureDropPolicy(options: DropPolicyOptions): void {
  cfg = { ...cfg, ...options };
}

/** Test/dev hook: clear all timers + in-memory state and restore defaults. Never called by request handling. */
export function resetDropPolicy(): void {
  for (const entry of skipTimers.values()) clearTimeout(entry.timer);
  skipTimers.clear();
  presence.clear();
  seededGames.clear();
  seedsInFlight.clear();
  pendingPresenceWrites.clear();
  cfg = resolveConfig();
}

// ---------------------------------------------------------------------------
// Heartbeats + presence map
// ---------------------------------------------------------------------------

// First-touch seeding (see module header): one lazy read of the row's
// persisted presence per game per process, so a pre-restart disconnect
// survives the restart instead of silently becoming "unknown".
const seededGames = new Set<string>();
const seedsInFlight = new Map<string, Promise<void>>();

function ensureSeeded(gameName: string): void {
  if (seededGames.has(gameName) || seedsInFlight.has(gameName)) return;
  const seed = (async () => {
    try {
      const r = await pool.query<{ presence: Record<string, SeatPresenceReport> | null }>(
        `SELECT lobby->'presence' AS presence FROM games WHERE name = $1`,
        [gameName],
      );
      // A row that doesn't exist is a stable answer, not a retry condition
      // (the telemetry route records reports for unknown games by design).
      if (r.rowCount === 0) {
        seededGames.add(gameName);
        return;
      }
      const seats = presence.get(gameName) ?? new Map<number, SeatPresenceEntry>();
      for (const [seatKey, report] of Object.entries(r.rows[0].presence ?? {})) {
        const seat = Number(seatKey);
        if (!Number.isInteger(seat) || seat < 0) continue;
        const seenAt = Date.parse(report.lastSeenAt);
        const existing = seats.get(seat);
        if (!existing) {
          seats.set(seat, {
            lastSeenAt: Number.isFinite(seenAt) ? seenAt : 0,
            connected: report.connected === true,
          });
        } else if (existing.connected && report.connected === false) {
          // Lost race: this seat already reported alive in this process
          // before the seed read the row. The row's stale "disconnected"
          // (pre-restart truth) must not outlive the fresher memory --
          // flush the reconnect transition the seed raced with.
          trackPresenceWrite(writeSeatPresence(gameName, seat, existing));
        }
      }
      presence.set(gameName, seats);
      seededGames.add(gameName);
    } catch (err) {
      // Best-effort: leave unseeded so a later touch retries.
      console.warn("[presence] seed from games row failed:", err);
    } finally {
      seedsInFlight.delete(gameName);
    }
  })();
  seedsInFlight.set(gameName, seed);
}

/**
 * Records a heartbeat from a seat (telemetry report or valid command) and,
 * when it transitions a previously-disconnected seat back to connected,
 * cancels that seat's pending skip timer and flushes the cleared
 * disconnect to the games row. Synchronous and never throws -- callers are
 * request paths; the row write rides behind them fire-and-forget.
 */
export function touchSeat(gameName: string, seat: number): void {
  if (!Number.isInteger(seat) || seat < 0) return;
  ensureSeeded(gameName);
  const now = cfg.now();
  let seats = presence.get(gameName);
  if (!seats) {
    seats = new Map<number, SeatPresenceEntry>();
    presence.set(gameName, seats);
  }
  const entry = seats.get(seat);
  if (!entry) {
    // First sight in this process: connected, no transition to flush yet
    // (absence in the row already reads as "nothing to flag" for clients).
    seats.set(seat, { lastSeenAt: now, connected: true });
    return;
  }
  const wasConnected = entry.connected;
  entry.lastSeenAt = now;
  entry.connected = true;
  if (!wasConnected) {
    cancelSkipTimer(gameName, seat);
    trackPresenceWrite(writeSeatPresence(gameName, seat, entry));
  }
}

/** Current in-memory presence for one game, in the wire shape (ISO timestamps). */
export function getPresence(gameName: string): Record<string, SeatPresenceReport> {
  const out: Record<string, SeatPresenceReport> = {};
  for (const [seat, entry] of presence.get(gameName) ?? []) {
    out[String(seat)] = {
      lastSeenAt: new Date(entry.lastSeenAt).toISOString(),
      connected: entry.connected,
    };
  }
  return out;
}

// Row writes are transition-driven only -- a 2s heartbeat cadence must
// never touch the games row (locked decision 1). Writes are tracked so
// tests (and scanOnce) can drain them deterministically.
const pendingPresenceWrites = new Set<Promise<void>>();

function trackPresenceWrite(p: Promise<void>): void {
  pendingPresenceWrites.add(p);
  void p.catch(() => {}).finally(() => pendingPresenceWrites.delete(p));
}

/** Test hook: resolves once every pending presence row-write has settled. */
export function drainPresenceWrites(): Promise<void> {
  return Promise.all([...pendingPresenceWrites]).then(() => {});
}

async function writeSeatPresence(gameName: string, seat: number, entry: SeatPresenceEntry): Promise<void> {
  const report: SeatPresenceReport = {
    lastSeenAt: new Date(entry.lastSeenAt).toISOString(),
    connected: entry.connected,
  };
  try {
    // Atomic single-statement merge, not read-modify-write: the lobby column
    // has concurrent writers (claim/start routes, command transactions), and
    // one targeted update must never clobber a claim written in between --
    // nor a sibling seat's presence entry. jsonb_set is deliberately used at
    // DEPTH ONE only: it cannot create intermediate objects, so a depth-two
    // path like {presence,<seat>} silently no-ops until some other writer
    // happens to create lobby.presence (verified against PG 16 in dev).
    // Instead, the whole seat entry is merged into the existing presence map
    // via `||` (last-writer-wins per seat, which is exactly the semantics we
    // want), and jsonb_set's depth-one write creates the `presence` key when
    // it doesn't exist yet.
    await pool.query(
      `UPDATE games
          SET lobby = jsonb_set(
                COALESCE(lobby, '{}'::jsonb),
                '{presence}',
                COALESCE(lobby->'presence', '{}'::jsonb) || jsonb_build_object($2::text, $3::jsonb)
              ),
              updated_at = now()
        WHERE name = $1`,
      [gameName, String(seat), JSON.stringify(report)],
    );
  } catch (err) {
    console.warn("[presence] failed to flush seat presence to games row:", err);
  }
}

// ---------------------------------------------------------------------------
// Skip timers
// ---------------------------------------------------------------------------

function timerKey(gameName: string, seat: number): string {
  return `${gameName}:${seat}`;
}

function cancelSkipTimer(gameName: string, seat: number): void {
  const key = timerKey(gameName, seat);
  const entry = skipTimers.get(key);
  if (entry) {
    clearTimeout(entry.timer);
    skipTimers.delete(key);
  }
}

function cancelGameTimers(gameName: string): void {
  const prefix = `${gameName}:`;
  for (const [key, entry] of skipTimers) {
    if (key.startsWith(prefix)) {
      clearTimeout(entry.timer);
      skipTimers.delete(key);
    }
  }
}

function scheduleSkipTimer(gameName: string, seat: number, delayMs: number, kind: SkipTimerKind): void {
  cancelSkipTimer(gameName, seat);
  const timer = setTimeout(() => {
    skipTimers.delete(timerKey(gameName, seat));
    void enforceSkipForSeat(gameName, seat).catch((err) =>
      console.error("[dropPolicy] skip enforcement threw:", err),
    );
  }, delayMs);
  // unref: a pending skip must never keep the process (or a test run)
  // alive on its own.
  timer.unref?.();
  skipTimers.set(timerKey(gameName, seat), { timer, kind });
}

export type SkipOutcome =
  | "skipped"
  | "deferred_battle"
  | "canceled_not_active"
  | "canceled_reconnected"
  | "game_gone"
  | "failed";

/**
 * Fires a due skip for one seat: re-validates every precondition against
 * the live row and in-memory presence (the timer may be stale -- the seat
 * may have reconnected without the cancel having landed, or the turn may
 * have moved on), holds while the phase is BATTLE (re-check scheduled),
 * and otherwise runs the server EndTurn through the standard pipeline.
 */
export async function enforceSkipForSeat(gameName: string, seat: number): Promise<SkipOutcome> {
  let row: { active_player_id: number } | null = null;
  try {
    const r = await pool.query<{ active_player_id: number }>(
      `SELECT active_player_id FROM games WHERE name = $1`,
      [gameName],
    );
    row = r.rows[0] ?? null;
  } catch (err) {
    console.error("[dropPolicy] skip pre-check failed to read game:", err);
    return "failed";
  }
  if (!row) {
    presence.delete(gameName);
    cancelGameTimers(gameName);
    return "game_gone";
  }
  if (row.active_player_id !== seat) {
    return "canceled_not_active";
  }
  const entry = presence.get(gameName)?.get(seat);
  if (entry?.connected) {
    // The seat is alive again; touchSeat's own cancel either already ran
    // or is about to. Never skip a seat that is reporting.
    return "canceled_reconnected";
  }
  // BATTLE interlock (locked decision 1): hold while a battle is live and
  // re-check on a short interval -- never cancel a move or resolve a
  // battle the player didn't see. When the phase resolves, the next
  // re-check fires the ordinary EndTurn.
  let phaseKind: GamePhase["kind"];
  try {
    phaseKind = await cfg.loadPhaseKind(gameName);
  } catch (err) {
    console.error("[dropPolicy] skip pre-check failed to read phase:", err);
    return "failed";
  }
  if (phaseKind === "BATTLE") {
    scheduleSkipTimer(gameName, seat, cfg.battleRecheckMs, "battle-recheck");
    return "deferred_battle";
  }
  try {
    await cfg.runEndTurn(gameName, seat);
  } catch (err) {
    console.error(`[dropPolicy] server EndTurn for seat ${seat} in "${gameName}" failed:`, err);
    return "failed";
  }
  console.info(
    `[dropPolicy] seat ${seat} in "${gameName}" was disconnected past its grace; server ended its turn`,
  );
  return "skipped";
}

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

/**
 * One scanner pass: (1) marks seats disconnected once they cross
 * DISCONNECT_AFTER_MS of silence and flushes each marking to the games
 * row, then (2) schedules a SKIP_GRACE_MS skip timer for every
 * disconnected seat that currently holds the active turn and doesn't
 * already have a pending timer. Idempotent -- safe to run on any cadence.
 */
export async function scanOnce(): Promise<void> {
  const now = cfg.now();

  const disconnectedFlushes: Promise<void>[] = [];
  for (const [gameName, seats] of presence) {
    for (const [seat, entry] of seats) {
      if (entry.connected && now - entry.lastSeenAt >= cfg.disconnectAfterMs) {
        entry.connected = false;
        console.info(
          `[dropPolicy] seat ${seat} in "${gameName}" disconnected (${Math.round(cfg.disconnectAfterMs / 1000)}s without a heartbeat)`,
        );
        disconnectedFlushes.push(writeSeatPresence(gameName, seat, entry));
      }
    }
  }
  await Promise.all(disconnectedFlushes);

  const candidates: string[] = [];
  for (const [gameName, seats] of presence) {
    for (const entry of seats.values()) {
      if (!entry.connected) {
        candidates.push(gameName);
        break;
      }
    }
  }
  if (candidates.length === 0) return;

  let rows: { name: string; active_player_id: number }[];
  try {
    const r = await pool.query<{ name: string; active_player_id: number }>(
      `SELECT name, active_player_id FROM games WHERE name = ANY($1::text[])`,
      [candidates],
    );
    rows = r.rows;
  } catch (err) {
    console.warn("[dropPolicy] scan could not read games:", err);
    return;
  }

  const liveNames = new Set(rows.map((r) => r.name));
  for (const gameName of candidates) {
    if (!liveNames.has(gameName)) {
      presence.delete(gameName);
      cancelGameTimers(gameName);
    }
  }

  for (const row of rows) {
    const seats = presence.get(row.name);
    if (!seats) continue;
    for (const [seat, entry] of seats) {
      if (entry.connected) continue;
      if (row.active_player_id !== seat) continue;
      if (skipTimers.has(timerKey(row.name, seat))) continue;
      scheduleSkipTimer(row.name, seat, cfg.skipGraceMs, "grace");
    }
  }
}

let scanTimer: ReturnType<typeof setInterval> | null = null;
let scanInFlight = false;

/**
 * Starts the once-per-process scanner interval (called from server/index.ts
 * after initSchema). Idempotent; the interval never overlaps its own pass.
 */
export function startDropPolicyScanner(): void {
  if (scanTimer !== null) return;
  scanTimer = setInterval(() => {
    if (scanInFlight) return;
    scanInFlight = true;
    void scanOnce()
      .catch((err) => console.warn("[dropPolicy] scan pass failed:", err))
      .finally(() => {
        scanInFlight = false;
      });
  }, cfg.scanIntervalMs);
  scanTimer.unref?.();
}

export function stopDropPolicyScanner(): void {
  if (scanTimer !== null) {
    clearInterval(scanTimer);
    scanTimer = null;
  }
}
