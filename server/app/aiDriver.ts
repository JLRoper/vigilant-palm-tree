import type { Command, GameState, HeroBattleVerdict, HeroId, Platoon, Player, SettlementId } from "@heroes/contracts";
import {
  GARRISON_BACKOFF_ROUNDS,
  GameMap,
  detectAdjacentEnemy,
  mulberry32,
  normalizePlatoons,
  pickAiMove,
  pickGarrisonRecruitment,
  platoonsHaveTroops,
  platoonTroopTotal,
  resolveBattle,
  settlementStacks,
  type MapSize,
  type SettlementBattleOutcome,
  type UnitType,
} from "@heroes/engine";
import { pool } from "../persistence/db";
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
// hydrate -> D13 garrison recruitment (once per round+seat) -> per-hero
// pickAiMove/MoveHero sweeps -> walk-in gates in the client's order
// (defending hero defers -> garrison battle via D11 compute-once + submit,
// never applied locally -> walk-in capture -> adjacent-hero ResolveBattle,
// with D15 immediate-submit chaining after a hero battle) -> EndTurn without
// growthRate (D14). Dispatch goes through handleCommandTransactional (never
// HTTP), so the D10 route block in server/http/routes/commands.ts cannot
// gate it; AI seats never enter the presence map.
//
// Driver memory (D9) is in-process per game: the D4 RNG stream
// (mulberry32(seed ^ round ^ seat), one per (game, round, seat), CONTINUED
// across scans/actions, reset only when round/seat changes), the
// once-per-round+seat recruit guard, and the garrison backoff map. All of
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

const DEFAULT_SCAN_INTERVAL_MS = 5_000;

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
}

/** What the driver needs per (re-)hydration: the state plus the row bits the state does not carry. */
export interface AiDriverGameSnapshot {
  gameId: number;
  seed: number;
  mapSize: MapSize | undefined;
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
}

const memory = new Map<string, GameDriverMemory>();
const inFlight = new Map<string, Promise<AiDriveOutcome>>();

interface ResolvedConfig {
  scanIntervalMs: number;
  pacingMs: number;
  actionBudget: number;
  passDeadlineMs: number;
  driverToken: string;
  now: () => number;
  loadCandidates: () => Promise<AiDriverCandidate[]>;
  loadGame: (gameName: string) => Promise<AiDriverGameSnapshot | null>;
  loadCatalog: () => Promise<Record<string, UnitType>>;
  runCommand: (command: Command) => Promise<AiDriverCommandOutcome>;
  appendAudit: (gameName: string, kind: string, payload: unknown) => Promise<void>;
  withGameLock: WithGameLock;
}

async function defaultLoadCandidates(): Promise<AiDriverCandidate[]> {
  const r = await pool.query<{
    name: string;
    id: number;
    active_player_id: number;
    players: Player[];
    ai_driver_token: string | null;
  }>(
    `SELECT name, id, active_player_id, players, lobby->>'aiDriverToken' AS ai_driver_token
     FROM games WHERE lobby->>'aiDriver' = 'server'`,
  );
  // Hydrate derives AI_TURN exactly when the active player's faction is "ai"
  // (packages/engine/src/hydrate.ts), so this filter IS the phase gate.
  return r.rows
    .filter((row) => row.players.find((p) => p.id === row.active_player_id)?.faction === "ai")
    .map(({ name, id, active_player_id, ai_driver_token }) => ({
      name,
      id,
      active_player_id,
      aiDriverToken: ai_driver_token,
    }));
}

function mapSizeFrom(value: string | null | undefined): MapSize | undefined {
  return value === "small" || value === "medium" || value === "large" ? value : undefined;
}

async function defaultLoadGame(gameName: string): Promise<AiDriverGameSnapshot | null> {
  const meta = await pool.query<{ id: number; seed: number; map_size: string | null }>(
    `SELECT id, seed, map_size FROM games WHERE name = $1`,
    [gameName],
  );
  if (meta.rowCount === 0) return null;
  const row = meta.rows[0];
  const { state } = await hydrateGame(pool, gameName);
  return { gameId: row.id, seed: row.seed, mapSize: mapSizeFrom(row.map_size), state };
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
  const client = await pool.connect();
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
    driverToken: aiDriverBootToken(),
    now: () => Date.now(),
    loadCandidates: defaultLoadCandidates,
    loadGame: defaultLoadGame,
    loadCatalog: defaultLoadCatalog,
    runCommand: defaultRunCommand,
    appendAudit: defaultAppendAudit,
    withGameLock: defaultWithGameLock,
  };
}

let cfg: ResolvedConfig = resolveConfig();

export interface AiDriverOptions {
  scanIntervalMs?: number;
  pacingMs?: number;
  actionBudget?: number;
  passDeadlineMs?: number;
  /** Override of this process's boot token (test seam; default aiDriverBootToken()). */
  driverToken?: string;
  now?: () => number;
  loadCandidates?: () => Promise<AiDriverCandidate[]>;
  loadGame?: (gameName: string) => Promise<AiDriverGameSnapshot | null>;
  loadCatalog?: () => Promise<Record<string, UnitType>>;
  runCommand?: (command: Command) => Promise<AiDriverCommandOutcome>;
  appendAudit?: (gameName: string, kind: string, payload: unknown) => Promise<void>;
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
  };
  memory.set(gameName, fresh);
  return fresh;
}

function streamFor(mem: GameDriverMemory, seed: number, round: number, seat: number): () => number {
  const key = `${round}:${seat}`;
  if (mem.turnKey !== key) {
    mem.turnKey = key;
    mem.rng = mulberry32((seed ^ round ^ seat) >>> 0);
    // Prune recruit-guard entries from finished rounds (keyed "round:seat").
    for (const entry of mem.recruitedTurns) {
      const entryRound = Number(entry.slice(0, entry.indexOf(":")));
      if (Number.isInteger(entryRound) && entryRound < round) mem.recruitedTurns.delete(entry);
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

function aiStillActive(state: GameState, seat: number): boolean {
  return state.phase.kind === "AI_TURN" && state.activePlayerId === seat;
}

function settlementBattleOutcome(winner: "attacker" | "defender" | "draw"): SettlementBattleOutcome {
  return winner === "attacker" ? "attackerWon" : winner === "defender" ? "defenderWon" : "draw";
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
    });
    const outcome = settlementBattleOutcome(battle.winner);
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
        const map = new GameMap(snap.seed, snap.mapSize);
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

/**
 * One scanner pass: find flagged games whose active seat is an AI faction
 * (== hydrated AI_TURN) and drive each one's whole turn, sequentially, with
 * per-game in-flight + boot-token filtering + cross-process advisory-lock
 * isolation. Idempotent; safe on any cadence.
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
    if (!driverOwnsCandidate(candidate)) continue;
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
