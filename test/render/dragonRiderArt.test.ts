// The two dragon riders are generated from the drake's four cardinals; their
// diagonals are re-posed three-quarters. The art is glob-registered by
// registry id, so a missing or misnamed heading would silently fall back to
// another cardinal at runtime. This pins the full 8-way set and its banners.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const HORSE_DIR = path.resolve("src", "resources", "units", "horse");
const DIRS = ["n", "ne", "e", "se", "s", "sw", "w", "nw"] as const;
const RIDERS = [
  { id: "blackdragon", commanderDir: 15 },
  { id: "reddragon", commanderDir: 16 },
] as const;

function pngSize(buf: Buffer): { width: number; height: number } {
  assert.equal(buf.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "PNG signature");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function sha(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

test("both dragon riders ship a distinct 512px sprite for all eight headings", () => {
  for (const rider of RIDERS) {
    const dir = path.join(HORSE_DIR, `commander-${rider.commanderDir}`);
    const seen = new Map<string, string>();
    for (const heading of DIRS) {
      const file = path.join(dir, `${rider.id}-${heading}.png`);
      const buf = readFileSync(file);
      assert.ok(buf.length > 50_000, `${rider.id}-${heading}.png looks blank/empty (${buf.length} bytes)`);
      assert.deepEqual(pngSize(buf), { width: 512, height: 512 }, `${rider.id}-${heading}.png must be 512x512`);
      const digest = sha(buf);
      const duplicate = seen.get(digest);
      assert.equal(duplicate, undefined, `${rider.id}-${heading}.png is byte-identical to ${rider.id}-${duplicate}.png`);
      seen.set(digest, heading);
    }
  }
});

test("both dragon riders ship a 320x100 roster banner", () => {
  for (const rider of RIDERS) {
    const buf = readFileSync(path.resolve("src", "resources", `hero-banner-${rider.id}.png`));
    assert.deepEqual(pngSize(buf), { width: 320, height: 100 });
  }
});
