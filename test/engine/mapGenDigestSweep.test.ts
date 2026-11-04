import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  CURRENT_MAP_GEN_VERSION,
  RESOURCE_TURNS_MAX,
  RESOURCE_TURNS_MIN,
  RESOURCE_YIELD,
  getOrCreateGameMap,
  resourceAmountRangeFor,
  resourceTurnsFor,
  type MapGenVersion,
  type MapSize,
} from "@heroes/engine";
import type { ResourceType } from "@heroes/contracts";

// The standing sweep, widened to every size/version/seed the generator is asked
// for: 2 sizes x every historical MapGenVersion x seeds 1..6 = 60 maps, hashed
// as ONE digest per dimension.
//
//   - STRUCTURAL_SHA256: terrain tiles, placed rivers and the deposit
//     PLACEMENTS (q, r, resource). This is the world a seed rebuilds; a
//     generation pass or a MapGenVersion change moves it.
//   - WITH_AMOUNTS_SHA256: the same maps' deposit AMOUNTS, folded in. `amount`
//     is a hash of (seed, q, r, resource) -- `resourceTiles.ts`
//     `resourceAmountFor` -- scaled onto the resource's own span, so it is a
//     function of the SPAN that derivation multiplies by.
//
// The amounts are pinned deliberately, and separately, because they are the
// one-time economy's dimension: a tile's amount is what a hero carries off it
// and (over the deposit's rate) how many turns of settlement production one
// pickup is worth. `settlersMode.test.ts`'s AMOUNT_PINS says the same thing for
// two seeds; this sweep says it across the whole size/version/seed grid, so a
// change to the span that flattens the resource curve cannot land unnoticed.
// `test/engine/settlersMode.test.ts`'s GRID_PINS remains the per-seed pin.
//
// ADVENTURE P3 moved the amounts half and NOT the structural half: the span is
// derived from the yield table now (1..50 turns of the working settlement's
// production, per resource) instead of one fixed 5-500 spread. The structural
// pin below is the SAME value it has been since the sweep landed -- terrain,
// rivers and deposit placements are byte-identical -- and the version moved to
// 6 to record that the derived content did (see gameMap.ts
// CURRENT_MAP_GEN_VERSION, and the v6-vs-v5 test at the bottom of this file).
const SIZES: readonly MapSize[] = ["small", "large"];
const VERSIONS: readonly MapGenVersion[] = [1, 2, 3, 4, 5];
const SEEDS: readonly number[] = [1, 2, 3, 4, 5, 6];

const STRUCTURAL_PIN = "641d80212f48aac81b95becfbed52829774e8b16ced010d42c65daae54fbca5e";
const WITH_AMOUNTS_PIN = "94ee66d197f6935d78d9429234e3def8559e84e8df2e173571619f326d12369a";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sweep(): { structural: string; withAmounts: string; maps: number; tiles: number; rivers: number; resources: number } {
  const structural: string[] = [];
  const withAmounts: string[] = [];
  let maps = 0;
  let tiles = 0;
  let rivers = 0;
  let resources = 0;
  for (const size of SIZES) {
    for (const version of VERSIONS) {
      for (const seed of SEEDS) {
        // The same call the server makes (gameMap.ts `getOrCreateGameMap`), so
        // the sweep hashes the map a game is actually built on.
        const map = getOrCreateGameMap(seed, size, version);
        maps++;
        const header = `# ${seed} ${size} v${version} ${map.width}x${map.height}`;
        structural.push(header);
        withAmounts.push(header);
        for (let r = 0; r < map.height; r++) {
          const row: string[] = [];
          for (let q = 0; q < map.width; q++) row.push(map.get(q, r) ?? "?");
          structural.push(row.join(","));
          withAmounts.push(row.join(","));
          tiles += map.width;
        }
        for (const rv of map.placedRivers) {
          const line = `R ${rv.q},${rv.r},${rv.kind},${rv.bridge ? 1 : 0}`;
          structural.push(line);
          withAmounts.push(line);
          rivers++;
        }
        for (const rt of map.placedResourceTiles) {
          structural.push(`T ${rt.q},${rt.r},${rt.resource}`);
          withAmounts.push(`T ${rt.q},${rt.r},${rt.resource},${rt.amount}`);
          resources++;
        }
      }
    }
  }
  return {
    structural: sha256(structural.join("\n")),
    withAmounts: sha256(withAmounts.join("\n")),
    maps,
    tiles,
    rivers,
    resources,
  };
}

