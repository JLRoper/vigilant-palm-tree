import { hydrateGameState } from "@heroes/engine";
import type { HydratableGameRow } from "@heroes/engine";
import type { CharterState, GameState, HeroState, SettlementState } from "@heroes/contracts";
import { createGameRepo } from "./repositories/gameRepo";
import type { Queryable } from "./repositories/gameRepo";
import { createHeroRepo } from "./repositories/heroRepo";
import { createSettlementRepo } from "./repositories/settlementRepo";
import { createCharterRepo } from "./repositories/charterRepo";

// Phase 4 Track A (plan/2026-08-17-phase-4-db-deblobbing-dev-plan.md,
// "Dual-write & read-path design"): granular-first hydration with a
// per-game JSONB fallback while scripts/migrate-jsonb-to-tables.ts's
// backfill is still in flight. See that doc for the full design
// rationale (why OR not AND, why tileRepo/charterRepo.upsertMany are out
// of scope here).

// Read-only slice of each granular repo's real interface (server/persistence/
// repositories/*.ts) -- hydration never writes, so this only needs to
// structurally match whichever repo bag a caller passes: server/app/
// commandHandler.ts's own CommandDeps (heroRepo/settlementRepo/charterRepo
// fields, possibly mocked) or this file's own hydrateGame() wrapper (real
// Postgres-backed repos). Neither side needs to import the other's type.
export interface HeroRepoReader {
  loadAllForGame(gameName: string): Promise<HeroState[]>;
}
export interface SettlementRepoReader {
  loadAllForGame(gameName: string): Promise<SettlementState[]>;
}
export interface CharterRepoReader {
  loadAllForGame(gameName: string): Promise<CharterState[]>;
}

export interface HydrateRepos {
  heroRepo: HeroRepoReader;
  settlementRepo: SettlementRepoReader;
  charterRepo: CharterRepoReader;
}

export type HydrateSource = "granular" | "jsonb";

export interface HydrateResult {
  state: GameState;
  source: HydrateSource;
}

function byId<T extends { id: string }>(rows: T[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const row of rows) out[row.id] = row;
  return out;
}

// Distinct "telemetry" tag (not @heroes/engine's own [hydrateGameState]
// per-field warning prefix) so a fallback is easy to grep/alert on
// separately. Logged at most once per game per process -- otherwise every
// per-request hydration of a not-yet-migrated game would spam this.
const loggedFallbackGames = new Set<string>();
function logHydrateFallback(gameName: string): void {
  if (loggedFallbackGames.has(gameName)) return;
  loggedFallbackGames.add(gameName);
  console.info(
    `[hydrate] telemetry: game "${gameName}" fell back to legacy JSONB hydration (heroes/settlements granular tables empty)`,
  );
}

// Core algorithm, decoupled from any specific repo implementation (see
// HydrateRepos above) so both server/app/commandHandler.ts's per-request
// CommandDeps and this file's own hydrateGame() convenience wrapper can
// share it without either depending on the other.
export async function hydrateFromRepos(
  row: HydratableGameRow,
  repos: HydrateRepos,
  gameName: string,
): Promise<HydrateResult> {
  const [heroes, settlements] = await Promise.all([
    repos.heroRepo.loadAllForGame(gameName),
    repos.settlementRepo.loadAllForGame(gameName),
  ]);

  // OR, not AND: falls back the moment EITHER table is empty (not just
  // when both are), so a hypothetical partial write never silently
  // returns a GameState missing every hero or every settlement -- see
  // the plan doc for why that split shouldn't be reachable today anyway.
  if (heroes.length === 0 || settlements.length === 0) {
    logHydrateFallback(gameName);
    return { state: hydrateGameState(row), source: "jsonb" };
  }

  const charters = await repos.charterRepo.loadAllForGame(gameName);
  const state = hydrateGameState({
    ...row,
    heroes: byId(heroes),
    settlements: byId(settlements),
  });
  return { state: { ...state, activeCharters: charters }, source: "granular" };
}

// Standalone convenience wrapper for callers that only have a Queryable +
// a game name (e.g. test/persistence/hydrate.test.ts's round-trip check).
// server/app/commandHandler.ts does NOT use this itself -- it already has
// repo instances on CommandDeps bound to the same per-request pool/client
// its other repo calls use, and calls hydrateFromRepos directly against
// those instead of re-resolving a game row it already has via gameRepo.
export async function hydrateGame(db: Queryable, gameName: string): Promise<HydrateResult> {
  const row = await createGameRepo(db).load(gameName);
  const repos: HydrateRepos = {
    heroRepo: createHeroRepo(db),
    settlementRepo: createSettlementRepo(db),
    charterRepo: createCharterRepo(db),
  };
  return hydrateFromRepos(row, repos, gameName);
}
