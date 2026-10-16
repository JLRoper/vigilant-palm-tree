import { test } from "node:test";
import assert from "node:assert/strict";
import { drawMistCell } from "../../src/render/minimap";

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