test("the generated map of every size/version/seed is byte-identical (the standing sweep)", () => {
  const got = sweep();
  console.log(
    `[sweep] ${got.maps} maps, ${got.tiles} tiles, ${got.rivers} rivers, ${got.resources} resource tiles`,
  );
  console.log(`[sweep] structural   = ${got.structural}`);
  console.log(`[sweep] with amounts = ${got.withAmounts}`);
  assert.equal(got.maps, 60, "the sweep is 2 sizes x 5 versions x 6 seeds");
  assert.ok(got.resources > 0, "the sweep placed resource tiles to hash");
  assert.equal(
    CURRENT_MAP_GEN_VERSION,
    6,
    "the map-gen version this sweep was pinned at (6 moved it for the yield-derived pickup span, NOT for a generation pass -- the structural pin below is unmoved)",
  );
  assert.equal(
    got.structural,
    STRUCTURAL_PIN,
    "a generation pass moved the world for an existing seed -- terrain, rivers or deposit placements changed",
  );
  assert.equal(
    got.withAmounts,
    WITH_AMOUNTS_PIN,
    "the deposit amounts of existing seeds moved -- the amount derivation (resourceTiles.ts resourceAmountFor) changed span, which rewrites the pickups of every map in flight",
  );
});

test("v6 is a marker, not a generation pass: it generates the same world as v5 for every seed and size", () => {
  // The card's hard constraint: terrain generation stays byte-identical while
  // the version moves. v5 is the last version that added a pass (rivers), so
  // v6-vs-v5 equality is the whole claim -- and it covers the deposits' AMOUNTS
  // too, because the derivation takes no version at all.
  let pairs = 0;
  for (const size of SIZES) {
    for (const seed of SEEDS) {
      const v5 = getOrCreateGameMap(seed, size, 5);
      const v6 = getOrCreateGameMap(seed, size, 6);
      pairs++;
      assert.equal(v6.width, v5.width, `${seed}/${size}: width`);
      assert.equal(v6.height, v5.height, `${seed}/${size}: height`);
      for (let r = 0; r < v5.height; r++) {
        for (let q = 0; q < v5.width; q++) {
          assert.equal(v6.get(q, r), v5.get(q, r), `${seed}/${size}/v6 terrain at ${q},${r}`);
        }
      }
      assert.deepEqual(v6.placedRivers, v5.placedRivers, `${seed}/${size}/v6 rivers`);
      assert.deepEqual(
        v6.placedResourceTiles,
        v5.placedResourceTiles,
        `${seed}/${size}/v6 deposits (placement AND amount)`,
      );
    }
  }
  console.log(`[v6] ${pairs} v5/v6 map pairs identical (terrain, rivers, deposit placements and amounts)`);
  assert.equal(pairs, 12, "2 sizes x 6 seeds");
});

test("every deposit the sweep placed is inside its own resource's derived span", () => {
  for (const size of SIZES) {
    for (const version of VERSIONS) {
      for (const seed of SEEDS) {
        const map = getOrCreateGameMap(seed, size, version);
        for (const rt of map.placedResourceTiles) {
          const range = resourceAmountRangeFor(rt.resource);
          assert.ok(
            rt.amount >= range.min && rt.amount <= range.max,
            `${seed}/${size}/v${version} deposit ${rt.q},${rt.r} (${rt.resource}) amount ${rt.amount} is outside ${range.min}-${range.max} (${RESOURCE_YIELD[rt.resource]} x ${RESOURCE_TURNS_MIN}..${RESOURCE_TURNS_MAX} turns)`,
          );
        }
      }
    }
  }
});

