// One-off CLI backfill (plan/2026-08-17-phase-4-db-deblobbing-dev-plan.md):
// populates the granular heroes/settlements tables (server/migrations/
// 009_granular_entities.sql) from games.heroes/games.settlements' existing
// JSONB blobs, for every game that predates Phase 4's dual-write.
//
// Idempotent: each game is upserted via heroRepo/settlementRepo's own
// full-sync upsertMany (ON CONFLICT DO UPDATE, deleting anything not in the
// given record) -- re-running this script against the same JSONB source
// always converges to the same rows, safe to run again after any game is
// created or updated between runs.
//
// One transaction per game, not one global transaction over the whole
// table: a single game's migration failure (malformed JSONB, an FK a
// hand-edited row violates, etc.) shouldn't roll back every other game's.
//
// activeCharters is deliberately NOT backfilled here: no JSONB source for it
// exists anywhere (packages/engine/src/hydrate.ts:159 has always defaulted
// it to [] -- see the doc's "gap #1"), so historical games correctly get
// zero charter rows. Calling charterRepo.upsertMany(name, []) here would be
// actively harmful on a second run: upsertMany is a full sync, so it would
// silently wipe any real charters a later StartCharter port has since
// created for that game.
//
// Usage:
//   npm run migrate:jsonb-to-tables                # every game in the table
//   npm run migrate:jsonb-to-tables -- game-a game-b  # just these games

import { pathToFileURL } from "node:url";
import { pool, withTransaction } from "../server/persistence/db";
import { createGameRepo } from "../server/persistence/repositories/gameRepo";
import { createHeroRepo } from "../server/persistence/repositories/heroRepo";
import { createSettlementRepo } from "../server/persistence/repositories/settlementRepo";

async function listAllGameNames(): Promise<string[]> {
  const r = await pool.query<{ name: string }>("SELECT name FROM games ORDER BY id ASC");
  return r.rows.map((row) => row.name);
}

export async function backfillGame(name: string): Promise<void> {
  await withTransaction(async (client) => {
    const row = await createGameRepo(client).load(name);
    await createHeroRepo(client).upsertMany(name, row.heroes);
    await createSettlementRepo(client).upsertMany(name, row.settlements);
  });
}

async function main(): Promise<void> {
  const explicitNames = process.argv.slice(2);
  const names = explicitNames.length > 0 ? explicitNames : await listAllGameNames();

  let ok = 0;
  let failed = 0;
  for (const name of names) {
    try {
      await backfillGame(name);
      ok++;
      console.log(`[migrate-jsonb-to-tables] ${name}: OK`);
    } catch (err) {
      failed++;
      console.error(`[migrate-jsonb-to-tables] ${name}: FAILED`, err);
    }
  }

  console.log(`[migrate-jsonb-to-tables] done: ${ok} ok, ${failed} failed, ${names.length} total`);
  await pool.end();
  if (failed > 0) process.exitCode = 1;
}

// Guards against running main() when this module is imported (e.g. by
// test/migrations/migration.test.ts, which calls backfillGame directly)
// rather than executed as a CLI script. pathToFileURL (not manual string
// concatenation) so the comparison is correct on Windows drive-letter paths
// too, not just POSIX ones.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
