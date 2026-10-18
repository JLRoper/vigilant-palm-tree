#!/usr/bin/env node
// Generator for the shipyard building sprites:
//   src/resources/buildings/building-pixel-shipyard-{1,2,3}.png
//
// Every other building-pixel-* sprite in that folder came from an illustrated
// pipeline (tools/sprites/flux-*.mjs) whose output cannot be reproduced from
// source. The shipyard needs the same treatment the rest of the registry gets --
// a key in BUILDING_SPRITE_FILES (npm run gen:sprite-keys) and a measured
// bottom pad (npm run gen:building-anchors) -- so this script draws it in the
// same pixel idiom with a plain deterministic rasteriser instead: 64x64 logical
// pixels, 16x nearest-neighbour upscale, dark outline / mid tone / highlight
// ramps, transparent margins.
//
// Usage:
//   node tools/sprites/gen-shipyard-sprite.mjs           # write the 3 PNGs
//   node tools/sprites/gen-shipyard-sprite.mjs --check   # verify on-disk bytes match
//
// The output is byte-stable: same script, same PNGs.

import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const OUT_DIR = path.join(ROOT, "src", "resources", "buildings");

const LOGICAL = 64;
const SCALE = 16;
const SIZE = LOGICAL * SCALE;

const PAL = {
  outline: "#1a1410",
  wood: "#8a6234",
  woodDk: "#5a3f20",
  woodHi: "#b98d50",
  plank: "#a07540",
  stone: "#a8a8a0",
  stoneDk: "#585850",
  stoneHi: "#d0d0c8",
  water: "#2f5f8f",
  waterDk: "#1d3f66",
  waterHi: "#5f93c4",
  foam: "#bcd8ee",
  rope: "#d8c9a0",
  sail: "#e8e0cc",
  sailDk: "#b8ad92",
  banner: "#c0392b",
  bannerDk: "#7d2318",
  metal: "#787886",
  metalHi: "#b0b0c0",
  lamp: "#ffd84a",
};

// ---------- tiny raster helpers (logical 64x64 grid) ----------

function makeBuf(w, h) {
  return { w, h, px: new Uint8Array(w * h * 4) };
}

function parseHex(hex) {
  const h = hex.startsWith("#") ? hex.slice(1) : hex;
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

function px(buf, x, y, color) {
  if (x < 0 || y < 0 || x >= buf.w || y >= buf.h) return;
  const [r, g, b, a] = parseHex(color);
  const i = (y * buf.w + x) * 4;
  buf.px[i] = r;
  buf.px[i + 1] = g;
  buf.px[i + 2] = b;
  buf.px[i + 3] = a;
}

function rect(buf, x, y, w, h, color) {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) px(buf, xx, yy, color);
}

function outline(buf, x, y, w, h, color = PAL.outline) {
  rect(buf, x, y, w, 1, color);
  rect(buf, x, y + h - 1, w, 1, color);
  rect(buf, x, y, 1, h, color);
  rect(buf, x + w - 1, y, 1, h, color);
}

/** Box with outline + a one-pixel highlight on top and shadow on the bottom. */
function box(buf, x, y, w, h, fill, hi = null, dk = null) {
  rect(buf, x, y, w, h, fill);
  if (hi) rect(buf, x + 1, y + 1, w - 2, 1, hi);
  if (dk) rect(buf, x + 1, y + h - 2, w - 2, 1, dk);
  outline(buf, x, y, w, h);
}

// ---------- shipyard parts ----------

/** Water slab with wave dashes, drawn from `y0` to the bottom margin. */
function water(buf, y0) {
  rect(buf, 0, y0, LOGICAL, LOGICAL - y0 - 2, PAL.water);
  rect(buf, 0, y0, LOGICAL, 1, PAL.waterHi);
  for (let i = 0; i < LOGICAL; i += 8) {
    rect(buf, i + 2, y0 + 4, 4, 1, PAL.waterDk);
    rect(buf, i + 6, y0 + 9, 3, 1, PAL.waterHi);
  }
}

