import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The 16 directional caravan PNGs are generated (six headings per kind) and
// derived (se/ne are mirrors of sw/nw), so the file set is the contract the
// glob-driven CARAVAN_DESCRIPTORS depends on. A missing or misnamed file would
// silently fall back to another heading at runtime; this catches it from disk
// like the unit-arena art coverage test does.

const DIRS = ["n", "ne", "e", "se", "s", "sw", "w", "nw"] as const;
const KINDS = ["supply", "treasury"] as const;
const ART_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "resources", "caravans");

function pngSize(buf: Buffer): { width: number; height: number } {
  assert.equal(buf.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "PNG signature");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

test("every caravan kind has all eight 256px direction sprites on disk", () => {
  for (const kind of KINDS) {
    for (const dir of DIRS) {
      const file = path.join(ART_DIR, `${kind}-${dir}.png`);
      const buf = readFileSync(file);
      assert.ok(buf.length > 20_000, `${kind}-${dir}.png looks blank/empty (${buf.length} bytes)`);
      assert.deepEqual(pngSize(buf), { width: 256, height: 256 }, `${kind}-${dir}.png must be 256x256`);
    }
  }
});

test("the mirrored diagonals are distinct files, not copies aliased onto their source", () => {
  for (const kind of KINDS) {
    const nw = readFileSync(path.join(ART_DIR, `${kind}-nw.png`));
    const ne = readFileSync(path.join(ART_DIR, `${kind}-ne.png`));
    const sw = readFileSync(path.join(ART_DIR, `${kind}-sw.png`));
    const se = readFileSync(path.join(ART_DIR, `${kind}-se.png`));
    assert.notDeepEqual(ne, nw, `${kind}-ne must be the mirrored image, not the nw bytes`);
    assert.notDeepEqual(se, sw, `${kind}-se must be the mirrored image, not the sw bytes`);
  }
});
