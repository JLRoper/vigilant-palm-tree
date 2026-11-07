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
import { inflateSync } from "node:zlib";
import { BUILDING_ANCHOR_OVERRIDES } from "../../src/render/generated/buildingAnchorOverrides";
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

// ── The closed group's own footprint: cut to the iso lot, no plinth ──
//
// Uniqueness is not the only contract this change had to hit. The wave's cut
// (`design/arena-unit-sprites/collision-cut-building.mjs`) authors the new
// building on the same 1024x1024 `building-pixel-*` canvas as the family, and
// the measurements below are the ones that make it land where the city grid
// draws it:
//
//   - the sprite's own visible base IS the canvas' last row (bottom pad 0), so
//     `tools/sprites/gen-building-anchors.mjs` measures `anchorOffsetY: 0` and
//     `anchor: "bottom"` plants the lot's south vertex on its cell's south
//     vertex — a bottom pad floats the building above its cell;
//   - the lot's lower edges are fitted to the grid's dy/dx 0.5 (26.57 deg,
//     src/core/cityGrid.ts) and everything below them is cleared, so no soil
//     SLAB/plinth lifts the lot plane off its cell;
//   - the lot keeps the family's footprint scale (the shipped 1x1 lots measure
//     0.84-0.92 of the canvas width), so it draws at the same size as its
//     neighbours' lots instead of spilling to the cell edge.
//
// The measured numbers are the shipped sprite's own (the cut helper prints
// them); the tolerances are wide enough for a legitimate re-cut and narrow
// enough to catch a plinth, a float or a mis-fitted lot.

/**
 * A minimal PNG reader: 8-bit, non-interlaced, RGB or RGBA — which is what the
 * shipped building art is. It exists instead of a `pngjs` import because the
 * test tree's type gate (`npm run test:types`) counts untyped module imports as
 * debt, and a sprite-geometry assertion is not worth a baseline entry.
 */
function readPng(buf: Buffer): { width: number; height: number; alpha: (x: number, y: number) => number } {
  assert.equal(buf.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "not a PNG file");
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat: Buffer[] = [];
  for (let offset = 8; offset + 8 <= buf.length; ) {
    const length = buf.readUInt32BE(offset);
    const type = buf.subarray(offset + 4, offset + 8).toString("ascii");
    const body = buf.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      bitDepth = body[8];
      colorType = body[9];
      interlace = body[12];
    } else if (type === "IDAT") {
      idat.push(body);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  assert.equal(bitDepth, 8, "building art is authored 8-bit");
  assert.equal(interlace, 0, "building art is not interlaced");
  assert.ok(colorType === 6 || colorType === 2, `unsupported PNG colour type ${colorType}`);
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idat));
  assert.equal(raw.length, height * (stride + 1), "unexpected PNG payload length");
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y === 0 ? Buffer.alloc(stride) : pixels.subarray((y - 1) * stride, y * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? out[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let value = line[i];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a);
        const pb = Math.abs(pp - b);
        const pc = Math.abs(pp - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[i] = value & 0xff;
    }
  }
  return {
    width,
    height,
    alpha: (x, y) => (channels === 4 ? pixels[y * stride + x * channels + 3] : 255),
  };
}

const RAMPENS_LOT = {
  canvas: 1024,
  /** alpha above this counts as opaque — gen-building-anchors.mjs's own threshold. */
  alphaThreshold: 10,
  /** rows of fully transparent margin at the bottom: 0 means the base IS the last row. */
  bottomPadRows: 0,
  /** the grid's cell-edge slope, which the lot's lower edges are fitted to. */
  lowerEdgeDydx: 0.5,
  lowerEdgeTolerance: 0.02,
  /** the family band for a 1x1 building lot's width, as a fraction of the canvas. */
  lotWidthBand: [0.8, 0.9] as const,
};

