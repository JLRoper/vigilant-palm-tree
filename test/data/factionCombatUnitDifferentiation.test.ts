// Faction combat-unit DIFFERENTIATION, measured rather than assumed.
//
// This suite pins ONLY the per-faction differences that actually hold at the
// SHA that added it, read from the shipped data rather than the design prose:
// the engine's FACTION_REGISTRY rosters, the unit_types catalog the SQL
// migrations build, and the building registry's recruit table. A surface where
// two factions are NOT distinguishable is deliberately NOT asserted here — an
// assertion of sameness would freeze a gap as if it were the design. The one
// such surface for combat units (units of different factions that share
// the exact same sprite bytes) is measured in the SPRITES section at the foot of
// this file, as a LEDGER: every duplicate group still outstanding is declared
// there, the assertion is that the measured set equals the ledger, and landing
// unique art for a group deletes its row. Source measurement, and the full
// remaining list as one card per group:
// analysis/2026-11-07-faction-combat-unit-differentiation.md.
//
// The DB half follows test/data/unitCatalogParity.test.ts's convention:
// initSchema() in before() (idempotent — it runs at every server boot) so a
// fresh database's migration-built catalog is present under plain tsx --test.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { inflateSync } from "node:zlib";
import type { BuildingKind, FactionId } from "@heroes/contracts";
import {
  FACTION_REGISTRY,
  buildingAllowedForFaction,
  getBuildingEffect,
} from "@heroes/engine";
import { pool } from "../../server/persistence/db";
import { initSchema } from "../../server/db";
import { UNIT_CATALOG_IDS } from "../helpers/unitIds";

before(async () => {
  await initSchema();
});

after(() => pool.end());

// The four factions a seat can play (contracts FactionId minus the neutral
// catalog-only bucket). SEAT_FACTION_IDS is the engine's own statement of this
// rule; it is spelled literally here so the suite reads as the design claim,
// and cross-checked against the engine export below.
const SEAT_FACTIONS = ["human", "ashen", "ironmark", "verdant"] as const;
const ALL_FACTIONS: readonly FactionId[] = [...SEAT_FACTIONS, "neutral"];

// Every BuildingKind, so the recruit table can be walked without a runtime
// kind list (the registry exposes lookups, not an enumerable keys array).
const ALL_BUILDING_KINDS: BuildingKind[] = [
  "townHall", "house", "tower", "mageGuild", "mine", "stoneMine", "ironMine",
  "market", "barracks", "smithy", "apartment", "farmField", "farmhouse",
  "archeryRange", "granary", "warehouse", "bank", "treasury", "goldMine",
  "woodcutterHut", "arcaneFont", "shipyard", "stables", "huntingLodge", "eyrie",
  "crypt", "ossuary", "wraithBarrows", "spireOfAsh", "forgeHall",
  "gunnersRedoubt", "golemFoundry", "deepAnvil", "groveSanctum", "warrenLodge",
  "sylvanStables", "worldrootGrove", "blackChapel", "dragonBoneyard",
  "delversHall", "hearthTemple", "ramPens", "seedlingGrove", "druidCircle",
];

type CatalogRow = {
  id: string;
  faction_id: FactionId;
  attack: number;
  defence: number;
  health: number;
  speed: number;
  range: number;
  advantage_type: string;
  tier: number | null;
};

// A unit's whole combat identity as the resolver sees it: the four stats the
// battle auto-resolver scores with (attack + defence are unitPower, health and
// speed decide order), the triangle tag, and the arena reach. Two units with
// the same line are mechanically interchangeable in a fight.
function combatLine(r: CatalogRow): string {
  return `${r.attack}/${r.defence}/${r.health}/${r.speed}/${r.advantage_type}/r${r.range}`;
}

