// Faction BUILDING differentiation, measured rather than assumed.
//
// This suite pins ONLY the per-faction building differences that actually hold
// at the SHA that added it, read from the shipped data rather than the design
// prose: the engine's building registry (`getBuildingEffect` /
// `buildingAllowedForFaction`), the exhaustive BuildingKind list the
// `Record<BuildingKind, …>` sprite-coverage map enumerates, and the
// migration-built rows in this worktree's own database.
//
// A surface where two factions are NOT distinguishable is deliberately NOT
// asserted here — an assertion of sameness would freeze a gap as if it were
// the design. The one such surface for buildings (buildings of different
// factions that share byte-identical sprite bytes) is recorded in the
// measurement report's ESCALATIONS section instead; see
// analysis/2026-11-07-faction-building-differentiation.md.
//
// The recruit table is NOT re-measured here: #167 already pinned that each
// faction's troop buildings recruit exactly its own registry roster,
// exclusively and gated (test/data/factionCombatUnitDifferentiation.test.ts).
//
// The DB half follows test/data/unitCatalogParity.test.ts's convention:
// initSchema() in before() (idempotent — it runs at every server boot) so a
// fresh database's migration-built rows are present under plain tsx --test.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { BuildingKind, FactionId } from "@heroes/contracts";
import {
  BUILDING_SPRITE_COVERAGE,
  STARTER_TROOP_BUILDING_BY_FACTION,
  buildStarterLayout,
  buildingAllowedForFaction,
  getBuildingEffect,
  starterTroopBuilding,
} from "@heroes/engine";
import { pool } from "../../server/persistence/db";
import { initSchema } from "../../server/db";

before(async () => {
  await initSchema();
});

after(() => pool.end());

// The four factions a seat can play (contracts FactionId minus the neutral
// catalog-only bucket), spelled literally so the suite reads as the design
// claim.
const SEAT_FACTIONS = ["human", "ashen", "ironmark", "verdant"] as const;
const ALL_FACTIONS: readonly FactionId[] = [...SEAT_FACTIONS, "neutral"];

// Every BuildingKind, taken from a `Record<BuildingKind, …>` so the walk is
// exhaustive by construction: a new kind is a compile error in the coverage
// map before it can be a hole in this suite.
const ALL_BUILDING_KINDS = Object.keys(BUILDING_SPRITE_COVERAGE) as BuildingKind[];

// The measured sizes of each seat faction's buildable set, and the measured
// size of every pair's symmetric difference. These are the figures the report
// records; the assertions below hold them to exactly these values.
const MEASURED_SET_SIZE: Readonly<Record<(typeof SEAT_FACTIONS)[number], number>> = {
  human: 25,
  ashen: 24,
  ironmark: 25,
  verdant: 24,
};

const MEASURED_PAIR_DIFF: Readonly<Record<string, number>> = {
  "human|ashen": 13,
  "human|ironmark": 14,
  "human|verdant": 13,
  "ashen|ironmark": 13,
  "ashen|verdant": 12,
  "ironmark|verdant": 13,
};

function allowedKinds(factionId: FactionId): BuildingKind[] {
  return ALL_BUILDING_KINDS.filter((k) => buildingAllowedForFaction(k, factionId));
}

/** The kinds the registry tags with a faction — the buildings only it may raise. */
function ownKinds(factionId: FactionId): BuildingKind[] {
  return ALL_BUILDING_KINDS.filter((k) => getBuildingEffect(k).faction === factionId);
}

/** The kinds no faction owns — buildable by every seat. */
function sharedKinds(): BuildingKind[] {
  return ALL_BUILDING_KINDS.filter((k) => getBuildingEffect(k).faction === undefined);
}

function symdiff(a: readonly BuildingKind[], b: readonly BuildingKind[]): BuildingKind[] {
  const setA = new Set(a);
  const setB = new Set(b);
  return [...new Set([...a.filter((k) => !setB.has(k)), ...b.filter((k) => !setA.has(k))])];
}

// ── The building SET: each seat faction can build a different set ──

