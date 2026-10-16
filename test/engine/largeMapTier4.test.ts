import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GameMap,
  aiTargetReachForMap,
  defaultCastleCountForMap,
  findPath,
  generateCastles,
  maxCastleCountForMap,
  mulberry32,
  pickAiMove,
  scaledTerrainBlobs,
  validCharterHexes,
  type TileRow,
} from "@heroes/engine";
import { OnDemandSpriteSource, resolveHeroSpriteWithRunFrame } from "../../src/render/assetSource";
import fs from "node:fs";
import path from "node:path";
import { createSettlementRepo } from "../../server/persistence/repositories/settlementRepo";
import { createHeroRepo } from "../../server/persistence/repositories/heroRepo";
import type { Queryable } from "../../server/persistence/repositories/gameRepo";
import { makeHero, makeSettlement, makeState } from "../charter/_helpers";

test("Item 1: validCharterHexes bitset implementation and radius-bounded option match full-scan rules", () => {
  const map = new GameMap(42, "medium");
  const s0 = makeSettlement("s0", 0, 10, 10, { level: 1 });
  const h0 = makeHero("h0", 0, 10, 10);
  const h1 = makeHero("h1", 1, 16, 12);
  const state = makeState({
    settlements: [s0],
    heroes: [h0, h1],
    activeCharters: [
      {
        id: "ch-1",
        ownerId: 0,
        heroId: "h0",
        targetQ: 18,
        targetR: 12,
        settlementName: "Outpost",
        phase: "traveling",
        daysRemaining: 3,
      },
    ],
  });

  const full = validCharterHexes(state, map);
  assert.equal(full.has("10,10"), false, "settlement tile is excluded");
  assert.equal(full.has("12,10"), false, "within distance < 4 of settlement is excluded");
  assert.equal(full.has("16,12"), false, "hero tile is excluded");
  assert.equal(full.has("18,12"), false, "active charter target is excluded");

  const bounded = validCharterHexes(state, map, { center: { q: 10, r: 10 }, maxDistance: 6 });
  for (const key of bounded) {
    assert.equal(full.has(key), true, `bounded key ${key} must be in full validCharterHexes`);
  }
  assert.ok(bounded.size > 0 && bounded.size < full.size);
});

test("Item 2: OnDemandSpriteSource tracks ready=false while loading, ready=true after onload, and evicts on onerror", () => {
  const origImage = globalThis.Image;
  const instances: Array<{ src: string; onload?: () => void; onerror?: () => void }> = [];
  class FakeImage {
    src = "";
    onload?: () => void;
    onerror?: () => void;
    constructor() {
      instances.push(this);
    }
  }
  (globalThis as unknown as { Image: typeof FakeImage }).Image = FakeImage;
  try {
    const source = new OnDemandSpriteSource({
      "building.pixel.house.1": "/assets/house-1.png",
      "building.pixel.bank.1": "/assets/bank-1.png",
    });

    const first = source.resolve("building.pixel.house.1");
    assert.ok(first);
    assert.equal(first.ready, false, "first resolve starts loading and reports ready=false");
    assert.equal(instances.length, 1);

    // Calling resolve again while still loading returns the same drawable with ready=false (no duplicate Image)
    const whileLoading = source.resolve("building.pixel.house.1");
    assert.ok(whileLoading);
    assert.equal(whileLoading.ready, false, "still loading before onload fires");
    assert.equal(instances.length, 1);

    // Fire onload -> ready flips to true
    instances[0].onload?.();
    const afterLoad = source.resolve("building.pixel.house.1");
    assert.ok(afterLoad);
    assert.equal(afterLoad.ready, true, "ready=true once onload fires");

    // Fire onerror on second key -> evicted so a retry can re-request
    const errResolve = source.resolve("building.pixel.bank.1");
    assert.ok(errResolve);
    assert.equal(errResolve.ready, false);
    instances[1].onerror?.();
    assert.equal(instances.length, 2);
    const retryResolve = source.resolve("building.pixel.bank.1");
    assert.ok(retryResolve);
    assert.equal(instances.length, 3, "evicted failed image is re-requested on next resolve");

    // Mounted hero run-frame fallback: while horse.drake.e.2 is still loading
    // (ready=false), resolveHeroSpriteWithRunFrame falls back to the ready
    // base sprite horse.drake.e; once onload fires on horse.drake.e.2, it
    // returns the run-frame sprite.
    const heroSource = new OnDemandSpriteSource({
      "horse.drake.e": "/assets/drake-e.png",
      "horse.drake.e.2": "/assets/drake-e-2.png",
    });
    const baseInit = heroSource.resolve("horse.drake.e");
    assert.ok(baseInit);
    instances[instances.length - 1].onload?.();

    const whileRunFrameLoading = resolveHeroSpriteWithRunFrame(
      (k) => heroSource.resolve(k),
      "horse.drake.e",
      "horse.drake.e.2",
    );
    assert.ok(whileRunFrameLoading);
    assert.equal(whileRunFrameLoading.ready, true, "falls back to ready base sprite while run frame is loading");
    assert.equal(
      (whileRunFrameLoading.drawable as unknown as { src: string }).src,
      "/assets/drake-e.png",
    );

    instances[instances.length - 1].onload?.();
    const afterRunFrameReady = resolveHeroSpriteWithRunFrame(
      (k) => heroSource.resolve(k),
      "horse.drake.e",
      "horse.drake.e.2",
    );
    assert.ok(afterRunFrameReady);
    assert.equal(afterRunFrameReady.ready, true);
    assert.equal(
      (afterRunFrameReady.drawable as unknown as { src: string }).src,
      "/assets/drake-e-2.png",
    );

    const paint2dDefaultsSrc = fs.readFileSync(
      path.resolve(process.cwd(), "src/render/paint2dDefaults.ts"),
      "utf8",
    );
    assert.match(
      paint2dDefaultsSrc,
      /if\s*\(\s*frameSprite\s*&&\s*frameSprite\.ready\s*\)/,
      "paint2dDefaults.ts must gate frame-1 selection on frameSprite.ready",
    );
  } finally {
    (globalThis as unknown as { Image: typeof origImage }).Image = origImage;
  }
});

