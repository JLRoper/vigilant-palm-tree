import { PNG } from "pngjs";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface PixelDiffResult {
  ok: boolean;
  reason?: string;
  width?: number;
  height?: number;
  mismatchedPixels?: number;
  totalPixels?: number;
  mismatchRatio?: number;
}

const CHANNEL_TOLERANCE = 24;
const MISMATCH_RATIO_THRESHOLD = 0.005;

function channelsDiffer(a: PNG, b: PNG, i: number): boolean {
  for (let c = 0; c < 3; c++) {
    if (Math.abs(a.data[i + c] - b.data[i + c]) > CHANNEL_TOLERANCE) return true;
  }
  if (Math.abs(a.data[i + 3] - b.data[i + 3]) > CHANNEL_TOLERANCE) return true;
  return false;
}

/**
 * Compares a freshly captured screenshot against a committed baseline PNG.
 * If the baseline doesn't exist yet, or `updateBaseline` is set, writes
 * `actualPng` as the new baseline instead of comparing.
 */
export function comparePng(
  baselinePath: string,
  actualPng: Buffer,
  opts: { updateBaseline: boolean } = { updateBaseline: false },
): PixelDiffResult {
  if (opts.updateBaseline || !existsSync(baselinePath)) {
    mkdirSync(dirname(baselinePath), { recursive: true });
    writeFileSync(baselinePath, actualPng);
    return { ok: true, reason: "baseline written" };
  }

  const baseline = PNG.sync.read(readFileSync(baselinePath));
  const actual = PNG.sync.read(actualPng);

  if (baseline.width !== actual.width || baseline.height !== actual.height) {
    return {
      ok: false,
      reason: `size mismatch: baseline ${baseline.width}x${baseline.height} vs actual ${actual.width}x${actual.height}`,
    };
  }

  const { width, height } = baseline;
  const diff = new PNG({ width, height });
  let mismatchedPixels = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (width * y + x) << 2;
      const differs = channelsDiffer(baseline, actual, i);
      if (differs) {
        mismatchedPixels++;
        diff.data[i] = 255;
        diff.data[i + 1] = 0;
        diff.data[i + 2] = 0;
        diff.data[i + 3] = 255;
      } else {
        diff.data[i] = actual.data[i];
        diff.data[i + 1] = actual.data[i + 1];
        diff.data[i + 2] = actual.data[i + 2];
        diff.data[i + 3] = 64;
      }
    }
  }

  const totalPixels = width * height;
  const mismatchRatio = mismatchedPixels / totalPixels;
  const ok = mismatchRatio <= MISMATCH_RATIO_THRESHOLD;

  if (!ok) {
    const diffPath = baselinePath.replace(/\.png$/, ".diff.png");
    writeFileSync(diffPath, PNG.sync.write(diff));
  }

  return {
    ok,
    reason: ok ? undefined : `mismatch ratio ${(mismatchRatio * 100).toFixed(3)}% exceeds threshold ${(MISMATCH_RATIO_THRESHOLD * 100).toFixed(3)}%`,
    width,
    height,
    mismatchedPixels,
    totalPixels,
    mismatchRatio,
  };
}

/** Diffs two freshly captured PNGs against each other (no baseline involved). */
export function diffPngBuffers(aPng: Buffer, bPng: Buffer): PixelDiffResult {
  const a = PNG.sync.read(aPng);
  const b = PNG.sync.read(bPng);

  if (a.width !== b.width || a.height !== b.height) {
    return { ok: false, reason: `size mismatch: ${a.width}x${a.height} vs ${b.width}x${b.height}` };
  }

  const { width, height } = a;
  let mismatchedPixels = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (width * y + x) << 2;
      if (channelsDiffer(a, b, i)) mismatchedPixels++;
    }
  }

  const totalPixels = width * height;
  const mismatchRatio = mismatchedPixels / totalPixels;
  return {
    ok: mismatchRatio <= MISMATCH_RATIO_THRESHOLD,
    reason: mismatchRatio <= MISMATCH_RATIO_THRESHOLD ? undefined : `mismatch ratio ${(mismatchRatio * 100).toFixed(3)}%`,
    width,
    height,
    mismatchedPixels,
    totalPixels,
    mismatchRatio,
  };
}