test("a pickup is worth 1 to 50 turns of a level-1 settlement's production, for every resource", () => {
  // The card's number, as an invariant rather than a claim. A deposit's worth
  // is its amount over the per-turn rate the settlement that works it is paid
  // (economy/settlementRates.ts: RESOURCE_YIELD[resource] x level per tile in
  // radius), so a whole pile is `turns / level` turns of that settlement's
  // production. The span is derived from the yield table, so the band is the
  // SAME for every resource -- which is the point: under the old fixed 5-500
  // spread the same pile was worth up to 100 turns of arcane against 25 of gold
  // at L1, i.e. the map's own yields did not enter into it.
  const seen = new Map<ResourceType, { min: number; max: number; n: number }>();
  let ceiling = { turns: 0, level: 1, where: "" };
  for (const size of SIZES) {
    for (const version of VERSIONS) {
      for (const seed of SEEDS) {
        const map = getOrCreateGameMap(seed, size, version);
        for (const rt of map.placedResourceTiles) {
          const yield_ = RESOURCE_YIELD[rt.resource];
          assert.equal(
            rt.amount % yield_,
            0,
            `${seed}/${size}/v${version} deposit ${rt.q},${rt.r} (${rt.resource}) amount ${rt.amount} is not a whole number of turns of its own yield (${yield_})`,
          );
          const turns = resourceTurnsFor(rt.amount, rt.resource);
          assert.ok(
            turns >= RESOURCE_TURNS_MIN && turns <= RESOURCE_TURNS_MAX,
            `${seed}/${size}/v${version} deposit ${rt.q},${rt.r} (${rt.resource}) is worth ${turns} turns, outside ${RESOURCE_TURNS_MIN}-${RESOURCE_TURNS_MAX}`,
          );
          const row = seen.get(rt.resource) ?? { min: Infinity, max: 0, n: 0 };
          row.min = Math.min(row.min, turns);
          row.max = Math.max(row.max, turns);
          row.n++;
          seen.set(rt.resource, row);
          for (const level of [1, 2, 3]) {
            const worth = turns / level;
            if (worth > ceiling.turns) {
              ceiling = { turns: worth, level, where: `${seed}/${size}/v${version} ${rt.resource} ${rt.amount}` };
            }
          }
        }
      }
    }
  }
  // Every resource that spawns fills its band end to end -- a span that is only
  // ever used in its middle would pass a bounds check while flattening the
  // resource curve, which is the thing the amounts pin exists to catch.
  for (const [resource, row] of [...seen.entries()].sort()) {
    console.log(`[worth] ${resource}: n=${row.n} turns ${row.min}..${row.max}`);
    assert.equal(row.min, RESOURCE_TURNS_MIN, `${resource} never rolls the bottom of its span`);
    assert.equal(row.max, RESOURCE_TURNS_MAX, `${resource} never rolls the top of its span`);
  }
  assert.ok(seen.size >= 5, "the sweep placed every spawning resource");
  console.log(
    `[worth] ceiling: ${ceiling.turns.toFixed(4)} turns at L${ceiling.level} (${ceiling.where})`,
  );
  assert.equal(ceiling.turns, RESOURCE_TURNS_MAX, "the worst pile in the sweep is 50 turns at a level-1 settlement");
});

test("the amount sweep is a pure function of the map, not of iteration order", () => {
  // Two independent builds of the same grid must hash identically: the amounts
  // ride the map and must agree on the server and the client with no wire field.
  const first = sweep().withAmounts;
  const second = sweep().withAmounts;
  assert.equal(first, second, "the amount hash is not stable across two sweeps");
});
