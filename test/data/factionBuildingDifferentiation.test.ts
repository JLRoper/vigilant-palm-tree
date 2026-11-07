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
// asserted here as SAMENESS — an assertion of that kind would freeze a gap as
// if it were the design. The one such surface for buildings (buildings of
// different factions that share byte-identical sprite bytes) is pinned at the
// foot of this file as a LEDGER instead: every duplicate group still
// outstanding is declared there, the measured set must equal the declaration,
// and a closed group's row is deleted. Source measurement:
// analysis/2026-11-07-faction-building-differentiation.md (§E1).
//
// The recruit table is NOT re-measured here: #167 already pinned that each
// faction's troop buildings recruit exactly its own registry roster,
// exclusively and gated (test/data/factionCombatUnitDifferentiation.test.ts).
//
// The DB half follows test/data/unitCatalogParity.test.ts's convention:
// initSchema() in before() (idempotent — it runs at every server boot) so a
// fresh database's migration-built rows are present under plain tsx --test.

import { test, before, after } from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import type { BuildingKind, FactionId } from "@heroes/contracts";
import {
  BUILDING_SPRITE_COVERAGE,
  BUILDING_SPRITE_FILES,
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

// ── Sprites: the building art each faction is DRAWN with ──
//
// The measurement report's ESCALATION E1 is the buildings-side twin of the
// units gap pinned in test/data/factionCombatUnitDifferentiation.test.ts:
// buildings of two different factions shipping byte-identical PNGs, plus six
// within-faction copies. Source of every copy and the placeholder convention:
// design/arena-unit-sprites/roster-parity-placeholder-art.md §Buildings;
// measurement: analysis/2026-11-07-faction-building-differentiation.md §E1.
//
// Same rule as the unit suite: this is a LEDGER, not one assertion. Every
// duplicate group still outstanding is declared below and the measured set must
// EQUAL the ledger, so the list can only shrink — landing unique art for a group
// deletes its row, and a row may not be added back. Two buildings shipping one
// file's bytes again fails these tests with both asset paths named.
//
// Scope is the REGISTERED pixel family (BUILDING_SPRITE_FILES): it is what the
// client resolves, and the legacy building-classic-* / building-blocky-* /
// *-raw / *-variant* files that sit in the same folder are deliberately not
// shipped art.

const BUILDINGS_DIR = resolve(process.cwd(), "src", "resources", "buildings");

/** One registered building sprite: its key (`pixel.<kind>.<level>`), kind, faction and file. */
const BUILDING_SPRITES: readonly {
  key: string;
  kind: BuildingKind;
  faction: FactionId | undefined;
  path: string;
}[] = Object.entries(BUILDING_SPRITE_FILES).map(([key, file]) => {
  const kind = key.split(".")[1] as BuildingKind;
  // A farm STYLE key (`pixel.farmWheat.1`) and `pixel.underConstruction.1` are
  // registered sprite keys whose "kind" is not a registry BuildingKind:
  // getBuildingEffect returns undefined for them, and they are shared art.
  const effect = getBuildingEffect(kind as BuildingKind) as { faction?: FactionId } | undefined;
  return { key, kind, faction: effect?.faction, path: resolve(BUILDINGS_DIR, file) };
});

function buildingSpriteBytes(key: string): Buffer {
  const sprite = BUILDING_SPRITES.find((s) => s.key === key);
  assert.ok(sprite, `no registered building sprite "${key}"`);
  return readFileSync(sprite.path);
}

function contentHash(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/** A registered key's on-disk path, for failure messages. */
function buildingSpritePath(key: string): string {
  return BUILDING_SPRITES.find((s) => s.key === key)?.path ?? `(unregistered key ${key})`;
}

/**
 * The duplicate-byte groups in the registered building family, measured by
 * content hash. Members and groups are sorted, so the comparison against the
 * ledger is order-independent.
 */
function buildingDuplicateGroups(): string[][] {
  const byHash = new Map<string, string[]>();
  for (const sprite of BUILDING_SPRITES) {
    const hash = contentHash(readFileSync(sprite.path));
    const bucket = byHash.get(hash);
    if (bucket) bucket.push(sprite.key);
    else byHash.set(hash, [sprite.key]);
  }
  return [...byHash.values()]
    .filter((keys) => keys.length > 1)
    .map((keys) => [...keys].sort())
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

function normalizeBuildingLedger(groups: readonly (readonly string[])[]): string[][] {
  return [...groups]
    .map((keys) => [...keys].sort())
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

/**
 * The duplicate-byte groups this repository still ships in the registered
 * building family, measured 2026-11-07 against main 0.53.21 and left as art work
 * by the card that closed the cross-faction pair.
 *
 * Every remaining row is WITHIN a single faction — one sprite deliberately
 * reused by two of that faction's own buildings, the same placeholder debt the
 * 2026-10-22 roster expansion created (roster-parity-placeholder-art.md). Those
 * are reuse, not a two-factions-look-alike gap: they are declared here and stay
 * declared.
 *
 * The CROSS-faction row this ledger used to carry — `ramPens = stables`
 * (`building-pixel-ramPens-1.png` byte-identical to
 * `building-pixel-stables-1.png`, ironmark copying human) — was closed by giving
 * the COPIER its own art, so its row is DELETED here. The measured set must
 * equal this list, so that pair can no longer collide without failing these
 * tests, and the distinctness tests below name both paths when it does.
 */
const OUTSTANDING_BUILDING_DUPLICATE_GROUPS: readonly (readonly string[])[] = [
  // ashen: blackChapel copied spireOfAsh, dragonBoneyard copied ossuary
  ["pixel.blackChapel.1", "pixel.spireOfAsh.1"],
  ["pixel.dragonBoneyard.1", "pixel.ossuary.1"],
  // ironmark: deepAnvil copied hearthTemple, delversHall copied forgeHall
  ["pixel.deepAnvil.1", "pixel.hearthTemple.1"],
  ["pixel.delversHall.1", "pixel.forgeHall.1"],
  // verdant: druidCircle copied worldrootGrove, groveSanctum copied seedlingGrove
  ["pixel.druidCircle.1", "pixel.worldrootGrove.1"],
  ["pixel.groveSanctum.1", "pixel.seedlingGrove.1"],
];

test("every duplicate-byte group in the registered building family is declared in the ledger", () => {
  const measured = buildingDuplicateGroups();
  const declared = normalizeBuildingLedger(OUTSTANDING_BUILDING_DUPLICATE_GROUPS);

  const declaredKeys = new Set(declared.map((keys) => keys.join("|")));
  const measuredKeys = new Set(measured.map((keys) => keys.join("|")));

  const regressions = measured.filter((keys) => !declaredKeys.has(keys.join("|")));
  assert.deepEqual(
    regressions.map((keys) => keys.map((key) => buildingSpritePath(key)).join(" == ")),
    [],
    "two buildings ship the same sprite bytes and no ledger row declares it — " +
      "land one of them its own art, or the collision is a regression",
  );

  const closed = declared.filter((keys) => !measuredKeys.has(keys.join("|")));
  assert.deepEqual(
    closed.map((keys) => keys.join(" = ")),
    [],
    "the building ledger declares a group that is no longer a collision — " +
      "delete its row here so the ledger keeps shrinking toward empty",
  );
});

test("every remaining duplicate-byte group is within one faction, not a cross-faction collision", () => {
  for (const keys of normalizeBuildingLedger(OUTSTANDING_BUILDING_DUPLICATE_GROUPS)) {
    const factions = new Set(
      keys.map((key) => BUILDING_SPRITES.find((s) => s.key === key)?.faction ?? "shared"),
    );
    assert.equal(
      factions.size,
      1,
      `the declared group [${keys.join(", ")}] spans ${[...factions].join(" and ")} — ` +
        "the ledger declares within-faction reuse only",
    );
  }
});

test("no two building kinds of different factions ship the same sprite bytes", () => {
  // The assertion analysis/2026-11-07-faction-building-differentiation.md §E1
  // deliberately deferred until unique art landed: with `ramPens = stables`
  // differentiated, no two factions — and no faction against the shared,
  // faction-less kinds — may share a building PNG.
  for (let i = 0; i < BUILDING_SPRITES.length; i++) {
    for (let j = i + 1; j < BUILDING_SPRITES.length; j++) {
      const a = BUILDING_SPRITES[i];
      const b = BUILDING_SPRITES[j];
      if (a.faction === b.faction) continue;
      assert.notEqual(
        contentHash(readFileSync(a.path)),
        contentHash(readFileSync(b.path)),
        `${a.path} and ${b.path} are still one file — ${a.kind} (${a.faction ?? "shared"}) ` +
          `and ${b.kind} (${b.faction ?? "shared"}) must not ship the same building art`,
      );
    }
  }
});

// The one CROSS-faction pair this change closed, pinned by the paths of the
// assets it rewrote: the COPIER (roster-parity-placeholder-art.md §Buildings —
// ramPens's source is stables) got its own art and the ORIGINAL was left alone.
test("the ironmark ramPens / human stables collision this change closed ships unique art", () => {
  assert.notEqual(
    contentHash(buildingSpriteBytes("pixel.ramPens.1")),
    contentHash(buildingSpriteBytes("pixel.stables.1")),
    `${buildingSpritePath("pixel.ramPens.1")} and ${buildingSpritePath("pixel.stables.1")} ` +
      "are still one file — the ironmark ram pens must not ship the human stable's sprite",
  );
});
