import { test } from "node:test";
import assert from "node:assert/strict";
import { GameMap } from "@heroes/engine";
import type { TileRow } from "@heroes/engine";
import { NEIGHBOR_DIRS } from "@heroes/engine";
import { buildAdventureScene, riverMaskAt } from "../../src/render/scene/sceneBuilder/adventureScene";
import { riverMaskInfo, paintRiverHex } from "../../src/render/scene/paint2d/index";
import type { RiverHexNode } from "../../src/render/scene/types";
import { makeRecordingCtx, makeNoopPaint2DDep, makeRenderOptions } from "./_helpers";
import { Hero } from "../../src/entities/hero";

test("unseen river cells emit no river overlay through the fog", () => {
  const map = new GameMap(993025331, "small", 5);
  const heroes = [new Hero("h0", "Hero", 0, 0, "player", 0)];
  const nodes = buildAdventureScene({
    map,
    heroes,
    castles: [],
    path: [],
    hover: null,
    opts: makeRenderOptions({ viewPlayerId: 0 }),
    revealed: null,
  });
  assert.equal(nodes.filter((n) => n.kind === "riverHex").length, 0, "no river overlay while every river cell is beyond vision");
});

test("riverMaskInfo maps the six bit masks to the baked templates", () => {
  // single dir -> end
  for (let d = 0; d < 6; d++) assert.equal(riverMaskInfo(1 << d).template, "end");
  // opposite pairs -> straight
  assert.equal(riverMaskInfo((1 << 0) | (1 << 3)).template, "straight");
  assert.equal(riverMaskInfo((1 << 1) | (1 << 4)).template, "straight");
  assert.equal(riverMaskInfo((1 << 2) | (1 << 5)).template, "straight");
  // E+SE bend (diff 60) -> curveC, E+NE bend (diff 300) -> curveCC
  assert.equal(riverMaskInfo((1 << 0) | (1 << 5)).template, "curveC");
  assert.equal(riverMaskInfo((1 << 0) | (1 << 1)).template, "curveCC");
  // 120-degree pair (diff 120/240) -> the sharp bend templates
  assert.equal(riverMaskInfo((1 << 0) | (1 << 4)).template, "curve120C");
  assert.equal(riverMaskInfo((1 << 0) | (1 << 2)).template, "curve120CC");
  assert.deepEqual(riverMaskInfo((1 << 1) | (1 << 3)), { template: "curve120CC", rotationDeg: 300 });
  assert.equal(riverMaskInfo(0).template, "end");
});

test("riverMaskInfo rotates straight tiles to the first direction's angle", () => {
  assert.deepEqual(riverMaskInfo((1 << 0) | (1 << 3)), { template: "straight", rotationDeg: 0 });
  // Straight is 180-symmetric; the lowest set bit wins, so either end resolves
  // to the same visual band.
  assert.equal(riverMaskInfo((1 << 3) | (1 << 0)).rotationDeg, 0);
  assert.equal(riverMaskInfo(1 << 1).rotationDeg, 300);
});

function rows(width: number, height: number): TileRow[] {
  const out: TileRow[] = [];
  for (let r = 0; r < height; r++) {
    for (let q = 0; q < width; q++) out.push({ q, r, terrain: "grass", resource: null });
  }
  return out;
}

test("the adventure scene emits riverHex nodes and suppresses biome decorations on river cells", () => {
  const map = GameMap.fromTiles([
    ...rows(4, 4).map((t) => {
      if ((t.q === 1 || t.q === 2) && t.r === 1) return { ...t, terrain: "forest" as const, river: "small" as const };
      return t;
    }),
  ]);
  // forest river cells at (1,1) and (2,1), adjacent along the south edge.
  const nodes = buildAdventureScene({
    map,
    path: [],
    hover: null,
    opts: {} as never,
    visible: new Set([`${1},${1}`, `${2},${1}`]),
  });
  const riverNodes = nodes.filter((n) => n.kind === "riverHex") as RiverHexNode[];
  assert.equal(riverNodes.length, 2, "one river node per river cell");
  const a = riverNodes.find((n) => n.q === 1 && n.r === 1)!;
  assert.equal(a.size, "small");
  assert.equal(a.mask, 1 << 0, "cell (1,1) sees the river to the east");
  assert.equal(riverMaskAt(map, 1, 1), 1 << 0);
  // The forest river cells must not carry a terrainDecoration (no trees in water).
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i] as unknown as { kind: string; q: number; r: number };
    if (n.kind === "terrainDecoration") {
      assert.ok(!(n.q === 1 && n.r === 1) && !(n.q === 2 && n.r === 1), "no decoration on river cells");
    }
  }
});

