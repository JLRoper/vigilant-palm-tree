// Parity pins for the faction registry (faction-registry foundation):
// FACTION_REGISTRY rosters vs the shared 16-id list, vs the unit_types DB
// column, and the banner-file assertion the glob-driven FACTION_BANNERS map
// needs. assetDescriptors.ts is Vite-?url-coupled and cannot be imported
// under bare node:test, so the banner is checked from the filesystem the
// same way unitIcons.coverage.test.ts checks icon coverage.
//
// The DB half runs initSchema() in before() (the same convention as
// test/server/eventStreamRoute.test.ts): tests run under plain tsx --test
// with no server boot, and initSchema() is idempotent by design (it runs at
// every server start), so this is the cheap way to guarantee migration
// 023's faction_id column is in place on a fresh DB.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { FactionId, UnitType } from "@heroes/contracts";
import { FACTION_REGISTRY, validateUnitCatalogFactions } from "@heroes/engine";
import { pool } from "../../server/persistence/db";
import { initSchema } from "../../server/db";
import { UNIT_CATALOG_IDS } from "../helpers/unitIds";

before(async () => {
  await initSchema();
});

after(() => pool.end());

const ALL_ROSTER_IDS = Object.values(FACTION_REGISTRY).flatMap((f) => [...f.roster]);

test("registry rosters union equals the shared 16-id catalog list", () => {
  assert.deepEqual([...ALL_ROSTER_IDS].sort(), [...UNIT_CATALOG_IDS].sort());
});

test("every catalog id appears in exactly one roster", () => {
  const counts = new Map<string, number>();
  for (const id of ALL_ROSTER_IDS) counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const id of UNIT_CATALOG_IDS) {
    assert.equal(counts.get(id), 1, `${id} must appear exactly once across rosters, got ${counts.get(id) ?? 0}`);
  }
});

test("neutral shares no id with any seat-faction roster", () => {
  const neutral = new Set(FACTION_REGISTRY.neutral.roster);
  for (const f of Object.values(FACTION_REGISTRY)) {
    if (f.id === "neutral") continue;
    for (const id of f.roster) {
      assert.ok(!neutral.has(id), `${id} is in both the neutral roster and ${f.id}'s`);
    }
  }
});

// A faction that has SHIPPED content (a non-empty roster) must have its
// banner file — this is the test-time replacement for plan D6's compile-time
// record: a faction plan that fills FACTION_REGISTRY.<id>.roster without
// landing `faction-banner-<id>.png` in the same change fails here, because
// the glob-driven FACTION_BANNERS map would silently not resolve it. The
// empty-roster placeholder entries (ashen/ironmark/verdant at foundation)
// are exempt until their content plans land; "neutral" is never a seat
// choice and carries no banner.
test("every faction with a shipped roster has a banner file on disk", () => {
  for (const f of Object.values(FACTION_REGISTRY)) {
    if (f.id === "neutral") continue;
    if (f.roster.length === 0) continue;
    const file = resolve(
      process.cwd(),
      "src",
      "resources",
      "factions",
      `faction-banner-${f.id}.png`,
    );
    assert.ok(
      existsSync(file),
      `${f.id} ships a roster but has no banner (expected ${file}) — the glob-driven FACTION_BANNERS map would not resolve it`,
    );
  }
});

test("the unit_types.faction_id column matches the registry rosters (migration 023)", async () => {
  const r = await pool.query<{ id: string; faction_id: string }>(
    "SELECT id, faction_id FROM unit_types",
  );
  const rows = r.rows.map((row) => ({ ...row, faction_id: row.faction_id as FactionId }));

  assert.deepEqual(
    rows.map((row) => row.id).sort(),
    [...UNIT_CATALOG_IDS].sort(),
    "every shared catalog id is a unit_types row",
  );

  const byFaction = new Map<FactionId, string[]>(Object.values(FACTION_REGISTRY).map((f) => [f.id, [] as string[]]));
  for (const row of rows) byFaction.get(row.faction_id)?.push(row.id);
  for (const f of Object.values(FACTION_REGISTRY)) {
    assert.deepEqual(
      [...(byFaction.get(f.id) ?? [])].sort(),
      [...f.roster].sort(),
      `unit_types rows tagged ${f.id} must equal FACTION_REGISTRY.${f.id}.roster`,
    );
  }

  const catalogRows = rows.map(
    (row) => ({ id: row.id, factionId: row.faction_id }) as UnitType,
  );
  assert.deepEqual(
    validateUnitCatalogFactions(catalogRows),
    [],
    "D7: every catalog row's factionId is a valid roster faction id",
  );
});