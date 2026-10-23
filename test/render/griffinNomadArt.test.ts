// The Griffin Rider and the Desert Nomad Rider are generated from the drake and
// the ranger respectively; both ship all eight headings plus a roster banner.
// The art is glob-registered by registry id, so a missing or misnamed heading
// would silently fall back to another cardinal at runtime. This pins both
// 8-way 512px sets, the headerless banner crops, and the mirrored-diagonal
// distinctness at map size.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";

const HORSE_DIR = path.resolve("src", "resources", "units", "horse");
const DIRS = ["n", "ne", "e", "se", "s", "sw", "w", "nw"] as const;
const VARIANTS = [
  { id: "griffin", commanderDir: 17, label: "Griffin Rider" },
  { id: "nomad", commanderDir: 18, label: "Desert Nomad Rider" },
] as const;

/** The diagonal pair that is a mirror of the other on the map, per heading. */
const MIRRORED_DIAGONALS: Array<[string, string]> = [["ne", "nw"], ["se", "sw"]];

function pngSize(buf: Buffer): { width: number; height: number } {
  assert.equal(buf.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "PNG signature");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function sha(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

test("both new riders ship a distinct 512px sprite for all eight headings", () => {
  for (const variant of VARIANTS) {
    const dir = path.join(HORSE_DIR, `commander-${variant.commanderDir}`);
    const seen = new Map<string, string>();
    for (const heading of DIRS) {
      const file = path.join(dir, `${variant.id}-${heading}.png`);
      const buf = readFileSync(file);
      assert.ok(buf.length > 50_000, `${variant.id}-${heading}.png looks blank/empty (${buf.length} bytes)`);
      assert.deepEqual(pngSize(buf), { width: 512, height: 512 }, `${variant.id}-${heading}.png must be 512x512`);
      const digest = sha(buf);
      const duplicate = seen.get(digest);
      assert.equal(duplicate, undefined, `${variant.id}-${heading}.png is byte-identical to ${variant.id}-${duplicate}.png`);
      seen.set(digest, heading);
    }
  }
});

test("both new riders ship a 320x100 roster banner", () => {
  for (const variant of VARIANTS) {
    const buf = readFileSync(path.resolve("src", "resources", `hero-banner-${variant.id}.png`));
    assert.deepEqual(pngSize(buf), { width: 320, height: 100 });
  }
});

test("the mirrored diagonals differ at the size the sprite is drawn on the map", () => {
  // A diagonal generated from the wrong-side pose is a duplicate of its mirror
  // (the `nomad` `ne` was regenerated for exactly this). Compare alpha-composited
  // 48px renders — the height the sprite draws at on the adventure map (46px) —
  // and require a clear difference, since the two are legal mirrors and so do not
  // score as high as unrelated headings.
  for (const variant of VARIANTS) {
    const dir = path.join(HORSE_DIR, `commander-${variant.commanderDir}`);
    for (const [a, b] of MIRRORED_DIAGONALS) {
      const ra = downsample(path.join(dir, `${variant.id}-${a}.png`));
      const rb = downsample(path.join(dir, `${variant.id}-${b}.png`));
      const mae = ra.reduce((sum, v, i) => sum + Math.abs(v - rb[i]), 0) / ra.length;
      assert.ok(
        mae > 8,
        `${variant.id} ${a}/${b} are near-identical at map size (MAE ${mae.toFixed(2)}) — one of them is the other's pose`,
      );
    }
  }
});

/** Composites a sprite onto transparent black at the map's drawn height. */
function downsample(file: string): Buffer {
  const png = PNG.sync.read(readFileSync(file));
  const size = 48;
  const out = Buffer.alloc(size * size * 4);
  const scale = size / png.width;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sx = Math.min(png.width - 1, Math.floor(x / scale));
      const sy = Math.min(png.height - 1, Math.floor(y / scale));
      const s = (sy * png.width + sx) * 4;
      const d = (y * size + x) * 4;
      const a = png.data[s + 3] / 255;
      out[d] = Math.round(png.data[s] * a);
      out[d + 1] = Math.round(png.data[s + 1] * a);
      out[d + 2] = Math.round(png.data[s + 2] * a);
      out[d + 3] = png.data[s + 3];
    }
  }
  return out;
}