/** Timber pier: deck planks on posts. */
function pier(buf, x0, x1, yTop) {
  const w = x1 - x0 + 1;
  box(buf, x0, yTop, w, 5, PAL.plank, PAL.woodHi, PAL.woodDk);
  for (let x = x0 + 2; x < x1 - 1; x += 5) {
    rect(buf, x, yTop + 1, 1, 3, PAL.woodDk);
  }
  for (let x = x0 + 3; x <= x1 - 3; x += 9) {
    rect(buf, x, yTop + 5, 2, 6, PAL.woodDk);
  }
}

/** A hull under construction: keel, ribs, one plank run. */
function hull(buf, x, y, w, h, { ribs = 3, plank = true } = {}) {
  // Tapered bottom: draw as stacked rows narrowing toward the keel.
  for (let row = 0; row < h; row++) {
    const inset = Math.floor((row / Math.max(1, h - 1)) * (w / 2 - 1));
    const rowX = x + inset;
    const rowW = w - inset * 2;
    if (rowW <= 0) continue;
    const fill = row === h - 1 ? PAL.woodDk : PAL.wood;
    rect(buf, rowX, y + row, rowW, 1, fill);
    px(buf, rowX, y + row, PAL.outline);
    px(buf, rowX + rowW - 1, y + row, PAL.outline);
  }
  rect(buf, x + 1, y, w - 2, 1, PAL.woodHi);
  if (plank) rect(buf, x + 2, y + 2, w - 4, 1, PAL.plank);
  for (let i = 1; i <= ribs; i++) {
    const rx = x + Math.round((w / (ribs + 1)) * i);
    rect(buf, rx, y - 2, 1, 3, PAL.woodHi);
  }
  rect(buf, x + Math.floor(w / 2) - 1, y - 9, 2, 9, PAL.woodDk);
  rect(buf, x + Math.floor(w / 2), y - 13, 1, 4, PAL.woodDk);
}

/** A-frame or gantry crane with an arm and a rope. */
function crane(buf, x, yBase, height, armLen, { gantry = false } = {}) {
  const top = yBase - height;
  if (gantry) {
    rect(buf, x, top, 3, height, PAL.wood);
    rect(buf, x + 3, top, 3, height, PAL.wood);
    rect(buf, x, top, 6, 3, PAL.woodDk);
    outline(buf, x, top, 6, height);
  } else {
    rect(buf, x, top, 3, height, PAL.wood);
    outline(buf, x, top, 3, height);
    // Diagonal brace
    for (let i = 0; i < height - 4; i += 3) rect(buf, x + 1, top + i, 1, 1, PAL.woodDk);
  }
  rect(buf, x + (gantry ? 3 : 1), top, armLen, 2, PAL.woodDk);
  outline(buf, x + (gantry ? 3 : 1), top, armLen, 2);
  const hookX = x + (gantry ? 3 : 1) + armLen - 2;
  rect(buf, hookX, top + 2, 1, Math.max(3, yBase - top - 6), PAL.rope);
  rect(buf, hookX - 1, yBase - 4, 3, 2, PAL.metal);
  rect(buf, hookX - 1, yBase - 4, 3, 1, PAL.metalHi);
}

/** Dock shed / yard hut with a pitched roof and a lamp. */
function shed(buf, x, y, w, h, { banner = false } = {}) {
  box(buf, x, y + 2, w, h - 2, PAL.wood, PAL.woodHi, PAL.woodDk);
  const roofH = 3;
  for (let row = 0; row < roofH; row++) {
    const inset = roofH - row - 1;
    rect(buf, x + inset, y + row, w - inset * 2, 1, row === 0 ? PAL.bannerDk : PAL.woodDk);
  }
  outline(buf, x, y, w, h);
  rect(buf, x + Math.floor(w / 2) - 2, y + h - 6, 4, 6, PAL.outline);
  rect(buf, x + 2, y + h - 8, 2, 2, PAL.lamp);
  if (banner) {
    rect(buf, x + w - 3, y - 4, 1, 6, PAL.woodDk);
    rect(buf, x + w - 2, y - 4, 4, 3, PAL.banner);
    rect(buf, x + w - 2, y - 2, 4, 1, PAL.bannerDk);
  }
}

// ---------- the three tiers ----------

function drawLevel1(buf) {
  water(buf, 46);
  pier(buf, 4, 59, 40);
  hull(buf, 26, 24, 26, 16, { ribs: 3 });
  crane(buf, 8, 40, 22, 16);
}

