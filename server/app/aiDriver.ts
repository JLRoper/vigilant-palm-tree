import { isCoveredWagonId, resolveGameMode } from "@heroes/contracts";
import type { Command, GameState, HeroBattleVerdict, HeroId, Platoon, Player, SettlementId } from "@heroes/contracts";
import {
  AI_RETREAT_STRENGTH_RATIO,
  GARRISON_BACKOFF_ROUNDS,
  SETTLEMENT_BATTLE_MIN_RETREAT_ROUND,
  detectAdjacentEnemy,
  evaluateTradeNeeds,
  findPath,
  getOrCreateGameMap,
  isMapSize,
  mulberry32,
  normalizePlatoons,
  pickAiMove,
  pickCharterAction,
  pickGarrisonRecruitment,
  pickSettlersWagonAction,
  platoonsHaveTroops,
  platoonTroopTotal,
  readPendingBattle,
  resolveBattle,
  resolveSavedMapGenVersion,
  settlementOutcomeFromBattle,
  settlementStacks,
  type MapGenVersion,
  type MapSize,
  type PendingBattleMarker,
  type SettlementBattleOutcome,
  type UnitType,
} from "@heroes/engine";
import { pool, type PoolClient } from "../persistence/db";
import { hydrateGame } from "../persistence/hydrate";
import {
  TURN_SKIPPED_AUDIT_KIND,
  createLiveCommandDeps,
  handleCommandTransactional,
  type LiveCommandDeps,
} from "./commandHandler";
import { aiDriverBootToken } from "./aiDriverToken";

// Server-side AI actor (plan/2026-09-30-server-side-ai-actor.md, Phase 1).
// For games flagged lobby.aiDriver === "server" (D1: any game created with
// enemySlots > 0), this scanner drives AI seats end-to-end in-process:
// hydrate -> pending-defender wait check (a human-defender battle the pass
// offered earlier: wait, or force-resolve once AI_DEFENDER_WAIT_TIMEOUT_MS
// is exceeded) -> D13 garrison recruitment (once per round+seat) -> trade-route
// auto-accept (once per round+seat) -> B3 charter founding (StartCharter,
// human-parity gated, once per round+seat per hero) -> per-hero sweeps
// (pickAiMove/MoveHero, or one AdvanceCharterTravel step per iteration for a
// chartering hero) -> walk-in gates in the client's order
// (defending hero defers -> garrison battle via D11 compute-once + submit,
// never applied locally -> walk-in capture -> adjacent-hero battle -- a
// HUMAN defender gets an EnterBattle offer and the pass STOPS with no
// EndTurn until the handler clears the marker, an AI defender auto-resolves
// via ResolveBattle, with D15 immediate-submit chaining after a hero
// battle) -> EndTurn without growthRate (D14). Dispatch goes through
// handleCommandTransactional (never HTTP), so the D10 route block in
// server/http/routes/commands.ts cannot gate it; AI seats never enter the
// presence map.
//
// Driver memory (D9) is in-process per game: the D4 RNG stream
// (mulberry32(seed ^ round ^ seat), one per (game, round, seat), CONTINUED
// across scans/actions, reset only when round/seat changes), the
// once-per-round+seat recruit and trade-route guards, the once-per-round+seat
// per-hero B3 charter guard, and the garrison backoff map. All of
// it is keyed by game name + the row's NUMERIC id: POST /games uses
// ON CONFLICT (name) and can resurrect a name with a new id, so an id
// mismatch resets the whole per-game memory.
//
// Cross-server coordination (2026-09-30 fix): two API processes scanning
// one shared game_db used to race the same AI turn (first-writer-wins on
// commands, lost battle submits, stalled e2e gates). Two guards close it:
// (1) a per-game Postgres advisory lock held on a dedicated pooled client
// for the whole pass -- if another server holds it, the game is skipped
// this scan; (2) boot-token scoping -- POST /games stamps this process's
// aiDriverBootToken() into lobby.aiDriverToken, and the scanner only
// drives games carrying its own token (or no token: the legacy adoption
// path, where the advisory lock arbitrates).

/** D3: pause between driver actions (0 disables). */
export const AI_ACTION_PACING_MS = 250;

/** D12: per-turn command budget; on exhaustion the pass best-effort EndTurns + audits. */
export const AI_TURN_ACTION_BUDGET = 64;

/** D12: per-game pass deadline, checked BETWEEN actions (never aborts mid-command). */
export const AI_TURN_PASS_DEADLINE_MS = 25_000;

/** Phase 5: trade-route recommendations the AI auto-accepts per round+seat. */
export const AI_MAX_ROUTES_PER_SEAT = 3;

/**
 * How long an offered defender battle (games.lobby.pendingBattle, dispatched
 * as EnterBattle for a HUMAN defender) may sit before the driver stops
 * waiting and force-resolves it server-side via ResolveBattle -- the human
 * defender's browser may be closed or the offer stale, and the AI turn must
 * never stall on it.
 */
export const AI_DEFENDER_WAIT_TIMEOUT_MS = 300_000;

/** Audit kind for the force-resolve above (turn_skipped convention). */
export const AI_DEFENDER_WAIT_EXPIRED_AUDIT_KIND = "ai_defender_wait_expired";

/** Audit kind for a collision whose defender hero has no owner player in the snapshot. */
export const AI_DEFENDER_OWNER_MISSING_AUDIT_KIND = "ai_defender_owner_missing";

/**
 * Phase 3 watchdog: floor for how stale an owned candidate's
 * lobby.aiDriverBeat (or, for beat-less pre-watchdog rows, games.updated_at)
 * may be before another boot may adopt its AI turn. Scaled up with the
 * candidate count (watchdogStaleThresholdMs) because scanOnce is
 * single-flight: with many active flagged games a healthy boot's stamps lag
 * by up to ~N pass deadlines between scans.
 */
export const AI_TURN_HEARTBEAT_STALE_MS = 60_000;

/** Audit kind for a watchdog adoption (the turn_skipped convention). */
export const AI_TURN_ADOPTED_AUDIT_KIND = "ai_turn_adopted";

const DEFAULT_SCAN_INTERVAL_MS = 5_000;

/** lobby.aiDriverBeat: the owning boot's liveness stamp (Phase 3 watchdog). */
export interface AiDriverBeat {
  token: string;
  at: number;
}

/** Wire shape of one driver candidate row. */
export interface AiDriverCandidate {
  name: string;
  id: number;
  active_player_id: number;
  /**
   * lobby.aiDriverToken: the boot token of the server process that created
   * the game. Absent/null on legacy pre-token flagged games (adoption path).
   */
  aiDriverToken?: string | null;
  /**
   * lobby.aiDriverBeat: the owning boot's liveness stamp. Null when absent
   * or malformed -- absence makes a foreign-token row adoptable once its
   * games.updated_at also goes stale (pre-watchdog rows).
   */
  aiDriverBeat?: AiDriverBeat | null;
  /** games.updated_at as epoch ms when parseable; the beat-less adoption guard. */
  updatedAt?: number | null;
}

