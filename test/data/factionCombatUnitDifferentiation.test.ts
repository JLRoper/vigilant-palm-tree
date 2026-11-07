// Faction combat-unit DIFFERENTIATION, measured rather than assumed.
//
// This suite pins ONLY the per-faction differences that actually hold at the
// SHA that added it, read from the shipped data rather than the design prose:
// the engine's FACTION_REGISTRY rosters, the unit_types catalog the SQL
// migrations build, and the building registry's recruit table. A surface where
// two factions are NOT distinguishable is deliberately NOT asserted here — an
// assertion of sameness would freeze a gap as if it were the design. The one
// such surface for combat units (units of different factions that share the
// exact same sprite bytes) is recorded in the measurement report's
// ESCALATIONS section instead; see analysis/2026-11-07-faction-combat-unit-
// differentiation.md.
//
// The DB half follows test/data/unitCatalogParity.test.ts's convention:
// initSchema() in before() (idempotent — it runs at every server boot) so a
// fresh database's migration-built catalog is present under plain tsx --test.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { BuildingKind, FactionId } from "@heroes/contracts";
import {
  FACTION_REGISTRY,
  buildingAllowedForFaction,
  getBuildingEffect,
} from "@heroes/engine";
import { pool } from "../../server/persistence/db";
import { initSchema } from "../../server/db";

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