test("Item 4: scaledTerrainBlobs, maxCastleCountForMap, defaultCastleCountForMap, and generateCastles connectivity check", () => {
  // Small (24x18 = 432) is unchanged (CASTLE_COUNT_MAX=15, CASTLE_COUNT_DEFAULT=5)
  assert.equal(scaledTerrainBlobs(3, 24, 18), 3);
  assert.equal(maxCastleCountForMap(24, 18), 15);
  assert.equal(defaultCastleCountForMap(2, 24, 18), 4);

  // Huge (72x54 = 9x area -> 3x sqrt) and Epic (120x90 = 25x area -> 5x sqrt)
  assert.equal(scaledTerrainBlobs(3, 72, 54), 9);
  assert.equal(scaledTerrainBlobs(3, 120, 90), 15);
  assert.equal(maxCastleCountForMap(72, 54), 45);
  assert.equal(maxCastleCountForMap(120, 90), 75);
  assert.equal(defaultCastleCountForMap(2, 72, 54), 18);
  assert.equal(defaultCastleCountForMap(2, 120, 90), 30);

  // Connectivity check: build a 24x18 map where the right half has an isolated grass pocket surrounded by mountains
  const rows: TileRow[] = [];
  for (let r = 0; r < 18; r++) {
    for (let q = 0; q < 24; q++) {
      // Ring of mountains around (18, 9) isolating (18, 9)
      const isPocketWall =
        Math.max(Math.abs(q - 18), Math.abs(r - 9)) === 1 && !(q === 18 && r === 9);
      rows.push({
        q,
        r,
        terrain: isPocketWall ? "mountain" : "grass",
        resource: null,
      });
    }
  }
  const map = GameMap.fromTiles(rows);
  const castles = generateCastles(map, { castleSeed: 7, playerCount: 2, castleCount: 6 });
  assert.equal(castles.length, 6);
  for (let i = 1; i < castles.length; i++) {
    const path = findPath(map, castles[0].tile, castles[i].tile);
    assert.ok(path.length > 0, `castle ${castles[i].id} must be reachable from ${castles[0].id}`);
  }

  // Disconnected halves regression (full-height impassable wall at q=12):
  // cands.right (q >= 18) has 0 tiles reachable from cands.left (q < 6), so
  // generateCastles must relax the side preference to cands.any while keeping
  // reachableMask mandatory.
  const splitRows: TileRow[] = [];
  for (let r = 0; r < 18; r++) {
    for (let q = 0; q < 24; q++) {
      splitRows.push({
        q,
        r,
        terrain: q === 12 ? "mountain" : "grass",
        resource: null,
      });
    }
  }
  const splitMap = GameMap.fromTiles(splitRows);
  const splitCastles = generateCastles(splitMap, { castleSeed: 7, playerCount: 2, castleCount: 6 });
  assert.equal(splitCastles.length, 6);
  for (let i = 1; i < splitCastles.length; i++) {
    assert.ok(splitCastles[i].tile.q < 12, `castle ${splitCastles[i].id} stays in the connected left half`);
    const path = findPath(splitMap, splitCastles[0].tile, splitCastles[i].tile);
    assert.ok(path.length > 0, `castle ${splitCastles[i].id} must be reachable from ${splitCastles[0].id} across split map`);
  }
});