function countBy<T extends string | number>(values: readonly T[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) {
    const k = String(v);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

// ── Unit set: each seat faction ships its own twelve, and no unit is shared ──

test("the four seat factions field twelve units each and share none between them", () => {
  const seen = new Map<string, FactionId>();
  for (const f of SEAT_FACTIONS) {
    const roster = [...FACTION_REGISTRY[f].roster];
    assert.equal(roster.length, 12, `${f} must field twelve units`);
    assert.equal(new Set(roster).size, 12, `${f}'s roster must not repeat an id`);
    for (const id of roster) {
      assert.equal(
        seen.has(id),
        false,
        `unit ${id} is claimed by both ${seen.get(id)} and ${f} — the seat rosters must be disjoint`,
      );
      seen.set(id, f);
    }
  }
  assert.equal(seen.size, 48, "four seat factions x twelve units each, all distinct");
});

test("every unit id in a seat roster belongs to exactly that faction, and neutral is seat-free", () => {
  const neutral = new Set(FACTION_REGISTRY.neutral.roster);
  for (const f of SEAT_FACTIONS) {
    for (const id of FACTION_REGISTRY[f].roster) {
      assert.ok(!neutral.has(id), `${id} is in both the ${f} roster and the neutral catalog`);
    }
  }
});

// ── Stats: the DB catalog each faction's units are built from ──

async function seatCatalog(): Promise<CatalogRow[]> {
  const { rows } = await pool.query<CatalogRow>(
    "SELECT id, faction_id, attack, defence, health, speed, range, advantage_type, tier FROM unit_types",
  );
  return rows.filter((r) => (SEAT_FACTIONS as readonly string[]).includes(r.faction_id));
}

test("the DB roster of each faction is exactly its registry roster", async () => {
  const rows = await seatCatalog();
  for (const f of SEAT_FACTIONS) {
    const dbIds = rows.filter((r) => r.faction_id === f).map((r) => r.id).sort();
    assert.deepEqual(
      dbIds,
      [...FACTION_REGISTRY[f].roster].sort(),
      `unit_types rows tagged ${f} must equal FACTION_REGISTRY.${f}.roster`,
    );
  }
});

test("every seat faction's roster covers the whole 1-7 ladder and every triangle type", async () => {
  const rows = await seatCatalog();
  const TYPES = ["infantry", "cavalry", "ranged", "monster"];
  for (const f of SEAT_FACTIONS) {
    const mine = rows.filter((r) => r.faction_id === f);
    const tiers = new Set(mine.map((r) => r.tier));
    assert.deepEqual(
      [...tiers].sort((a, b) => Number(a) - Number(b)),
      [1, 2, 3, 4, 5, 6, 7],
      `${f} must field at least one unit at every tier band 1-7`,
    );
    const types = new Set(mine.map((r) => r.advantage_type));
    for (const t of TYPES) {
      assert.ok(types.has(t), `${f} fields no ${t} unit — its arms would miss a triangle leg`);
    }
  }
});

test("no faction repeats a combat stat line inside its own roster", async () => {
  const rows = await seatCatalog();
  for (const f of SEAT_FACTIONS) {
    const mine = rows.filter((r) => r.faction_id === f);
    const lines = mine.map(combatLine);
    assert.equal(
      new Set(lines).size,
      mine.length,
      `${f} repeats a stat line within its roster: ${lines.join(", ")}`,
    );
  }
});

test("the four factions' tier ladders are pairwise distinct", async () => {
  const rows = await seatCatalog();
  const sig = new Map<FactionId, string>();
  for (const f of SEAT_FACTIONS) {
    const counts = countBy(rows.filter((r) => r.faction_id === f).map((r) => r.tier ?? "none"));
    sig.set(f, JSON.stringify(counts));
  }
  const signatures = [...sig.values()];
  assert.equal(
    new Set(signatures).size,
    SEAT_FACTIONS.length,
    `two factions share a tier ladder (a same-shaped army): ${[...sig].map(([f, s]) => `${f}=${s}`).join(" ")}`,
  );
});

test("the four factions' advantage-type mixes are pairwise distinct", async () => {
  const rows = await seatCatalog();
  const sig = new Map<FactionId, string>();
  for (const f of SEAT_FACTIONS) {
    const counts = countBy(rows.filter((r) => r.faction_id === f).map((r) => r.advantage_type));
    sig.set(f, JSON.stringify(counts));
  }
  const signatures = [...sig.values()];
  assert.equal(
    new Set(signatures).size,
    SEAT_FACTIONS.length,
    `two factions share an arm mix: ${[...sig].map(([f, s]) => `${f}=${s}`).join(" ")}`,
  );
});

// ── Buildings: what each faction can actually raise its troops from ──

test("each faction's troop buildings recruit exactly its own registry roster", () => {
  const troopBuildings = new Map<FactionId, BuildingKind[]>();
  for (const f of SEAT_FACTIONS) troopBuildings.set(f, []);
  for (const kind of ALL_BUILDING_KINDS) {
    const eff = getBuildingEffect(kind);
    if (eff.recruits.length === 0) continue;
    assert.ok(eff.faction, `${kind} recruits units but carries no faction — it would leak into every roster`);
    troopBuildings.get(eff.faction as FactionId)?.push(kind);
  }
  for (const f of SEAT_FACTIONS) {
    const recruits = troopBuildings
      .get(f)!
      .flatMap((kind) => getBuildingEffect(kind).recruits.map((e) => e.unitTypeId));
    assert.deepEqual(
      [...new Set(recruits)].sort(),
      [...FACTION_REGISTRY[f].roster].sort(),
      `${f}'s troop buildings must offer exactly its registry roster`,
    );
  }
});

test("no troop building is shared between factions and each is gated to its owner", () => {
  const owner = new Map<BuildingKind, FactionId>();
  for (const f of SEAT_FACTIONS) {
    for (const kind of ALL_BUILDING_KINDS) {
      const eff = getBuildingEffect(kind);
      if (eff.recruits.length === 0 || eff.faction !== f) continue;
      assert.equal(owner.has(kind), false, `${kind} is a troop building of two factions`);
      owner.set(kind, f);
      for (const candidate of ALL_FACTIONS) {
        assert.equal(
          buildingAllowedForFaction(kind, candidate),
          candidate === f,
          `${kind} (${f}) must be buildable only by ${f}, got ${candidate}`,
        );
      }
    }
  }
});

// ── Sprites: the art each faction's units are DRAWN with ──
//
// The measurement report recorded ESCALATION E1 as units of DIFFERENT factions
// shipping byte-identical PNGs — 12 duplicate groups in the arena idle set, 13
// in the icons, three of the six seat-faction pairs colliding. That surface is
// pinned here as a LEDGER rather than as one assertion, because 25 groups do not
// land in one change: every group still outstanding is declared below, and the
// assertion is that the measured set EQUALS the ledger.
//
// So the ledger can only shrink: landing unique art for a group means deleting
// its row here, and a row may not be added back. Two units shipping one file's
// bytes again fails these tests with the asset paths named.

const ARENA_DIR = resolve(process.cwd(), "src", "resources", "units", "arena");
const ICON_DIR = resolve(process.cwd(), "src", "resources", "units", "icons");

/** The two shipped art surfaces a unit is drawn with: its arena poses and its roster icon. */
const SPRITE_SURFACES = ["arena", "icon"] as const;
type SpriteSurface = (typeof SPRITE_SURFACES)[number];

function spritePath(surface: SpriteSurface, id: string): string {
  return surface === "arena"
    ? resolve(ARENA_DIR, `${id}-idle.png`)
    : resolve(ICON_DIR, `${id}.png`);
}

/** Every catalog id that ships art on this surface — the mage's missing arena poses simply are not here. */
function spriteIds(surface: SpriteSurface): string[] {
  return UNIT_CATALOG_IDS.filter((id) => existsSync(spritePath(surface, id)));
}

function spriteBytes(surface: SpriteSurface, id: string): Buffer {
  return readFileSync(spritePath(surface, id));
}

function contentHash(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * The duplicate-byte groups on one surface: units whose PNG is literally the
 * same file, measured by content hash. Members and groups are sorted, so the
 * comparison against the ledger is order-independent.
 */
function duplicateGroups(surface: SpriteSurface): string[][] {
  const byHash = new Map<string, string[]>();
  for (const id of spriteIds(surface)) {
    const hash = contentHash(spriteBytes(surface, id));
    const bucket = byHash.get(hash);
    if (bucket) bucket.push(id);
    else byHash.set(hash, [id]);
  }
  return [...byHash.values()]
    .filter((ids) => ids.length > 1)
    .map((ids) => [...ids].sort())
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

function normalizeLedger(groups: readonly (readonly string[])[]): string[][] {
  return [...groups]
    .map((ids) => [...ids].sort())
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

/**
 * The duplicate groups this repository still ships, measured 2026-11-07 against
 * main 0.53.14. Every one is placeholder art copied from another unit
 * (design/arena-unit-sprites/roster-parity-placeholder-art.md): closing a group
 * means authoring that unit its own PNG, which is per-unit art work.
 *
 * Each row is one card. The seat-faction rows (human<->ashen, human<->verdant,
 * ironmark<->verdant) are the ones that make two factions visually
 * indistinguishable; the neutral and same-faction rows are the same defect on a
 * less visible surface.
 */
const OUTSTANDING_DUPLICATE_GROUPS: Record<SpriteSurface, readonly (readonly string[])[]> = {
  arena: [
    ["axe_thrower", "dwarf_axeman", "tunnel_levy"],
    ["black_dragon", "bone_dragon"],
    ["bone_pikeman", "skeleton_warrior"],
    ["bramble_blade", "briar_warden"],
    ["dark_acolyte", "wraith"],
    ["druid", "hearth_priest", "runesmith"],
    ["elk_rider", "ram_rider"],
    ["lich", "necromancer"],
    ["sproutling", "treant_elder"],
    ["thorn_archer", "wildwood_ranger"],
    ["ursine_guardian", "warbeast", "war_boar"],
  ],
  icon: [
    ["axe_thrower", "dwarf_axeman", "tunnel_levy"],
    ["black_dragon", "bone_dragon"],
    ["bone_pikeman", "skeleton_warrior"],
    ["bramble_blade", "briar_warden"],
    ["dark_acolyte", "wraith"],
    ["druid", "mage"],
    ["elk_rider", "ram_rider"],
    ["hearth_priest", "runesmith"],
    ["lich", "necromancer"],
    ["sproutling", "treant_elder"],
    ["thorn_archer", "wildwood_ranger"],
    ["ursine_guardian", "warbeast", "war_boar"],
  ],
};

for (const surface of SPRITE_SURFACES) {
  test(`units of different factions share no ${surface} art outside the declared ledger`, () => {
    const measured = duplicateGroups(surface);
    const declared = normalizeLedger(OUTSTANDING_DUPLICATE_GROUPS[surface]);

    const declaredKeys = new Set(declared.map((ids) => ids.join("|")));
    const measuredKeys = new Set(measured.map((ids) => ids.join("|")));

    const regressions = measured.filter((ids) => !declaredKeys.has(ids.join("|")));
    assert.deepEqual(
      regressions.map((ids) => ids.map((id) => spritePath(surface, id)).join(" == ")),
      [],
      `two units ship the same ${surface} bytes and no ledger row declares it — ` +
        `land one of them its own art, or the collision is a regression`,
    );

    const closed = declared.filter((ids) => !measuredKeys.has(ids.join("|")));
    assert.deepEqual(
      closed.map((ids) => ids.join(" = ")),
      [],
      `the ${surface} ledger declares a group that is no longer a collision — ` +
        `delete its row here so the ledger keeps shrinking toward empty`,
    );
  });
}

test("the seat-faction pair this change differentiated ships unique art on both surfaces", () => {
  // human `warhound` vs ashen `grave_hound` — the first of the three colliding
  // seat-faction pairs. Each path named below is the asset the new art replaced.
  for (const surface of SPRITE_SURFACES) {
    assert.notEqual(
      contentHash(spriteBytes(surface, "grave_hound")),
      contentHash(spriteBytes(surface, "warhound")),
      `${spritePath(surface, "grave_hound")} and ${spritePath(surface, "warhound")} are still one file — ` +
        `the ashen and human hounds must not be the same sprite`,
    );
  }
});

// The arena sprites authored to the footprint contract (the first pair). The
// rest of the family still ships 2-19 rows of transparent bottom pad, which the
// shared `unit.<id>.<pose>` descriptor (bottom anchor, no anchorOffsetY) floats
// above the hex's south vertex; normalising the family is follow-up art work, so
// the contract is pinned per authored asset rather than family-wide.
const FOOTPRINT_EXACT_ARENA_IDS = ["grave_hound", "warhound"] as const;

/** A plinth reads as a base band nearly as wide as the whole figure; the shipped hound's is 17%. */
const MAX_BASE_BAND_RATIO = 0.5;

/**
 * A minimal PNG reader: 8-bit, non-interlaced, RGB or RGBA — which is what the
 * shipped unit art is. It exists instead of a `pngjs` import because the test
 * tree's type gate (`npm run test:types`) counts untyped module imports as debt,
 * and a sprite-geometry assertion is not worth a baseline entry.
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
  assert.equal(bitDepth, 8, "unit art is authored 8-bit");
  assert.equal(interlace, 0, "unit art is not interlaced");
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
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
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

test("the new arena art is cut to the iso footprint: base on the last row, no plinth, clean edges", () => {
  for (const id of FOOTPRINT_EXACT_ARENA_IDS) {
    const file = spritePath("arena", id);
    const png = readPng(spriteBytes("arena", id));
    assert.equal(png.width, 128, `${file} must ship 128px natural (the descriptor's naturalSize)`);
    assert.equal(png.height, 128, `${file} must be square 128x128`);

    const alphaAt = (x: number, y: number) => png.alpha(x, y);
    const rowWidth = (y: number) => {
      let n = 0;
      for (let x = 0; x < png.width; x++) if (alphaAt(x, y) > 0) n++;
      return n;
    };
    const rowOpaque = (y: number) => rowWidth(y) > 0;

    // The base lands ON the footprint: the bottom-anchored draw puts the
    // canvas' last row at the hex's south vertex, so the lowest opaque row must
    // be that row (bottomPad 0) — otherwise the unit floats above the hex.
    let bottomRow = png.height - 1;
    while (bottomRow >= 0 && !rowOpaque(bottomRow)) bottomRow--;
    assert.equal(
      bottomRow,
      png.height - 1,
      `${file} leaves ${png.height - 1 - bottomRow} transparent rows under the feet — the unit would float above the hex's south vertex`,
    );

    // No thick ground plinth: the base band is a stance, not a slab.
    const baseBand = Math.max(rowWidth(bottomRow - 2), rowWidth(bottomRow - 1), rowWidth(bottomRow));
    let widest = 0;
    let left = png.width;
    let right = -1;
    for (let y = 0; y < png.height; y++) {
      const w = rowWidth(y);
      if (w > widest) widest = w;
      if (w === 0) continue;
      for (let x = 0; x < png.width; x++) {
        if (alphaAt(x, y) === 0) continue;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
    assert.ok(
      baseBand <= widest * MAX_BASE_BAND_RATIO,
      `${file}'s base band is ${baseBand}px against a ${widest}px widest row — that is a ground plinth, not a stance`,
    );

    // Real alpha, background-clean: the model's fake-transparency background is
    // gone from every edge except the one the figure stands on.
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < png.width; x++) {
        assert.equal(alphaAt(x, y), 0, `${file} has opaque pixels in its top 2-px ring (row ${y}) — background not stripped`);
      }
    }
    for (let x = 0; x < png.width; x++) {
      if (x >= 2 && x < png.width - 2) continue;
      for (let y = 0; y < png.height; y++) {
        assert.equal(alphaAt(x, y), 0, `${file} has opaque pixels in its side 2-px ring (column ${x}) — background not stripped`);
      }
    }

    // Centred on the footprint's vertical axis.
    const centre = (left + right) / 2;
    assert.ok(
      Math.abs(centre - (png.width - 1) / 2) <= 2,
      `${file}'s figure is centred at x=${centre}, off the canvas axis by more than 2px`,
    );
  }
});
