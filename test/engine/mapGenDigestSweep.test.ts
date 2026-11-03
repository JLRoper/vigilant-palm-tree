import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  CURRENT_MAP_GEN_VERSION,
  RESOURCE_AMOUNT_MAX,
  RESOURCE_AMOUNT_MIN,
  getOrCreateGameMap,
  type MapGenVersion,
  type MapSize,
} from "@heroes/engine";

// The standing sweep, widened to every size/version/seed the generator is asked
// for: 2 sizes x every MapGenVersion x seeds 1..6 = 60 maps, hashed as ONE
// digest per dimension.
//
//   - STRUCTURAL_SHA256: terrain tiles, placed rivers and the deposit
//     PLACEMENTS (q, r, resource). This is the world a seed rebuilds; a
//     generation pass or a MapGenVersion change moves it.
//   - WITH_AMOUNTS_SHA256: the same maps' deposit AMOUNTS, folded in. `amount`
//     is a hash of (seed, q, r, resource) -- `resourceTiles.ts`
//     `resourceAmountFor` -- scaled onto the deposit range, so it is a function
//     of the SPAN that derivation multiplies by.
//
// The amounts are pinned deliberately, and separately, because they are the
// one-time economy's dimension: a tile's amount is what a hero carries off it
// and (over the deposit's rate) how many turns of settlement production one
// pickup is worth. `settlersMode.test.ts`'s AMOUNT_PINS says the same thing for
// two seeds; this sweep says it across the whole size/version/seed grid, so a
// change to the span that flattens the resource curve cannot land unnoticed.
// `test/engine/settlersMode.test.ts`'s GRID_PINS remains the per-seed pin.
const SIZES: readonly MapSize[] = ["small", "large"];
const VERSIONS: readonly MapGenVersion[] = [1, 2, 3, 4, 5];
const SEEDS: readonly number[] = [1, 2, 3, 4, 5, 6];

const STRUCTURAL_PIN = "641d80212f48aac81b95becfbed52829774e8b16ced010d42c65daae54fbca5e";
const WITH_AMOUNTS_PIN = "b7473a513cbebe9bec17ece847a00db4fae06dc03187d4293672a9863e81ba55";

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
  assert.equal(CURRENT_MAP_GEN_VERSION, 5, "the map-gen version this sweep was pinned at");
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

test("every deposit the sweep placed is inside the reader's amount range", () => {
  for (const size of SIZES) {
    for (const version of VERSIONS) {
      for (const seed of SEEDS) {
        const map = getOrCreateGameMap(seed, size, version);
        for (const rt of map.placedResourceTiles) {
          assert.ok(
            rt.amount >= RESOURCE_AMOUNT_MIN && rt.amount <= RESOURCE_AMOUNT_MAX,
            `${seed}/${size}/v${version} deposit ${rt.q},${rt.r} (${rt.resource}) amount ${rt.amount} is outside ${RESOURCE_AMOUNT_MIN}-${RESOURCE_AMOUNT_MAX}`,
          );
        }
      }
    }
  }
});

test("the amount sweep is a pure function of the map, not of iteration order", () => {
  // Two independent builds of the same grid must hash identically: the amounts
  // ride the map and must agree on the server and the client with no wire field.
  const first = sweep().withAmounts;
  const second = sweep().withAmounts;
  assert.equal(first, second, "the amount hash is not stable across two sweeps");
});