test("the four seat factions' buildable sets are pairwise distinct", () => {
  for (const f of SEAT_FACTIONS) {
    assert.equal(
      allowedKinds(f).length,
      MEASURED_SET_SIZE[f],
      `${f} must be able to build exactly ${MEASURED_SET_SIZE[f]} kinds`,
    );
  }

  for (let i = 0; i < SEAT_FACTIONS.length; i++) {
    for (let j = i + 1; j < SEAT_FACTIONS.length; j++) {
      const a = SEAT_FACTIONS[i];
      const b = SEAT_FACTIONS[j];
      const diff = symdiff(allowedKinds(a), allowedKinds(b));
      assert.equal(
        diff.length,
        MEASURED_PAIR_DIFF[`${a}|${b}`],
        `${a} and ${b} must differ by exactly ${MEASURED_PAIR_DIFF[`${a}|${b}`]} kinds, ` +
          `got ${diff.length}: ${diff.join(", ")}`,
      );
      assert.ok(diff.length > 0, `${a} and ${b} build the identical set — no faction differentiation`);
    }
  }
});

test("each faction's buildable set is exactly the shared kinds plus its own, and the two parts are disjoint", () => {
  const shared = new Set(sharedKinds());
  for (const f of SEAT_FACTIONS) {
    const own = ownKinds(f);
    for (const kind of own) {
      assert.equal(
        shared.has(kind),
        false,
        `${kind} is both a shared kind and a ${f}-only kind`,
      );
    }
    const expected = [...shared, ...own].sort();
    assert.deepEqual(
      [...allowedKinds(f)].sort(),
      expected,
      `${f}'s buildable set must be the shared kinds plus its own ${own.length}`,
    );
  }
});

test("the shared building core is exactly the faction-less kinds and every seat can build all of it", () => {
  const shared = sharedKinds();
  assert.ok(shared.length > 0, "there must be a shared core every faction builds");
  for (const kind of shared) {
    assert.equal(getBuildingEffect(kind).faction, undefined, `${kind} is not faction-less`);
    for (const f of ALL_FACTIONS) {
      assert.equal(
        buildingAllowedForFaction(kind, f),
        true,
        `${kind} (faction-less) must be buildable by ${f}`,
      );
    }
  }
});

// ── The building SET at game creation: the starter city differs by faction ──

test("the four factions' starter cities differ pairwise by exactly their faction troop building", () => {
  const kinds = new Map<FactionId, Set<BuildingKind>>();
  for (const f of SEAT_FACTIONS) {
    const layout = buildStarterLayout({ size: 10, style: "pixel", factionId: f, farms: 4 });
    kinds.set(f, new Set(layout.map((b) => b.kind)));
  }

  for (let i = 0; i < SEAT_FACTIONS.length; i++) {
    for (let j = i + 1; j < SEAT_FACTIONS.length; j++) {
      const a = SEAT_FACTIONS[i];
      const b = SEAT_FACTIONS[j];
      const setA = kinds.get(a)!;
      const setB = kinds.get(b)!;
      const onlyA = [...setA].filter((k) => !setB.has(k));
      const onlyB = [...setB].filter((k) => !setA.has(k));
      assert.deepEqual(
        onlyA,
        [STARTER_TROOP_BUILDING_BY_FACTION[a]],
        `${a}'s starter city must differ from ${b}'s by exactly its troop building`,
      );
      assert.deepEqual(
        onlyB,
        [STARTER_TROOP_BUILDING_BY_FACTION[b]],
        `${b}'s starter city must differ from ${a}'s by exactly its troop building`,
      );
      assert.equal(
        starterTroopBuilding(a),
        STARTER_TROOP_BUILDING_BY_FACTION[a],
        `starterTroopBuilding(${a}) must resolve to the faction's own entry`,
      );
    }
  }
});

// ── The faction axis the building gate is expressed in, as the DB enforces it ──

test("the DB's faction axis is exactly the contracts FactionId set", async () => {
  const check = await pool.query<{ def: string }>(
    "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'unit_types_faction_id_check'",
  );
  assert.equal(check.rows.length, 1, "unit_types must carry a faction_id CHECK constraint");
  const literals = [...check.rows[0].def.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(
    literals,
    [...ALL_FACTIONS].sort(),
    "the DB's faction vocabulary must be exactly the contracts FactionId set",
  );

  const present = await pool.query<{ faction_id: string }>(
    "SELECT DISTINCT faction_id FROM unit_types ORDER BY faction_id",
  );
  assert.deepEqual(
    present.rows.map((r) => r.faction_id),
    [...ALL_FACTIONS].sort(),
    "every faction in the vocabulary must have migration-built rows behind it",
  );
});