/** What the driver needs per (re-)hydration: the state plus the row bits the state does not carry. */
export interface AiDriverGameSnapshot {
  gameId: number;
  seed: number;
  mapSize: MapSize | undefined;
  mapGenVersion?: MapGenVersion;
  /**
   * games.lobby.pendingBattle: a battle the driver offered a HUMAN defender
   * (EnterBattle) that has not been resolved yet. Null = nothing pending.
   * The hydrate derives phase.kind === "BATTLE" from it, so the pass must
   * treat a live marker as "stop and wait" (or force-resolve past the wait
   * deadline), never as a lost turn.
   */
  pendingBattle: PendingBattleMarker | null;
  state: GameState;
}

/** Narrow slice of CommandResult the drive loop actually consumes. */
export interface AiDriverCommandOutcome {
  ok: boolean;
  reason?: string;
  attackerVerdict?: HeroBattleVerdict;
}

/** Result of attempting the per-game advisory lock: busy means another server is driving. */
export type GameLockOutcome<T> = { locked: true; value: T } | { locked: false };

/**
 * Runs `drive` while holding the game's cross-process advisory lock.
 * `{ locked: false }` = the lock is held elsewhere; the drive never ran.
 */
export type WithGameLock = <T>(
  gameName: string,
  gameId: number,
  drive: () => Promise<T>,
) => Promise<GameLockOutcome<T>>;

export type AiDriveOutcome =
  | "ended_turn"
  | "ended_turn_exhausted"
  | "waiting_for_defender"
  | "turn_lost"
  | "game_gone"
  | "skipped_locked"
  | "failed";

interface GameDriverMemory {
  gameId: number;
  /** `${round}:${seat}` the rng stream was created for; the stream resets only when this changes (D4). */
  turnKey: string;
  rng: () => number;
  garrisonBackoff: Map<HeroId, Map<SettlementId, number>>;
  recruitedTurns: Set<string>;
  /** `${round}:${seat}` keys already served by the trade-route auto-accept (Phase 5, the recruitedTurns pattern). */
  tradeRouteTurns: Set<string>;
  /**
   * `${round}:${seat}:${heroId}` keys already attempted by the B3 charter-start
   * section. Per-hero granularity: a hero holds at most one charter
   * (already_chartering gates re-entry), and one broke hero must not block
   * another rich hero's attempt.
   */
  charterTurns: Set<string>;
}

const memory = new Map<string, GameDriverMemory>();
const inFlight = new Map<string, Promise<AiDriveOutcome>>();

interface ResolvedConfig {
  scanIntervalMs: number;
  pacingMs: number;
  actionBudget: number;
  passDeadlineMs: number;
  defenderWaitTimeoutMs: number;
  driverToken: string;
  now: () => number;
  loadCandidates: () => Promise<AiDriverCandidate[]>;
  loadGame: (gameName: string) => Promise<AiDriverGameSnapshot | null>;
  loadCatalog: () => Promise<Record<string, UnitType>>;
  runCommand: (command: Command) => Promise<AiDriverCommandOutcome>;
  appendAudit: (gameName: string, kind: string, payload: unknown) => Promise<void>;
  watchdogStaleMs: number;
  stampHeartbeats: (candidates: AiDriverCandidate[]) => Promise<void>;
  adoptGame: (candidate: AiDriverCandidate, previousToken: string) => Promise<boolean>;
  withGameLock: WithGameLock;
}

function beatFrom(value: unknown): AiDriverBeat | null {
  if (typeof value !== "object" || value === null) return null;
  const { token, at } = value as { token?: unknown; at?: unknown };
  if (typeof token !== "string" || token === "") return null;
  if (typeof at !== "number" || !Number.isFinite(at)) return null;
  return { token, at };
}

async function defaultLoadCandidates(): Promise<AiDriverCandidate[]> {
  const r = await pool.query<{
    name: string;
    id: number;
    active_player_id: number;
    players: Player[];
    ai_driver_token: string | null;
    ai_driver_beat: unknown;
    updated_at: Date;
  }>(
    `SELECT name, id, active_player_id, players, updated_at, lobby->>'aiDriverToken' AS ai_driver_token, lobby->'aiDriverBeat' AS ai_driver_beat
     FROM games WHERE lobby->>'aiDriver' = 'server'`,
  );
  // Hydrate derives AI_TURN exactly when the active player's faction is "ai"
  // (packages/engine/src/hydrate.ts), so this filter IS the phase gate.
  return r.rows
    .filter((row) => row.players.find((p) => p.id === row.active_player_id)?.faction === "ai")
    .map((row) => ({
      name: row.name,
      id: row.id,
      active_player_id: row.active_player_id,
      aiDriverToken: row.ai_driver_token,
      aiDriverBeat: beatFrom(row.ai_driver_beat),
      updatedAt: row.updated_at instanceof Date ? row.updated_at.getTime() : null,
    }));
}

function mapSizeFrom(value: string | null | undefined): MapSize | undefined {
  return isMapSize(value) ? value : undefined;
}

function mapGenVersionFrom(value: unknown): MapGenVersion {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : undefined;
  return resolveSavedMapGenVersion(n);
}

async function defaultLoadGame(gameName: string): Promise<AiDriverGameSnapshot | null> {
  const meta = await pool.query<{
    id: number;
    seed: number;
    map_size: string | null;
    pending_battle: unknown;
    map_gen_version: unknown;
  }>(
    `SELECT id, seed, map_size, lobby->'pendingBattle' AS pending_battle, lobby->'mapGenVersion' AS map_gen_version FROM games WHERE name = $1`,
    [gameName],
  );
  if (meta.rowCount === 0) return null;
  const row = meta.rows[0];
  const { state } = await hydrateGame(pool, gameName);
  return {
    gameId: row.id,
    seed: row.seed,
    mapSize: mapSizeFrom(row.map_size),
    mapGenVersion: mapGenVersionFrom(row.map_gen_version),
    pendingBattle: readPendingBattle({ pendingBattle: row.pending_battle }),
    state,
  };
}

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

function catalogOf(deps: LiveCommandDeps): Record<string, UnitType> {
  return Object.fromEntries(deps.ctx.catalog.unitTypes.map((u) => [u.id, u]));
}

async function defaultLoadCatalog(): Promise<Record<string, UnitType>> {
  return catalogOf(await getLiveDeps());
}

async function defaultRunCommand(command: Command): Promise<AiDriverCommandOutcome> {
  return handleCommandTransactional(command, await getLiveDeps());
}

// Mirrors eventRepo.append's INSERT (server/persistence/repositories/* is
// import-forbidden from server/app/ by dependency-cruiser; commandHandler.ts
// is the only exempt file and exposes no audit hook). actor_seat null: like
// turn_skipped, server-initiated actions are not attributable to the seat's
// own hand.
async function defaultAppendAudit(gameName: string, kind: string, payload: unknown): Promise<void> {
  await pool.query(
    `INSERT INTO game_events (game_id, kind, payload, actor_seat)
     SELECT id, $2, $3::jsonb, null FROM games WHERE name = $1`,
    [gameName, kind, JSON.stringify(payload)],
  );
}