function drawLevel2(buf) {
  water(buf, 44);
  pier(buf, 2, 61, 38);
  hull(buf, 22, 20, 30, 18, { ribs: 4 });
  crane(buf, 6, 38, 28, 20, { gantry: true });
  shed(buf, 48, 20, 14, 18);
}

function drawLevel3(buf) {
  water(buf, 42);
  pier(buf, 0, 63, 36);
  hull(buf, 16, 18, 26, 18, { ribs: 3 });
  hull(buf, 40, 22, 22, 14, { ribs: 2 });
  crane(buf, 4, 36, 32, 24, { gantry: true });
  shed(buf, 30, 14, 14, 22, { banner: true });
}

const LEVELS = [
  { level: 1, draw: drawLevel1 },
  { level: 2, draw: drawLevel2 },
  { level: 3, draw: drawLevel3 },
];

// ---------- PNG encoder (RGBA, filter 0, zlib) ----------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = data.length;
  const out = new Uint8Array(4 + 4 + len + 4);
  out[0] = (len >>> 24) & 0xff;
  out[1] = (len >>> 16) & 0xff;
  out[2] = (len >>> 8) & 0xff;
  out[3] = len & 0xff;
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const crcInput = new Uint8Array(4 + len);
  crcInput.set(out.subarray(4, 4 + 4 + len), 0);
  const c = crc32(crcInput);
  out[8 + len] = (c >>> 24) & 0xff;
  out[8 + len + 1] = (c >>> 16) & 0xff;
  out[8 + len + 2] = (c >>> 8) & 0xff;
  out[8 + len + 3] = c & 0xff;
  return out;
}

/** Nearest-neighbour upscale of the logical buffer, then PNG-encode. */
function encode(buf) {
  const w = buf.w * SCALE;
  const h = buf.h * SCALE;
  const stride = w * 4;
  const raw = new Uint8Array((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    const srcY = Math.floor(y / SCALE);
    raw[y * (stride + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const srcX = Math.floor(x / SCALE);
      const s = (srcY * buf.w + srcX) * 4;
      const d = y * (stride + 1) + 1 + x * 4;
      raw[d] = buf.px[s];
      raw[d + 1] = buf.px[s + 1];
      raw[d + 2] = buf.px[s + 2];
      raw[d + 3] = buf.px[s + 3];
    }
  }
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = new Uint8Array(13);
  ihdr[0] = (w >>> 24) & 0xff;
  ihdr[1] = (w >>> 16) & 0xff;
  ihdr[2] = (w >>> 8) & 0xff;
  ihdr[3] = w & 0xff;
  ihdr[4] = (h >>> 24) & 0xff;
  ihdr[5] = (h >>> 16) & 0xff;
  ihdr[6] = (h >>> 8) & 0xff;
  ihdr[7] = h & 0xff;
  ihdr[8] = 8;
  ihdr[9] = 6;
  const compressed = deflateSync(raw, { level: 9 });
  const parts = [
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", compressed),
    chunk("IEND", new Uint8Array(0)),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const png = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    png.set(p, off);
    off += p.length;
  }
  return png;
}

// ---------- run ----------

const checkOnly = process.argv.slice(2).includes("--check");
let drift = 0;

for (const { level, draw } of LEVELS) {
  const buf = makeBuf(LOGICAL, LOGICAL);
  draw(buf);
  const png = encode(buf);
  const file = path.join(OUT_DIR, `building-pixel-shipyard-${level}.png`);
  if (checkOnly) {
    let existing = null;
    try {
      existing = readFileSync(file);
    } catch {
      // missing -> drift
    }
    if (!existing || !existing.equals(Buffer.from(png))) {
      console.error(`drift: ${path.relative(ROOT, file)} is missing or out of date`);
      drift++;
    }
    continue;
  }
  writeFileSync(file, png);
  console.log("wrote", path.relative(ROOT, file), png.length, "bytes");
}

if (checkOnly) {
  if (drift > 0) {
    console.error("fix: node tools/sprites/gen-shipyard-sprite.mjs");
    process.exit(1);
  }
  console.log("shipyard sprites up to date.");
}