test("wide river bridge cells emit a bridge river node", () => {
  const map = GameMap.fromTiles([
    ...rows(4, 4).map((t) => {
      if (t.q === 1 && t.r === 1) return { ...t, river: "wide" as const, bridge: true };
      if (t.q === 2 && t.r === 1) return { ...t, river: "wide" as const };
      return t;
    }),
  ]);
  const nodes = buildAdventureScene({
    map,
    path: [],
    hover: null,
    opts: {} as never,
    visible: new Set([`${1},${1}`, `${2},${1}`, `${0},${0}`]),
  });
  const bridged = nodes.find((n) => n.kind === "riverHex" && n.q === 1 && n.r === 1) as RiverHexNode;
  const plain = nodes.find((n) => n.kind === "riverHex" && n.q === 2 && n.r === 1) as RiverHexNode;
  assert.equal(bridged.bridge, true);
  assert.equal(plain.bridge, undefined);
  assert.equal(bridged.size, "wide");
});

test("riverMaskAt ignores non-river neighbours", () => {
  // A lone river cell with no river neighbours -> mask 0.
  const map = GameMap.fromTiles([...rows(3, 3).map((t) => (t.q === 1 && t.r === 1 ? { ...t, river: "small" as const } : t))]);
  assert.equal(riverMaskAt(map, 1, 1), 0);
  for (const d of NEIGHBOR_DIRS) {
    assert.equal(map.riverAt(1 + d.q, 1 + d.r), undefined);
  }
});

test("paintRiverHex draws the resolved sprite rotated by the exit direction", () => {
  const { ctx, calls } = makeRecordingCtx();
  const deps = makeNoopPaint2DDep();
  deps.sprite.resolveRiverSprite = () => ({
    drawable: { ok: true } as unknown as HTMLCanvasElement,
    descriptor: { key: "river.small.straight", url: null, anchor: "center", sizing: { kind: "abs", size: 64 } },
    ready: true,
  });
  paintRiverHex(ctx, { kind: "riverHex", q: 1, r: 1, world: { x: 10, y: 10 }, size: "small", mask: (1 << 0) | (1 << 3) }, deps);
  assert.equal(calls.filter((c) => c.name === "drawImage").length, 1, "one drawImage");
  const rotate = calls.find((c) => c.name === "rotate");
  assert.ok(rotate, "sprite is rotated into place");
  assert.equal(rotate.args[0], 0, "east-west straight river needs no rotation");
});

test("paintRiverHex draws a mouth wedge only when mouthDir is set", () => {
  const { ctx, calls } = makeRecordingCtx();
  const wedgeFills = () => calls.filter((c) => c.name === "set:fillStyle" && String(c.args[0]).startsWith("rgba(42, 90, 138"));
  paintRiverHex(ctx, { kind: "riverHex", q: 1, r: 1, world: { x: 10, y: 10 }, size: "wide", mask: (1 << 0) | (1 << 3) }, makeNoopPaint2DDep());
  assert.equal(wedgeFills().length, 0, "no mouth without mouthDir");
  paintRiverHex(ctx, { kind: "riverHex", q: 1, r: 1, world: { x: 10, y: 10 }, size: "wide", mask: (1 << 0) | (1 << 3), mouthDir: 3 }, makeNoopPaint2DDep());
  assert.equal(wedgeFills().length, 2, "mouth wedge draws its two fade quads");
});

test("paintRiverHex falls back to a procedural band when sprites are unavailable", () => {
  const { ctx, calls } = makeRecordingCtx();
  paintRiverHex(ctx, { kind: "riverHex", q: 1, r: 1, world: { x: 10, y: 10 }, size: "small", mask: (1 << 0) | (1 << 3) }, makeNoopPaint2DDep());
  assert.equal(calls.filter((c) => c.name === "drawImage").length, 0, "no sprite");
  assert.ok(calls.some((c) => c.name === "stroke"), "procedural band strokes in the fallback");
});