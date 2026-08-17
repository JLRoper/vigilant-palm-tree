import { hydrateGameState } from "@heroes/engine";
import type { HydratableGameRow } from "@heroes/engine";
import type { CharterState, GameState, HeroState, SettlementState } from "@heroes/contracts";
import { createGameRepo } from "./repositories/gameRepo";
import type { Queryable } from "./repositories/gameRepo";
import { createHeroRepo } from "./repositories/heroRepo";
import { createSettlementRepo } from "./repositories/settlementRepo";
import { createCharterRepo } from "./repositories/charterRepo";

// Phase 4 Track A (plan/2026-08-17-phase-4-db-deblobbing-dev-plan.md,
// "Dual-write & read-path design"). Granular-first, per-game JSONB fallback:
// a game whose heroes/settlements granular tables are EITHER still empty
// hasn't been dual-written to yet (created before this phase shipped) or
// hasn't been reached by scripts/migrate-jsonb-to-tables.ts's backfill --
// either way, games.heroes/games.settlements JSONB (read via the unchanged
// @heroes/engine hydrateGameState) remains correct for it. Once BOTH
// granular tables have rows, both are trusted, and activeCharters comes from
// the real `charters` table instead of hydrateGameState's own `?? []`
// default -- see packages/engine/src/hydrate.ts:159's comment on why that
// default existed in the first place (no charters table existed before
// server/migrations/009_granular_entities.sql).
//
// This is a per-game check, not a global flag, by design: it lets the
// backfill script migrate games incrementally without a single cutover
// moment where every in-flight game needs to already be migrated.
//
// Deliberately does NOT read tileRepo. Tiles (server/schema.sql) are
// map-generation-time data -- never part of GameState -- so they have no
// bearing on hydration; see server/persistence/repositories/tileRepo.ts's
// own "read wrapper" framing (nothing consumes it yet either).
//
// Deliberately does NOT wire charterRepo.upsertMany anywhere (there is no
// write side to this repo in Phase 4 Track A's scope) -- nothing produces a
// non-empty activeCharters yet (StartCharter/AdvanceCharter aren't ported;
// see plan/2026-08-17-phase-4-db-deblobbing-dev-plan.md's "What this doc
// does NOT cover"). Reading charterRepo here still does real work today: it
// makes the eventual StartCharter/AdvanceCharter port a read-side no-op
// (the table + read wiring already exist) instead of a hydrate.ts change.

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
// separately from routine missing-field backfills -- once
// scripts/migrate-jsonb-to-tables.ts's backfill is expected to have reached
// every game, any further fallback logged here means something's actually
// wrong (a game the backfill missed, or a dual-write bug that silently
// never populated the granular tables for a newly created game).
function logHydrateFallback(gameName: string): void {
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
  const [heroes, settlements, charters] = await Promise.all([
    repos.heroRepo.loadAllForGame(gameName),
    repos.settlementRepo.loadAllForGame(gameName),
    repos.charterRepo.loadAllForGame(gameName),
  ]);

  // OR, not AND: falls back the moment EITHER table is empty, not only when
  // both are. A pre-migration game has zero rows in both (the common case
  // this guards), but this is also the defensive choice against a game
  // that somehow ended up with only one side populated -- dual-write always
  // upserts both heroRepo and settlementRepo together inside the same DB
  // transaction as the JSONB write (see server/app/commandHandler.ts's
  // dualWriteEntities + scripts/migrate-jsonb-to-tables.ts's backfillGame,
  // both single-transaction), so that split shouldn't be reachable today --
  // but if it ever were, silently hydrating one real table alongside an
  // empty record for the other would be a much worse failure mode (looks
  // like the game just lost every settlement/hero) than staying on the
  // JSONB row, which dual-write keeps fully correct throughout Phase 4
  // regardless of which path a given read takes.
  if (heroes.length === 0 || settlements.length === 0) {
    logHydrateFallback(gameName);
    return { state: hydrateGameState(row), source: "jsonb" };
  }

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