test("Item 5: aiTargetReachForMap scales AI settlement & enemy reach on huge/epic maps", () => {
  assert.equal(aiTargetReachForMap(8, { width: 24, height: 18 }), 8);
  assert.equal(aiTargetReachForMap(8, { width: 72, height: 54 }), 24);
  assert.equal(aiTargetReachForMap(8, { width: 120, height: 90 }), 40);

  const epicMap = new GameMap(42, "epic");
  // Ensure a passable corridor along r=20 from q=10 to q=28 (dist=18 > 8, <= 40)
  for (let q = 10; q <= 28; q++) {
    epicMap.tiles[20 * epicMap.width + q] = "grass";
  }
  const aiHero = makeHero("ai-h", 1, 10, 20, { movementRemaining: 7 });
  const neutralCastle = makeSettlement("s-distant", null, 28, 20, { level: 1 });
  const state = makeState({
    heroes: [aiHero],
    settlements: [neutralCastle],
  });

  const move = pickAiMove(state, "ai-h", epicMap, mulberry32(1));
  assert.ok(move, "AI finds a move toward the distant neutral settlement on an epic map");
  assert.deepEqual(move.toTile, { q: 11, r: 20 });
});

test("Item 6: settlementRepo.upsertMany and heroRepo.upsertMany skip SQL writes for unchanged entity references", async () => {
  const queries: string[] = [];
  const fakeDb: Queryable = {
    async query<T = unknown>(sql: string) {
      queries.push(sql.trim().split(/\s+/).slice(0, 3).join(" "));
      if (sql.includes("SELECT id FROM games")) {
        return { rows: [{ id: 1 } as unknown as T], rowCount: 1 };
      }
      return { rows: [] as T[], rowCount: 0 };
    },
  };

  const s0 = makeSettlement("s0", 0, 2, 2);
  const s1 = makeSettlement("s1", 0, 8, 8);
  const s2 = makeSettlement("s2", null, 14, 14);
  const beforeSettlements = { s0, s1, s2 };
  const s1Updated = { ...s1, gold: s1.gold + 50 };
  const afterSettlements = { s0, s1: s1Updated, s2 };

  const settlementRepo = createSettlementRepo(fakeDb);
  await settlementRepo.upsertMany("g1", afterSettlements, beforeSettlements);

  const settlementInserts = queries.filter((q) => q.startsWith("INSERT INTO settlements"));
  const settlementDeletes = queries.filter((q) => q.startsWith("DELETE FROM settlements"));
  assert.equal(settlementDeletes.length, 0, "no settlement was removed, so orphan DELETE is skipped");
  assert.equal(settlementInserts.length, 1, "only the 1 dirty settlement (s1) is upserted");

  queries.length = 0;
  const h0 = makeHero("h0", 0, 2, 2);
  const h1 = makeHero("h1", 1, 10, 10);
  const beforeHeroes = { h0, h1 };
  const h0Moved = { ...h0, q: 3, movementRemaining: 6 };
  const afterHeroes = { h0: h0Moved, h1 };

  const heroRepo = createHeroRepo(fakeDb);
  await heroRepo.upsertMany("g1", afterHeroes, beforeHeroes);

  const heroInserts = queries.filter((q) => q.startsWith("INSERT INTO heroes"));
  const heroDeletes = queries.filter((q) => q.startsWith("DELETE FROM heroes"));
  assert.equal(heroDeletes.length, 0, "no hero was removed, so orphan DELETE is skipped");
  assert.equal(heroInserts.length, 1, "only the 1 moved hero (h0) is upserted");
});
