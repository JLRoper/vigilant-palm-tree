import { test } from "node:test";
import assert from "node:assert/strict";
import { drawMistCell, minimapCellFill, minimapCellKind, renderStaticMinimapLayer, MinimapCamera } from "../../src/render/minimap";
import { GameMap, type TileRow } from "../../src/map/gameMap";
import { TERRAIN_COLORS } from "../../src/map/terrain";

interface MistRecordingCtx {
  ctx: CanvasRenderingContext2D;
  ops: string[];
}

function makeMistRecordingCtx(): MistRecordingCtx {
  const ops: string[] = [];
  const fmt = (n: number): string => String(Number(n.toFixed(6)));
  const ctx = {
    createLinearGradient(x0: number, y0: number, x1: number, y1: number) {
      const spec = `grad(${fmt(x0)},${fmt(y0)},${fmt(x1)},${fmt(y1)})`;
      ops.push(spec);
      return {
        addColorStop: (offset: number, color: string) => ops.push(`${spec} stop(${offset},${color})`),
        toString: () => spec,
      };
    },
    set fillStyle(value: unknown) {
      ops.push(`fill=${String(value)}`);
    },
    fillRect(x: number, y: number, w: number, h: number) {
      ops.push(`rect(${fmt(x)},${fmt(y)},${fmt(w)},${fmt(h)})`);
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, ops };
}

function withPerformanceNow(nowMs: number, fn: () => void): void {
  const own = Object.getOwnPropertyDescriptor(performance, "now");
  Object.defineProperty(performance, "now", {
    value: () => nowMs,
    writable: true,
    configurable: true,
  });
  try {
    fn();
  } finally {
    if (own) Object.defineProperty(performance, "now", own);
    else delete (performance as { now?: unknown }).now;
  }
}

function drawMistOps(q: number, r: number, nowMs?: number): string[] {
  const { ctx, ops } = makeMistRecordingCtx();
  const draw = () => drawMistCell(ctx, 10, 20, 6.5, q, r, 1.22);
  if (nowMs === undefined) draw();
  else withPerformanceNow(nowMs, draw);
  return ops;
}

test("mist cell determinism: different wall-clock times produce identical pixel ops for the same tile", () => {
  const early = drawMistOps(4, 7, 1_000.5);
  const late = drawMistOps(4, 7, 987_654_321.25);
  assert.ok(early.length > 0, "mist cell should emit canvas ops");
  assert.deepEqual(late, early);
});

test("mist cell determinism: same wall-clock independence holds across several tiles", () => {
  for (const [q, r] of [[0, 0], [3, 5], [11, 6]] as const) {
    assert.deepEqual(drawMistOps(q, r, 500), drawMistOps(q, r, 4_000_000_000), `tile ${q},${r}`);
  }
});

test("mist cell never consults the wall clock (performance.now stubbed to throw)", () => {
  const own = Object.getOwnPropertyDescriptor(performance, "now");
  Object.defineProperty(performance, "now", {
    value: () => {
      throw new Error("wall clock consulted");
    },
    writable: true,
    configurable: true,
  });
  try {
    const { ctx, ops } = makeMistRecordingCtx();
    drawMistCell(ctx, 10, 20, 6.5, 4, 7, 1.22);
    assert.ok(ops.length > 0, "mist cell should emit canvas ops");
  } finally {
    if (own) Object.defineProperty(performance, "now", own);
    else delete (performance as { now?: unknown }).now;
  }
});

test("mist cell purity: repeated calls with no clock stub produce identical ops", () => {
  assert.deepEqual(drawMistOps(12, 9), drawMistOps(12, 9));
});

test("per-tile variation preserved: distinct tiles produce distinct mist ops", () => {
  const tiles: Array<[number, number]> = [[0, 0], [3, 5], [7, 2], [11, 6], [2, 13]];
  const variants = new Set(tiles.map(([q, r]) => JSON.stringify(drawMistOps(q, r))));
  assert.equal(variants.size, tiles.length);
});

// ---------------------------------------------------------------------------
// F4 (cosmetic, same family as the tile panel's lie): the minimap painted
// every explored-but-unwatched hex as flat slate, so once a hero walked away the
// region it had uncovered lost its biome entirely and read as pure noise. The
// minimap now keeps the terrain fill for explored ground under the veil, exactly
// like the map itself does, and still hides never-revealed ground completely.
// ---------------------------------------------------------------------------

test("F4: explored ground keeps its biome on the minimap, hidden ground does not", () => {
  const revealed = new Set(["6,12"]);
  assert.equal(minimapCellKind(false, revealed, 6, 12), "explored");
  assert.equal(minimapCellKind(false, revealed, 7, 12), "uncharted");
  assert.equal(minimapCellKind(true, revealed, 7, 12), "visible");
  assert.equal(minimapCellKind(false, null, 6, 12), "fogged", "classic mode has no reveal set");
});

test("F4: an explored dirt hex fills with dirt's own colour, not the fog slate", () => {
  const explored = minimapCellFill("explored", "dirt");
  assert.equal(explored, TERRAIN_COLORS.dirt.fill);
  assert.notEqual(explored, TERRAIN_COLORS.grass.fill, "explored ground is not a single flat colour");
  assert.equal(minimapCellFill("visible", "dirt"), TERRAIN_COLORS.dirt.fill);
  assert.equal(minimapCellFill("uncharted", "dirt"), "rgba(0,0,0,1)", "never-revealed ground stays opaque black");
  assert.equal(
    minimapCellFill("fogged", "dirt"),
    "rgba(12,18,24,0.92)",
    "classic fog is unchanged",
  );
});

// The same fix driven through the real layer rather than the decision helper:
// a recording context captures every cell fill, and the explored dirt hex must
// be filled with dirt's own colour. Before the fix this cell was painted the
// flat slate "rgba(12,18,24,0.92)" and no biome survived on the minimap.
interface FillOp {
  style: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

function makeFillRecordingCtx(): { ctx: CanvasRenderingContext2D; fills: FillOp[] } {
  const fills: FillOp[] = [];
  let style = "";
  const noop = () => {};
  const ctx = {
    save: noop,
    restore: noop,
    translate: noop,
    rotate: noop,
    clip: noop,
    beginPath: noop,
    arc: noop,
    moveTo: noop,
    lineTo: noop,
    stroke: noop,
    fill: noop,
    set lineCap(_v: string) {},
    set strokeStyle(_v: string) {},
    set lineWidth(_v: number) {},
    createLinearGradient() {
      return { addColorStop: noop };
    },
    set fillStyle(v: string) {
      style = v;
    },
    get fillStyle() {
      return style;
    },
    fillRect(x: number, y: number, w: number, h: number) {
      fills.push({ style, x, y, w, h });
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fills };
}

test("F4: the minimap layer fills an explored dirt hex with dirt, never the fog slate", () => {
  const rows: TileRow[] = [];
  for (let r = 0; r < 16; r++) {
    for (let q = 0; q < 16; q++) {
      rows.push({ q, r, terrain: q === 6 && r === 12 ? "dirt" : "grass", resource: null });
    }
  }
  const map = GameMap.fromTiles(rows);
  const minimapCamera = new MinimapCamera(map);
  const geo = { x0: 0, y0: 0, w: 180, h: 180, centerX: 90, centerY: 90, baseScale: 180 / 16 };
  const cellSize = geo.baseScale * minimapCamera.zoom;
  const half = cellSize / 2;
  const { ctx, fills } = makeFillRecordingCtx();

  renderStaticMinimapLayer(
    ctx,
    map,
    minimapCamera,
    geo,
    geo.x0 - 4,
    geo.y0 - 4,
    geo.w + 8,
    geo.h + 8,
    cellSize,
    half,
    new Set<string>(),
    new Set(["6,12"]),
  );

  const cell = minimapCamera.worldToScreen(6, 12, geo);
  const dirtFill = fills.find(
    (f) => Math.abs(f.x - (cell.x - half)) < 1e-6 && Math.abs(f.y - (cell.y - half)) < 1e-6,
  );
  assert.ok(dirtFill, "the explored hex was painted at all");
  assert.equal(
    dirtFill!.style,
    TERRAIN_COLORS.dirt.fill,
    "an explored hex keeps its biome on the minimap (the map draws dirt, so must the minimap)",
  );

  const other = minimapCamera.worldToScreen(6, 13, geo);
  const grassFill = fills.find(
    (f) => Math.abs(f.x - (other.x - half)) < 1e-6 && Math.abs(f.y - (other.y - half)) < 1e-6,
  );
  assert.equal(
    grassFill!.style,
    "rgba(0,0,0,1)",
    "a never-revealed hex stays opaque black, so explored ground is still distinguishable",
  );
});