test("the ramPens lot is cut to the iso footprint: base on the last row, 2:1 edges, no plinth", () => {
  const png = readPng(readFileSync(buildingSpritePath("pixel.ramPens.1")));
  const { width, height } = png;
  assert.equal(width, RAMPENS_LOT.canvas, "the building-pixel family is authored on a 1024 canvas");
  assert.equal(height, RAMPENS_LOT.canvas, "the building-pixel family canvas is square");

  const opaque = (x: number, y: number): boolean => png.alpha(x, y) > RAMPENS_LOT.alphaThreshold;
  const rowOpaque = (y: number): boolean => {
    for (let x = 0; x < width; x++) if (opaque(x, y)) return true;
    return false;
  };

  let bottom = height - 1;
  while (bottom >= 0 && !rowOpaque(bottom)) bottom--;
  assert.equal(
    height - 1 - bottom,
    RAMPENS_LOT.bottomPadRows,
    "the sprite's own base must be the canvas' last row, or the rendered lot floats above its cell's south vertex",
  );

  assert.equal(
    BUILDING_ANCHOR_OVERRIDES["pixel.ramPens.1"],
    0,
    "a lot whose base is the last row measures anchorOffsetY 0 — the generated anchor table must say so",
  );

  // The lot's lower edges, fitted over the bottom third of the sprite's CONTENT
  // (the ground only: a fit that reaches the pen walls is contaminated by them,
  // and reports a diamond far steeper than the lot is).
  let top = 0;
  while (top < height && !rowOpaque(top)) top++;
  const bandTop = bottom - Math.round((bottom - top + 1) * 0.3);
  const rows: { y: number; left: number; right: number }[] = [];
  for (let y = bandTop; y <= bottom; y++) {
    let left = -1;
    let right = -1;
    for (let x = 0; x < width; x++) {
      if (!opaque(x, y)) continue;
      if (left < 0) left = x;
      right = x;
    }
    if (left >= 0) rows.push({ y, left, right });
  }
  assert.ok(rows.length > 50, `expected the lot's lower band to be measurable, got ${rows.length} rows`);
  const edgeSlope = (side: "left" | "right"): number => {
    const n = rows.length;
    const my = rows.reduce((s, r) => s + r.y, 0) / n;
    const mx = rows.reduce((s, r) => s + r[side], 0) / n;
    let num = 0;
    let den = 0;
    for (const r of rows) {
      num += (r.y - my) * (r[side] - mx);
      den += (r.y - my) ** 2;
    }
    return Math.abs(num / den);
  };
  // `edgeSlope` is dx/dy (x per row); the grid talks in dy/dx, so invert each
  // edge and average the two.
  const dydx = (1 / edgeSlope("left") + 1 / edgeSlope("right")) / 2;
  assert.ok(
    Math.abs(dydx - RAMPENS_LOT.lowerEdgeDydx) <= RAMPENS_LOT.lowerEdgeTolerance,
    `the lot's lower edges measure dy/dx ${dydx.toFixed(4)} (${((Math.atan(dydx) * 180) / Math.PI).toFixed(2)} deg) — ` +
      `the city grid descends at ${RAMPENS_LOT.lowerEdgeDydx} (26.57 deg), so the lot must be fitted to it`,
  );

  // The widest row is the ground diamond's own width: the family footprint scale.
  let widest = 0;
  for (let y = 0; y < height; y++) {
    let n = 0;
    for (let x = 0; x < width; x++) if (opaque(x, y)) n++;
    if (n > widest) widest = n;
  }
  const fraction = widest / width;
  assert.ok(
    fraction >= RAMPENS_LOT.lotWidthBand[0] && fraction <= RAMPENS_LOT.lotWidthBand[1],
    `the lot spans ${fraction.toFixed(3)} of the canvas — a 1x1 building lot ships in ` +
      `[${RAMPENS_LOT.lotWidthBand[0]}, ${RAMPENS_LOT.lotWidthBand[1]}] so it draws at its neighbours' scale`,
  );
});