// Phase 3 watchdog, write side: owner-guarded, single-statement lobby
// writes (gameRepo.saveLobby is deliberately not used -- whole-lobby
// read-modify-write is race-prone across processes and repositories/ is
// import-forbidden from server/app/). updated_at is deliberately NOT
// bumped: a 5 s heartbeat must not churn last-modified semantics.
export async function defaultStampHeartbeats(candidates: AiDriverCandidate[]): Promise<void> {
  const owned = candidates.filter(
    (c) => c.aiDriverToken !== undefined && c.aiDriverToken !== null && c.aiDriverToken === cfg.driverToken,
  );
  if (owned.length === 0) return;
  await pool.query(
    `UPDATE games
     SET lobby = jsonb_set(lobby, '{aiDriverBeat}', jsonb_build_object('token', $1::text, 'at', $2::bigint))
     WHERE id = ANY($3::bigint[]) AND lobby->>'aiDriverToken' = $1::text`,
    [cfg.driverToken, cfg.now(), owned.map((c) => c.id)],
  );
}

export async function defaultAdoptGame(
  candidate: AiDriverCandidate,
  previousToken: string,
): Promise<boolean> {
  const r = await pool.query(
    `UPDATE games
     SET lobby = jsonb_set(
           jsonb_set(lobby, '{aiDriverToken}', to_jsonb($2::text)),
           '{aiDriverBeat}',
           jsonb_build_object('token', $2::text, 'at', $3::bigint))
     WHERE name = $4 AND id = $5 AND lobby->>'aiDriverToken' = $1::text`,
    [previousToken, cfg.driverToken, cfg.now(), candidate.name, candidate.id],
  );
  return (r.rowCount ?? 0) === 1;
}

/**
 * Cross-process mutual exclusion for the drive (first-writer-wins across
 * dev servers sharing one game_db): a per-game Postgres ADVISORY lock.
 * Advisory locks are session-scoped, so the lock is taken and held on one
 * DEDICATED pooled client for the whole pass -- pool.query would land on an
 * arbitrary client per call and silently split the lock across sessions.
 * Postgres releases it automatically when the session dies (crash-safe);
 * the explicit unlock + release in `finally` covers the normal path.
 *
 * Deadlock-safe by single lock ordering: this session takes ONLY the
 * advisory lock; dispatched commands run on OTHER pool clients and take
 * only row locks (BEGIN/COMMIT per command), so no session ever waits on
 * the advisory lock while holding a row lock.
 *
 * The lock key is the game's numeric id (stable per row; a name
 * resurrection gets a new id and resets driver memory anyway).
 */
