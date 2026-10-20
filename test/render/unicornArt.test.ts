// The two unicorn mounts are the pair the adventure map must render from
// every reachable heading: the light unicorn (registry id `bubbly`, the
// repainted old bubbly slot) and the dark unicorn (`unicorn`). Their art is
// glob-registered, so a missing or misnamed diagonal silently falls back to
// another heading at runtime — this pins the file set from disk.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const HORSE_DIR = path.resolve("src", "resources", "units", "horse");
const MAP_DIRS = ["e", "ne", "nw", "w", "sw", "se"] as const;
const UNICORNS = [
  { id: "bubbly", commanderDir: 2 },
  { id: "unicorn", commanderDir: 7 },
] as const;

function pngSize(buf: Buffer): { width: number; height: number } {
  assert.equal(buf.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "PNG signature");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function sha(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

test("both unicorn variants ship a distinct 512px sprite for all six map headings", () => {
  for (const unicorn of UNICORNS) {
    const dir = path.join(HORSE_DIR, `commander-${unicorn.commanderDir}`);
    const seen = new Map<string, string>();
    for (const heading of MAP_DIRS) {
      const file = path.join(dir, `${unicorn.id}-${heading}.png`);
      const buf = readFileSync(file);
      assert.ok(buf.length > 50_000, `${unicorn.id}-${heading}.png looks blank/empty (${buf.length} bytes)`);
      assert.deepEqual(pngSize(buf), { width: 512, height: 512 }, `${unicorn.id}-${heading}.png must be 512x512`);
      const digest = sha(buf);
      const duplicate = seen.get(digest);
      assert.equal(duplicate, undefined, `${unicorn.id}-${heading}.png is byte-identical to ${unicorn.id}-${duplicate}.png`);
      seen.set(digest, heading);
    }
  }
});

test("both unicorn variants ship a gallop frame for every map heading", () => {
  for (const unicorn of UNICORNS) {
    const dir = path.join(HORSE_DIR, `commander-${unicorn.commanderDir}`);
    for (const heading of MAP_DIRS) {
      const file = path.join(dir, `${unicorn.id}-${heading}-2.png`);
      const buf = readFileSync(file);
      assert.ok(buf.length > 50_000, `${unicorn.id}-${heading}-2.png looks blank/empty (${buf.length} bytes)`);
      assert.deepEqual(pngSize(buf), { width: 512, height: 512 }, `${unicorn.id}-${heading}-2.png must be 512x512`);
    }
  }
});

test("the light unicorn's roster banner is a 320x100 PNG", () => {
  const buf = readFileSync(path.resolve("src", "resources", "hero-banner-bubbly.png"));
  assert.deepEqual(pngSize(buf), { width: 320, height: 100 });
});