async function defaultWithGameLock<T>(
  gameName: string,
  gameId: number,
  drive: () => Promise<T>,
): Promise<GameLockOutcome<T>> {
  let client: PoolClient;
  try {
    client = await pool.connect();
  } catch (err) {
    // Phase 3 pool hardening: connectionTimeoutMillis makes an exhausted
    // pool fail fast; that is the same "cannot take the lock now" outcome
    // as a held advisory lock -- skip the game this scan.
    console.warn(`[aiDriver] "${gameName}" pool connect failed (skipping this scan):`, err);
    return { locked: false };
  }
  let acquired = false;
  try {
    const r = await client.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_lock($1::bigint) AS locked`,
      [gameId],
    );
    acquired = r.rows[0]?.locked === true;
    if (!acquired) return { locked: false };
    return { locked: true, value: await drive() };
  } finally {
    if (acquired) {
      try {
        await client.query(`SELECT pg_advisory_unlock($1::bigint)`, [gameId]);
      } catch (err) {
        console.warn(
          `[aiDriver] advisory unlock for "${gameName}" failed (the session close releases it):`,
          err,
        );
      }
    }
    client.release();
  }
}

function resolveConfig(): ResolvedConfig {
  return {
    scanIntervalMs: DEFAULT_SCAN_INTERVAL_MS,
    pacingMs: AI_ACTION_PACING_MS,
    actionBudget: AI_TURN_ACTION_BUDGET,
    passDeadlineMs: AI_TURN_PASS_DEADLINE_MS,
    defenderWaitTimeoutMs: AI_DEFENDER_WAIT_TIMEOUT_MS,
    driverToken: aiDriverBootToken(),
    now: () => Date.now(),
    loadCandidates: defaultLoadCandidates,
    loadGame: defaultLoadGame,
    loadCatalog: defaultLoadCatalog,
    runCommand: defaultRunCommand,
    appendAudit: defaultAppendAudit,
    watchdogStaleMs: AI_TURN_HEARTBEAT_STALE_MS,
    stampHeartbeats: defaultStampHeartbeats,
    adoptGame: defaultAdoptGame,
    withGameLock: defaultWithGameLock,
  };
}

let cfg: ResolvedConfig = resolveConfig();

export interface AiDriverOptions {
  scanIntervalMs?: number;
  pacingMs?: number;
  actionBudget?: number;
  passDeadlineMs?: number;
  /** Override of the defender-offer wait deadline (test seam; default AI_DEFENDER_WAIT_TIMEOUT_MS). */
  defenderWaitTimeoutMs?: number;
  /** Override of this process's boot token (test seam; default aiDriverBootToken()). */
  driverToken?: string;
  now?: () => number;
  loadCandidates?: () => Promise<AiDriverCandidate[]>;
  loadGame?: (gameName: string) => Promise<AiDriverGameSnapshot | null>;
  loadCatalog?: () => Promise<Record<string, UnitType>>;
  runCommand?: (command: Command) => Promise<AiDriverCommandOutcome>;
  appendAudit?: (gameName: string, kind: string, payload: unknown) => Promise<void>;
  /** Override of the watchdog staleness floor (test seam; default AI_TURN_HEARTBEAT_STALE_MS). */
  watchdogStaleMs?: number;
  /** Override of the heartbeat stamp (test seam; default real SQL). */
  stampHeartbeats?: (candidates: AiDriverCandidate[]) => Promise<void>;
  /** Override of the adoption CAS (test seam; default real SQL). */
  adoptGame?: (candidate: AiDriverCandidate, previousToken: string) => Promise<boolean>;
  /** Override of the per-game advisory-lock guard (test seam; default real SQL). */
  withGameLock?: WithGameLock;
}

/** Test seam: override any clock, delay, or pipeline hook (configureDropPolicy pattern). */
export function configureAiDriver(options: AiDriverOptions): void {
  cfg = { ...cfg, ...options };
}

/** Test/dev hook: clear all per-game driver memory and in-flight state and restore defaults. */
export function resetAiDriver(): void {
  memory.clear();
  inFlight.clear();
  liveDepsPromise = null;
  cfg = resolveConfig();
}

/** Test observability (getPresence precedent): does the driver hold memory for this game? */
export function isGameTrackedByDriver(gameName: string): boolean {
  return memory.has(gameName);
}

function syncMemory(gameName: string, gameId: number): GameDriverMemory {
  const existing = memory.get(gameName);
  if (existing && existing.gameId === gameId) return existing;
  if (existing) {
    console.warn(
      `[aiDriver] game "${gameName}" was recreated with a new id (${existing.gameId} -> ${gameId}); driver memory reset`,
    );
  }
  const fresh: GameDriverMemory = {
    gameId,
    turnKey: "",
    rng: () => 0,
    garrisonBackoff: new Map(),
    recruitedTurns: new Set(),
    tradeRouteTurns: new Set(),
    charterTurns: new Set(),
  };
  memory.set(gameName, fresh);
  return fresh;
}

function streamFor(mem: GameDriverMemory, seed: number, round: number, seat: number): () => number {
  const key = `${round}:${seat}`;
  if (mem.turnKey !== key) {
    mem.turnKey = key;
    mem.rng = mulberry32((seed ^ round ^ seat) >>> 0);
    // Prune recruit-guard, trade-route, and charter-guard entries from
    // finished rounds (each key starts with "round:").
    for (const entry of mem.recruitedTurns) {
      const entryRound = Number(entry.slice(0, entry.indexOf(":")));
      if (Number.isInteger(entryRound) && entryRound < round) mem.recruitedTurns.delete(entry);
    }
    for (const entry of mem.tradeRouteTurns) {
      const entryRound = Number(entry.slice(0, entry.indexOf(":")));
      if (Number.isInteger(entryRound) && entryRound < round) mem.tradeRouteTurns.delete(entry);
    }
    for (const entry of mem.charterTurns) {
      const entryRound = Number(entry.slice(0, entry.indexOf(":")));
      if (Number.isInteger(entryRound) && entryRound < round) mem.charterTurns.delete(entry);
    }
  }
  return mem.rng;
}

function activeBackoffExclusions(mem: GameDriverMemory, heroId: HeroId, round: number): Set<string> {
  const perHero = mem.garrisonBackoff.get(heroId);
  const out = new Set<string>();
  if (!perHero) return out;
  for (const [settlementId, expiryRound] of perHero) {
    // Recorded round R excludes rounds R..R+GARRISON_BACKOFF_ROUNDS-1.
    if (expiryRound > round) out.add(settlementId);
    else perHero.delete(settlementId);
  }
  return out;
}

function recordBackoff(
  mem: GameDriverMemory,
  heroId: HeroId,
  settlementId: SettlementId,
  round: number,
): void {
  let perHero = mem.garrisonBackoff.get(heroId);
  if (!perHero) {
    perHero = new Map();
    mem.garrisonBackoff.set(heroId, perHero);
  }
  perHero.set(settlementId, round + GARRISON_BACKOFF_ROUNDS);
}

// The seat's turn is live either in AI_TURN, or mid-pending-defender:
// packages/engine/src/hydrate.ts derives phase.kind === "BATTLE" from the
// lobby.pendingBattle marker (the pass's own EnterBattle offer), so the
// gate must accept that phase while the attacker is still the seat's hero.
function aiStillActive(state: GameState, seat: number): boolean {
  return (
    state.activePlayerId === seat &&
    (state.phase.kind === "AI_TURN" ||
      (state.phase.kind === "BATTLE" && state.heroes[state.phase.attackerId]?.ownerId === seat))
  );
}

function battleInputsKnown(
  catalog: Record<string, UnitType>,
  stackLists: readonly Platoon[][],
): boolean {
  return stackLists.every((stacks) =>
    stacks.every((p) => p.entries.every((e) => catalog[e.unitTypeId] !== undefined)),
  );
}

type BudgetState = "ok" | "budget" | "deadline";

interface PassContext {
  gameName: string;
  seat: number;
  mem: GameDriverMemory;
  catalog: Record<string, UnitType>;
  actions: number;
  startedAtMs: number;
}

function budgetState(ctx: PassContext): BudgetState {
  if (ctx.actions >= cfg.actionBudget) return "budget";
  if (cfg.now() - ctx.startedAtMs >= cfg.passDeadlineMs) return "deadline";
  return "ok";
}

async function pace(): Promise<void> {
  if (cfg.pacingMs > 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, cfg.pacingMs));
  }
}

// One dispatched command: budget-checked BETWEEN actions, paced. Returns
// { stop } when the pass must stop dispatching (turn lost / budget hit);
// a thrown command aborts the whole pass (retried on the next scan).
type DispatchResult =
  | { outcome: AiDriverCommandOutcome }
  | { stop: "turn_lost" | "budget" | "deadline" };

async function dispatch(ctx: PassContext, command: Command): Promise<DispatchResult> {
  const budget = budgetState(ctx);
  if (budget !== "ok") return { stop: budget };
  ctx.actions += 1;
  await pace();
  const outcome = await cfg.runCommand(command);
  if (!outcome.ok && outcome.reason === "forbidden_not_your_turn") {
    return { stop: "turn_lost" };
  }
  return { outcome };
}

// Walk-in gates in the client's order (src/state/turnController.ts
// tryCaptureAt): (a) a defending enemy hero on the tile defers entirely;
// (b) a garrison with troops fights a settlement battle -- D11: compute ONCE
// with the pure engine resolver, submit, never apply locally; a catalog
// failure or submit rejection bounces (submit nothing, hero stays, D9
// backoff recorded; NEVER outcome "retreat" -- no server flee exists);
// (c) otherwise a walk-in capture. Re-run after a hero battle for D15.
async function runWalkInGates(
  ctx: PassContext,
  heroId: HeroId,
  rng: () => number,
): Promise<{ gate: "none" | "battle" | "captured" } | { stop: "turn_lost" | "budget" | "deadline" | "game_gone" }> {
  const snap = await cfg.loadGame(ctx.gameName);
  if (!snap) return { stop: "game_gone" };
  if (!aiStillActive(snap.state, ctx.seat)) return { stop: "turn_lost" };
  const hero = snap.state.heroes[heroId];
  if (!hero) return { gate: "none" };
  const settlement = Object.values(snap.state.settlements).find(
    (s) => s.q === hero.q && s.r === hero.r && s.ownerId !== hero.ownerId,
  );
  if (!settlement) return { gate: "none" };
  // Gate (a): a defending enemy hero holds the tile (parity check; two
  // heroes cannot normally share a tile).
  for (const [otherId, other] of Object.entries(snap.state.heroes)) {
    if (otherId !== heroId && other.q === hero.q && other.r === hero.r && other.ownerId !== hero.ownerId) {
      return { gate: "none" };
    }
  }
  const garrison = settlementStacks(settlement);
  if (platoonsHaveTroops(garrison)) {
    if (!battleInputsKnown(ctx.catalog, [normalizePlatoons(hero.stacks), garrison])) {
      console.warn(
        `[aiDriver] "${ctx.gameName}" hero ${heroId}: unit catalog unavailable for the ${settlement.id} assault; deferring`,
      );
      recordBackoff(ctx.mem, heroId, settlement.id, snap.state.round);
      return { gate: "none" };
    }
    // D4: the submit's obstacleSeed is one non-negative int from the
    // turn's continued stream -- the SAME value the compute used.
    const obstacleSeed = Math.floor(rng() * 2 ** 31);
    const battle = resolveBattle(normalizePlatoons(hero.stacks), garrison, {
      obstacleSeed,
      unitTypes: ctx.catalog,
      attackerRetreatPolicy: {
        kind: "outmatched",
        strengthRatio: AI_RETREAT_STRENGTH_RATIO,
        minRetreatRound: SETTLEMENT_BATTLE_MIN_RETREAT_ROUND,
      },
    });
    const outcome: SettlementBattleOutcome = settlementOutcomeFromBattle(battle);
    const submitted = await dispatch(ctx, {
      kind: "SubmitSettlementBattleResult",
      gameName: ctx.gameName,
      actor: ctx.seat,
      attackerId: heroId,
      settlementId: settlement.id,
      outcome,
      attackerStacks: battle.attackerPlatoons,
      defenderStacks: battle.defenderPlatoons,
      rounds: battle.rounds,
      obstacleSeed,
    });
    if ("stop" in submitted) return submitted;
    if (!submitted.outcome.ok) {
      console.info(
        `[aiDriver] "${ctx.gameName}" settlement battle submit rejected (${submitted.outcome.reason}); hero ${heroId} bounces off ${settlement.id}`,
      );
      recordBackoff(ctx.mem, heroId, settlement.id, snap.state.round);
      return { gate: "none" };
    }
    if (outcome !== "attackerWon") {
      recordBackoff(ctx.mem, heroId, settlement.id, snap.state.round);
    }
    return { gate: "battle" };
  }
  const captured = await dispatch(ctx, {
    kind: "CaptureSettlement",
    gameName: ctx.gameName,
    actor: ctx.seat,
    heroId,
    settlementId: settlement.id,
  });
  if ("stop" in captured) return captured;
  if (!captured.outcome.ok) {
    console.info(
      `[aiDriver] "${ctx.gameName}" walk-in capture rejected (${captured.outcome.reason}); hero ${heroId} at ${settlement.id}`,
    );
  }
  return { gate: "captured" };
}

async function driveGameTurn(candidate: AiDriverCandidate): Promise<AiDriveOutcome> {
  const gameName = candidate.name;
  let snap = await cfg.loadGame(gameName);
  if (!snap) {
    memory.delete(gameName);
    return "game_gone";
  }
  if (!aiStillActive(snap.state, candidate.active_player_id)) return "turn_lost";
  const seat = snap.state.activePlayerId;
  // The mode is a per-game STORED value (games.lobby.gameMode / contracts'
  // resolveGameMode) and cannot change mid-pass, so it is read once, off the
  // top-of-pass hydration, and every mode-dependent branch below reads this
  // local. Classic (the default, and every game created before the feature)
  // reaches none of them.
  const mode = resolveGameMode(snap.state.gameMode);

  // A battle this pass (or a previous one) offered a HUMAN defender is still
  // pending: wait for their Fight/Auto-resolve choice instead of driving on.
  // Past the deadline the defender never answered (closed browser, stale
  // offer) -- force the server auto-resolver so the AI turn cannot stall,
  // unbudgeted and unpaced (the termination-EndTurn pattern, not dispatch()),
  // then fall through to the sweep. The handler clears the marker on success
  // AND on permanent rejection, so a stale marker cannot wedge the pass.
  if (snap.pendingBattle) {
    const pending = snap.pendingBattle;
    const waitedMs = cfg.now() - pending.since;
    if (waitedMs <= cfg.defenderWaitTimeoutMs) {
      return "waiting_for_defender";
    }
    const forced = await cfg.runCommand({
      kind: "ResolveBattle",
      gameName,
      actor: seat,
      attackerId: pending.attackerId,
      defenderId: pending.defenderId,
    });
    if (!forced.ok) {
      console.info(
        `[aiDriver] "${gameName}" force-resolve of the expired defender battle rejected (${forced.reason}); falling through to the sweep`,
      );
    }
    try {
      await cfg.appendAudit(gameName, AI_DEFENDER_WAIT_EXPIRED_AUDIT_KIND, {
        attackerId: pending.attackerId,
        defenderId: pending.defenderId,
        waitedMs,
        round: snap.state.round,
      });
    } catch (err) {
      console.error(`[aiDriver] "${gameName}" defender-wait audit append failed:`, err);
    }
  }

  const mem = syncMemory(gameName, snap.gameId);
  const catalog = await cfg.loadCatalog();
  const ctx: PassContext = { gameName, seat, mem, catalog, actions: 0, startedAtMs: cfg.now() };
  streamFor(mem, snap.seed, snap.state.round, seat);
  const heroIds = snap.state.players.find((p) => p.id === seat)?.heroIds ?? [];

  // D12: an action rejected for staleness/collision reasons drops that
  // hero's action for the REST of the pass; the next scan re-plans it with
  // a progressed rng stream.
  const skippedHeroes = new Set<HeroId>();
  let exhausted: "budget" | "deadline" | null = null;

  // D13: garrison recruitment once per round+seat (guard survives across
  // scans in mem), one RecruitUnits dispatch per item, per-item rejection
  // tolerated + logged + budget-counted. Without it a flagged AI town both
  // stops recruiting and bleeds weekly garrison upkeep.
  const recruitKey = `${snap.state.round}:${seat}`;
  if (!mem.recruitedTurns.has(recruitKey)) {
    mem.recruitedTurns.add(recruitKey);
    for (const item of pickGarrisonRecruitment(snap.state, seat, catalog)) {
      const recruited = await dispatch(ctx, {
        kind: "RecruitUnits",
        gameName,
        actor: seat,
        settlementId: item.settlementId,
        buildingKind: item.buildingKind,
        gx: item.gx,
        gy: item.gy,
        unitTypeId: item.unitTypeId,
        count: item.count,
        ...(item.district ? { district: item.district } : {}),
      });
      if ("stop" in recruited) {
        if (recruited.stop === "turn_lost") return "turn_lost";
        exhausted = recruited.stop;
        break;
      }
      if (!recruited.outcome.ok) {
        console.info(
          `[aiDriver] "${gameName}" garrison recruit rejected (${recruited.outcome.reason}): ${item.unitTypeId} x${item.count} @ ${item.settlementId}`,
        );
      }
    }
  }

  // Phase 5: trade-route auto-accept, once per round+seat (the D13 pattern
  // above): the SAME evaluator the player's logistics modal uses runs for
  // the AI seat, and up to AI_MAX_ROUTES_PER_SEAT recommendations are
  // accepted. Per accepted rec: ensure the unassigned wagon pool covers the
  // suggestion (BuyWagons at the rec's ORIGIN settlement when affordable —
  // 200g + 5 wood per wagon, rejection tolerated), then CreateTradeRoute
  // with the suggested wagons clamped to whatever pool actually exists.
  // Every command is budget-counted via dispatch; per-item rejections are
  // logged and never stall the turn; exhaustion (budget/deadline) breaks
  // out exactly like the recruit loop.
  const tradeKey = `${snap.state.round}:${seat}`;
  if (!mem.tradeRouteTurns.has(tradeKey)) {
    mem.tradeRouteTurns.add(tradeKey);
    const recommendations = evaluateTradeNeeds(snap.state, seat, catalog).slice(0, AI_MAX_ROUTES_PER_SEAT);
    for (const rec of recommendations) {
      if (rec.from.kind !== "settlement") continue;
      const seatPlayer = snap.state.players.find((p) => p.id === seat);
      let pool = seatPlayer?.wagonsUnassigned ?? 0;
      if (pool < rec.wagons) {
        const bought = await dispatch(ctx, {
          kind: "BuyWagons",
          gameName,
          actor: seat,
          settlementId: rec.from.id,
          count: rec.wagons - pool,
        });
        if ("stop" in bought) {
          if (bought.stop === "turn_lost") return "turn_lost";
          exhausted = bought.stop;
          break;
        }
        // Trust an accepted buy (the handler re-validates affordability
        // against authoritative state) but not a rejected one: the driver's
        // snapshot is stale by construction, so the pool is tracked locally.
        if (bought.outcome.ok) pool += rec.wagons - pool;
      }
      if (pool < 1) {
        console.info(
          `[aiDriver] "${gameName}" trade route to ${JSON.stringify(rec.to)} skipped: no wagons in the unassigned pool`,
        );
        continue;
      }
      const created = await dispatch(ctx, {
        kind: "CreateTradeRoute",
        gameName,
        actor: seat,
        from: rec.from,
        to: rec.to,
        payload: rec.payload,
        wagons: Math.min(rec.wagons, pool),
      });
      if ("stop" in created) {
        if (created.stop === "turn_lost") return "turn_lost";
        exhausted = created.stop;
        break;
      }
      if (!created.outcome.ok) {
        console.info(
          `[aiDriver] "${gameName}" CreateTradeRoute rejected (${created.outcome.reason}): ${JSON.stringify(rec.from)} -> ${JSON.stringify(rec.to)}`,
        );
      }
    }
  }

  // B3 chartering (plan .plans/20261002-1900_ai-actor-phase-3, item 7): AI
  // seats may found settlements under the exact same rules as human players
  // (user ruling: "Yes, AI charters with human-parity gating"). One
  // re-hydrate first, because the recruit and trade-route sections earlier in
  // this same pass mutate the very warehouse/purse the charter gate reads, so
  // planning off the top-of-pass snapshot would manufacture guaranteed
  // insufficient_wood-style rejections (the runWalkInGates re-hydrate
  // precedent). Then one StartCharter attempt per hero not already attempted
  // this round+seat: pickCharterAction runs the shared human-parity gate
  // (evaluateCharterRequirements parity -- purse 2500g, founding settlement
  // warehouse wood 20 / stone 15, hero standing on a friendly settlement, not
  // already chartering) and the deterministic target rule (highest chartered-
  // city production, then nearest, then record order). The guard key is added
  // BEFORE the dispatch so exactly one attempt happens per hero per round
  // whatever the outcome; a rejection is logged and the hero is retried next
  // round (the recruit-loop pattern). Ordered after garrison recruitment and
  // trade routes: the charter's 20 wood / 15 stone come from the founding
  // settlement's warehouse, the same pool those draw from, while its 2500g
  // comes from the hero purse, never the treasury. Deliberately NO AI
  // treasury-withdrawal/funding step -- beyond the ruling's scope, so AI
  // charters fire when its heroes are already funded.
  const charterSnap = await cfg.loadGame(gameName);
  if (!charterSnap) {
    memory.delete(gameName);
    return "game_gone";
  }
  if (!aiStillActive(charterSnap.state, seat)) return "turn_lost";
  if (charterSnap.gameId !== mem.gameId) {
    // The name was recreated with a new id mid-pass; stop driving. The next
    // scan's syncMemory resets all memory for the game.
    return "turn_lost";
  }
  const charterMap = getOrCreateGameMap(charterSnap.seed, charterSnap.mapSize, charterSnap.mapGenVersion);
  for (const heroId of heroIds) {
    const charterKey = `${charterSnap.state.round}:${seat}:${heroId}`;
    if (mem.charterTurns.has(charterKey)) continue;
    mem.charterTurns.add(charterKey);
    const action = pickCharterAction(charterSnap.state, heroId, charterMap, mem.rng);
    if (!action) continue;
    const started = await dispatch(ctx, {
      kind: "StartCharter",
      gameName,
      actor: seat,
      heroId,
      targetQ: action.targetQ,
      targetR: action.targetR,
      settlementName: action.settlementName,
    });
    if ("stop" in started) {
      if (started.stop === "turn_lost") return "turn_lost";
      exhausted = started.stop;
      break;
    }
    if (!started.outcome.ok) {
      console.info(
        `[aiDriver] "${gameName}" StartCharter for ${heroId} rejected (${started.outcome.reason}); no charter attempt for this hero this round`,
      );
    }
  }

  // Whole-turn drive: sweeps of the hero roster until a full sweep moves
  // nobody, then the turn ends below. Every action re-hydrates first (D11);
  // removed heroes vanish from the loop.
  sweep: for (;;) {
    let movedThisSweep = 0;
    for (const heroId of heroIds) {
      if (skippedHeroes.has(heroId)) continue;
      const budget = budgetState(ctx);
      if (budget !== "ok") {
        exhausted = budget;
        break sweep;
      }
      for (;;) {
        snap = await cfg.loadGame(gameName);
        if (!snap) {
          memory.delete(gameName);
          return "game_gone";
        }
        if (!aiStillActive(snap.state, seat)) return "turn_lost";
        if (snap.gameId !== mem.gameId) {
          // The name was recreated with a new id mid-pass; stop driving.
          // The next scan's syncMemory resets all memory for the game.
          return "turn_lost";
        }
        const hero = snap.state.heroes[heroId];
        if (!hero) break;
        const map = getOrCreateGameMap(snap.seed, snap.mapSize, snap.mapGenVersion);
        // Settlers mode (SETTLERS-PLAN.md §4 W5): the seat's only entity is a
        // covered wagon, and founding IS its turn. The decision comes from the
        // engine brain -- pickSettlersWagonAction, which asks the engine's own
        // canFoundSettlement about every hex it considers -- and the dispatch
        // below is the same FoundSettlement command a human's gesture sends, so
        // the AI cannot found where a human could not. Found-where-it-stands
        // happens as soon as the engine admits it (the wagon is then consumed,
        // which ends this hero's loop on the next hydration); otherwise the
        // wagon takes one step toward the nearest hex it may found on (or the
        // ordinary wander step when no such hex is reachable), and re-decides
        // each step, so arriving and founding land in one turn.
        // A wagon has no army: this branch deliberately bypasses the walk-in
        // gates, the adjacency battle, the charter travel and every capture --
        // the army-only commands a wagon must never be given -- and the brain
        // never offers it a military target.
        if (mode === "settlers" && isCoveredWagonId(heroId)) {
          const wagonAction = pickSettlersWagonAction(snap.state, heroId, map, mem.rng);
          if (!wagonAction) break;
          if (wagonAction.kind === "found") {
            const founded = await dispatch(ctx, {
              kind: "FoundSettlement",
              gameName,
              actor: seat,
              founderId: heroId,
              q: wagonAction.q,
              r: wagonAction.r,
            });
            if ("stop" in founded) {
              if (founded.stop === "turn_lost") return "turn_lost";
              exhausted = founded.stop;
              break sweep;
            }
            if (!founded.outcome.ok) {
              console.info(
                `[aiDriver] "${gameName}" FoundSettlement for ${heroId} rejected (${founded.outcome.reason}); dropping the action for this pass`,
              );
              skippedHeroes.add(heroId);
              break;
            }
            movedThisSweep += 1;
            break;
          }
          const stepped = await dispatch(ctx, {
            kind: "MoveHero",
            gameName,
            actor: seat,
            heroId,
            fromTile: { q: hero.q, r: hero.r },
            toTile: wagonAction.toTile,
            cost: wagonAction.cost,
          });
          if ("stop" in stepped) {
            if (stepped.stop === "turn_lost") return "turn_lost";
            exhausted = stepped.stop;
            break sweep;
          }
          if (!stepped.outcome.ok) {
            console.info(
              `[aiDriver] "${gameName}" MoveHero for wagon ${heroId} rejected (${stepped.outcome.reason}); dropping the action for this pass`,
            );
            skippedHeroes.add(heroId);
            break;
          }
          movedThisSweep += 1;
          continue;
        }
        // B3b: a chartering hero travels its charter's route instead of
        // taking a pickAiMove move -- startMove rejects is_chartering, so the
        // two branches are mutually exclusive per hero and a chartering hero
        // never produces a MoveHero. Parity reference: the human's
        // advanceAutoTravel() (src/state/turnController.ts) -- one findPath
        // step per iteration toward the charter target read from the hero's
        // live charter record (never from a planning call), with other
        // heroes' tiles blocked. The walk-in gates / adjacency-battle block
        // is skipped for these steps, exactly like the human's own loop.
        // Each successful step counts toward movedThisSweep so the sweep
        // keeps running while charters travel; a rejected step drops the
        // hero for the pass instead of spinning.
        if (hero.isChartering) {
          const charter = snap.state.activeCharters.find((c) => c.id === hero.charterId);
          if (!charter || charter.phase !== "traveling") break;
          if (hero.movementRemaining < 1) break;
          const occupiedHexes = new Set<string>();
          for (const [otherId, other] of Object.entries(snap.state.heroes)) {
            if (otherId !== heroId) occupiedHexes.add(`${other.q},${other.r}`);
          }
          const path = findPath(
            map,
            { q: hero.q, r: hero.r },
            { q: charter.targetQ, r: charter.targetR },
            occupiedHexes,
          );
          if (path.length === 0) break;
          const nextStep = path[0];
          const cost = map.cost(nextStep.q, nextStep.r);
          if (!Number.isFinite(cost) || cost < 0) break;
          const step = await dispatch(ctx, {
            kind: "AdvanceCharterTravel",
            gameName,
            actor: seat,
            heroId,
            fromTile: { q: hero.q, r: hero.r },
            toTile: nextStep,
            cost,
          });
          if ("stop" in step) {
            if (step.stop === "turn_lost") return "turn_lost";
            exhausted = step.stop;
            break sweep;
          }
          if (!step.outcome.ok) {
            console.info(
              `[aiDriver] "${gameName}" AdvanceCharterTravel for ${heroId} rejected (${step.outcome.reason}); dropping the action for this pass`,
            );
            skippedHeroes.add(heroId);
            break;
          }
          movedThisSweep += 1;
          continue;
        }
        const move = pickAiMove(
          snap.state,
          heroId,
          map,
          mem.rng,
          catalog,
          activeBackoffExclusions(mem, heroId, snap.state.round),
        );
        if (!move) break;
        const moved = await dispatch(ctx, {
          kind: "MoveHero",
          gameName,
          actor: seat,
          heroId,
          fromTile: { q: hero.q, r: hero.r },
          toTile: move.toTile,
          cost: move.cost,
        });
        if ("stop" in moved) {
          if (moved.stop === "turn_lost") return "turn_lost";
          exhausted = moved.stop;
          break sweep;
        }
        if (!moved.outcome.ok) {
          console.info(
            `[aiDriver] "${gameName}" MoveHero for ${heroId} rejected (${moved.outcome.reason}); dropping the action for this pass`,
          );
          skippedHeroes.add(heroId);
          break;
        }
        movedThisSweep += 1;
        const gates = await runWalkInGates(ctx, heroId, mem.rng);
        if ("stop" in gates) {
          if (gates.stop === "turn_lost") return "turn_lost";
          if (gates.stop === "game_gone") {
            memory.delete(gameName);
            return "game_gone";
          }
          exhausted = gates.stop;
          break sweep;
        }
        // Client parity: an opened settlement battle owns the move -- the
        // adjacency check is skipped for this move and re-fires later.
        if (gates.gate === "battle") break;
        const adj = await cfg.loadGame(gameName);
        if (!adj) {
          memory.delete(gameName);
          return "game_gone";
        }
        if (!aiStillActive(adj.state, seat)) return "turn_lost";
        if (adj.gameId !== mem.gameId) return "turn_lost";
        const attacker = adj.state.heroes[heroId];
        if (!attacker) break;
        const defenderId = detectAdjacentEnemy(adj.state, heroId);
        if (defenderId && platoonTroopTotal(adj.state.heroes[defenderId]?.stacks ?? []) > 0) {
          const defenderHero = adj.state.heroes[defenderId];
          const defenderOwner = defenderHero
            ? adj.state.players.find((p) => p.id === defenderHero.ownerId)
            : undefined;
          if (!defenderOwner) {
            // R4 hardening: the defender hero is present with troops but its
            // owner player is missing from the snapshot -- neither battle
            // command can succeed against it (the handler rejects on the
            // owner). Surface the anomaly, audit it, and drop the collision
            // for this pass instead of silently falling through to a doomed
            // ResolveBattle.
            console.warn(
              `[aiDriver] "${gameName}" defender ${defenderId} has no owner player in the snapshot (attacker ${heroId}); dropping the collision for this pass`,
            );
            try {
              await cfg.appendAudit(gameName, AI_DEFENDER_OWNER_MISSING_AUDIT_KIND, {
                attackerId: heroId,
                defenderId,
                reason: "defender_owner_missing",
                round: adj.state.round,
              });
            } catch (err) {
              console.error(`[aiDriver] "${gameName}" defender-owner-missing audit append failed:`, err);
            }
            skippedHeroes.add(heroId);
            break;
          }
          if (defenderOwner.faction !== "ai") {
            // Human defender: offer the battle and wait for their choice
            // instead of auto-resolving. The handler persists the pending
            // battle and notifies clients; the next scan resumes once it is
            // resolved (or the wait deadline expires). The return (not a
            // break) exits driveGameTurn entirely, so neither the
            // exhaustion EndTurn below nor the termination EndTurn can run
            // while an offer is pending.
            const offered = await dispatch(ctx, {
              kind: "EnterBattle",
              gameName,
              actor: seat,
              attackerId: heroId,
              defenderId,
            });
            if ("stop" in offered) {
              if (offered.stop === "turn_lost") return "turn_lost";
              exhausted = offered.stop;
              break sweep;
            }
            if (!offered.outcome.ok) {
              console.info(
                `[aiDriver] "${gameName}" EnterBattle rejected (${offered.outcome.reason}); dropping the action for this pass`,
              );
              skippedHeroes.add(heroId);
              break;
            }
            return "waiting_for_defender";
          }
          const resolved = await dispatch(ctx, {
            kind: "ResolveBattle",
            gameName,
            actor: seat,
            attackerId: heroId,
            defenderId,
          });
          if ("stop" in resolved) {
            if (resolved.stop === "turn_lost") return "turn_lost";
            exhausted = resolved.stop;
            break sweep;
          }
          if (resolved.outcome.ok) {
            // D15 immediate-submit chaining: after a hero battle, if the
            // attacker now stands on a garrisoned enemy settlement tile,
            // the garrison battle is submitted immediately instead of
            // deferring to the next scan.
            const chain = await runWalkInGates(ctx, heroId, mem.rng);
            if ("stop" in chain) {
              if (chain.stop === "turn_lost") return "turn_lost";
              if (chain.stop === "game_gone") {
                memory.delete(gameName);
                return "game_gone";
              }
              exhausted = chain.stop;
              break sweep;
            }
          } else {
            console.info(
              `[aiDriver] "${gameName}" ResolveBattle rejected (${resolved.outcome.reason}); dropping the action for this pass`,
            );
            skippedHeroes.add(heroId);
            break;
          }
        }
      }
    }
    if (movedThisSweep === 0) break;
  }

  if (exhausted !== null) {
    // D12 exhaustion: best-effort EndTurn (only if the AI seat is still
    // active) + a turn_skipped-convention audit row.
    const final = await cfg.loadGame(gameName);
    if (!final) {
      memory.delete(gameName);
      return "game_gone";
    }
    if (aiStillActive(final.state, seat)) {
      try {
        await cfg.runCommand({ kind: "EndTurn", gameName, actor: seat });
      } catch (err) {
        console.error(`[aiDriver] "${gameName}" exhaustion EndTurn threw:`, err);
      }
    }
    try {
      await cfg.appendAudit(gameName, TURN_SKIPPED_AUDIT_KIND, {
        playerId: seat,
        reason: exhausted === "budget" ? "ai_turn_budget_exhausted" : "ai_turn_deadline_exceeded",
        round: final.state.round,
        actions: ctx.actions,
      });
    } catch (err) {
      console.error(`[aiDriver] "${gameName}" exhaustion audit append failed:`, err);
    }
    return "ended_turn_exhausted";
  }

  // No hero moved in the final full sweep: the turn is done (or fully
  // stuck) -- end it. The final EndTurn is the termination action, not a
  // budgeted one.
  const ended = await cfg.runCommand({ kind: "EndTurn", gameName, actor: seat });
  return ended.ok || ended.reason === "forbidden_not_your_turn" ? "ended_turn" : "turn_lost";
}

/**
 * Boot-token scoping: a server drives only the games IT created (matching
 * token). A missing/empty token marks a legacy pre-token flagged game --
 * any server may adopt it, and the advisory lock makes that
 * first-claimed-wins per scan.
 */
function driverOwnsCandidate(candidate: AiDriverCandidate): boolean {
  const token = candidate.aiDriverToken;
  return token === undefined || token === null || token === "" || token === cfg.driverToken;
}

function watchdogStaleThresholdMs(candidateCount: number): number {
  return Math.max(
    cfg.watchdogStaleMs,
    candidateCount * (cfg.passDeadlineMs + 5_000) + cfg.scanIntervalMs,
  );
}

/**
 * Phase 3 watchdog: a foreign-token candidate is adoptable when its beat is
 * stale, or -- for rows that predate beats -- when the row itself has gone
 * silent (games.updated_at older than the same threshold; an actively
 * driven turn persists on every command). Recovery is a won CAS restamp
 * followed by the ordinary drive; if the old boot finished the turn before
 * dying, aiStillActive yields turn_lost and adoption was harmless.
 */
async function maybeAdoptStaleCandidate(
  candidate: AiDriverCandidate,
  candidateCount: number,
): Promise<boolean> {
  const token = candidate.aiDriverToken;
  if (token === undefined || token === null || token === "") return false;
  const beat = candidate.aiDriverBeat ?? null;
  const staleMs = watchdogStaleThresholdMs(candidateCount);
  const beatAgeMs = beat === null ? null : cfg.now() - beat.at;
  const updatedAtAgeMs = candidate.updatedAt == null ? null : cfg.now() - candidate.updatedAt;
  const stale =
    beat !== null
      ? beatAgeMs !== null && beatAgeMs > staleMs
      : updatedAtAgeMs === null || updatedAtAgeMs > staleMs;
  if (!stale) return false;
  let adopted = false;
  try {
    adopted = await cfg.adoptGame(candidate, token);
  } catch (err) {
    console.warn(`[aiDriver] "${candidate.name}" watchdog adoption failed:`, err);
    return false;
  }
  if (!adopted) return false;
  console.info(
    `[aiDriver] watchdog adopted "${candidate.name}" from boot token ${token.slice(0, 8)}... (beat ${
      beatAgeMs === null ? "absent" : `${Math.round(beatAgeMs / 1000)}s old`
    })`,
  );
  try {
    await cfg.appendAudit(candidate.name, AI_TURN_ADOPTED_AUDIT_KIND, {
      gameId: candidate.id,
      fromToken: token,
      toToken: cfg.driverToken,
      beatAt: beat?.at ?? null,
      beatAgeMs,
    });
  } catch (err) {
    console.error(`[aiDriver] "${candidate.name}" adoption audit append failed:`, err);
  }
  return true;
}

/**
 * One scanner pass: find flagged games whose active seat is an AI faction
 * (== hydrated AI_TURN) and drive each one's whole turn, sequentially, with
 * per-game in-flight + boot-token filtering + cross-process advisory-lock
 * isolation. Idempotent; safe on any cadence. Phase 3: owned candidates are
 * heartbeat-stamped, and foreign-token candidates whose beat/updated_at
 * went stale are CAS-adopted before driving.
 */
export async function scanOnce(): Promise<void> {
  let candidates: AiDriverCandidate[];
  try {
    candidates = await cfg.loadCandidates();
  } catch (err) {
    console.warn("[aiDriver] scan could not read candidate games:", err);
    return;
  }
  for (const candidate of candidates) {
    if (inFlight.has(candidate.name)) continue;
    if (!driverOwnsCandidate(candidate)) {
      const adopted = await maybeAdoptStaleCandidate(candidate, candidates.length);
      if (!adopted) continue;
    }
    try {
      await cfg.stampHeartbeats([candidate]);
    } catch (err) {
      console.warn(`[aiDriver] heartbeat stamp for "${candidate.name}" failed:`, err);
    }
    const run = cfg
      .withGameLock(candidate.name, candidate.id, () => driveGameTurn(candidate))
      .then((held): AiDriveOutcome => {
        if (held.locked) return held.value;
        console.info(
          `[aiDriver] "${candidate.name}" is being driven by another server (advisory lock held); skipping this scan`,
        );
        return "skipped_locked";
      })
      .catch((err): AiDriveOutcome => {
        console.error(`[aiDriver] driving "${candidate.name}" failed:`, err);
        return "failed";
      });
    inFlight.set(candidate.name, run);
    try {
      await run;
    } finally {
      if (inFlight.get(candidate.name) === run) inFlight.delete(candidate.name);
    }
  }
}

let scanTimer: ReturnType<typeof setInterval> | null = null;
let scanInFlight = false;

/** Starts the once-per-process scanner interval (called from server/index.ts). Idempotent; never overlaps its own pass. */
export function startAiDriver(): void {
  if (scanTimer !== null) return;
  scanTimer = setInterval(() => {
    if (scanInFlight) return;
    scanInFlight = true;
    void scanOnce()
      .catch((err) => console.warn("[aiDriver] scan pass failed:", err))
      .finally(() => {
        scanInFlight = false;
      });
  }, cfg.scanIntervalMs);
  scanTimer.unref?.();
}

export function stopAiDriver(): void {
  if (scanTimer !== null) {
    clearInterval(scanTimer);
    scanTimer = null;
  }
}
