#!/usr/bin/env node
// Generator for the river overlay tiles:
//   src/resources/rivers/river-{small,wide}-{end,straight,curveC,curveCC}.png
//   src/resources/rivers/river-wide-bridge.png
//
// Rivers are an OVERLAY: the biome underneath stays painted, and these tiles
// composite blue water on top. The water core is near-opaque but every bank
// and the soft shoreline edge fade to alpha, so grass/sand/snow underneath
// tints the banks -- "the water picks up the biome's colour" without baking
// per-biome variants. Each tile is authored with its exit edge at 0 degrees
// (east); the painter rotates it by the direction index at draw time.
//
// Pure-Node deterministic rasteriser, same idiom as gen-shipyard-sprite.mjs:
// a logical grid, circle stamps along a polyline, then a nearest-neighbour
// upscale into a PNG (filter 0, zlib) that is byte-stable across runs.
//
// Usage:
//   node tools/sprites/gen-river-tiles.mjs           # write the PNGs
//   node tools/sprites/gen-river-tiles.mjs --check   # verify on-disk bytes match

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const OUT_DIR = path.join(ROOT, "src", "resources", "rivers");
mkdirSync(OUT_DIR, { recursive: true });

// Logical canvas 88x88: hex radius 32 centred on (44,44) leaves room for the
// widest band (radius 11) plus its 2px soft edge to spill past the hex rim.
const LOGICAL = 88;
const SCALE = 16;
const CENTER = LOGICAL / 2;
// Distance from the hex centre to an edge midpoint (radius * cos30).
const EDGE = (32 * Math.sqrt(3)) / 2;

const WATER = [42, 90, 138]; // #2a5a8a -- TERRAIN_COLORS.water.fill
const WATER_DK = [29, 63, 102]; // #1d3f66
const WATER_HI = [95, 147, 196]; // #5f93c4
const WOOD = [138, 98, 52]; // #8a6234
const WOOD_DK = [90, 63, 32]; // #5a3f20
const WOOD_HI = [185, 141, 80]; // #b98d50

function makeBuf(w, h) {
  return { w, h, px: new Uint8Array(w * h * 4) };
}

// Blend `rgb` over whatever is already at (x,y) using `alpha`.
function blend(buf, x, y, rgb, alpha) {
  if (x < 0 || y < 0 || x >= buf.w || y >= buf.h) return;
  const i = (y * buf.w + x) * 4;
  const a = alpha / 255;
  const outA = a + (buf.px[i + 3] / 255) * (1 - a);
  if (outA <= 0) return;
  buf.px[i] = Math.round((rgb[0] * a + buf.px[i] * (1 - a)) / outA);
  buf.px[i + 1] = Math.round((rgb[1] * a + buf.px[i + 1] * (1 - a)) / outA);
  buf.px[i + 2] = Math.round((rgb[2] * a + buf.px[i + 2] * (1 - a)) / outA);
  buf.px[i + 3] = Math.round(outA * 255);
}

/** Stamp one circle of the given radius: core, dark bank rim, soft alpha edge. */
function stamp(buf, cx, cy, r) {
  const rMin = Math.floor(cx - r - 2);
  const rMax = Math.ceil(cx + r + 2);
  const cMin = Math.floor(cy - r - 2);
  const cMax = Math.ceil(cy + r + 2);
  for (let y = cMin; y <= cMax; y++) {
    for (let x = rMin; x <= rMax; x++) {
      const d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
      if (d < r - 1.5) blend(buf, x, y, WATER, 240);
      else if (d < r) blend(buf, x, y, WATER_DK, 255);
      else if (d < r + 2) {
        const t = (r + 2 - d) / 2; // 1 -> 0 across the soft edge
        blend(buf, x, y, WATER, Math.round(170 * t));
      }
    }
  }
}

/** Stamp the river polyline: circle stamps stepped along each segment. */
function ribbon(buf, pts, r) {
  for (let s = 0; s < pts.length - 1; s++) {
    const [x0, y0] = pts[s];
    const [x1, y1] = pts[s + 1];
    const seg = Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0));
    const steps = Math.max(1, Math.round(seg / 1.2));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      stamp(buf, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r);
    }
  }
}

/** Light ripple dashes along the centreline, deterministic offsets. */
function ripples(buf, pts, phase, len = 3, gap = 7) {
  let acc = phase;
  for (let s = 0; s < pts.length - 1; s++) {
    const [x0, y0] = pts[s];
    const [x1, y1] = pts[s + 1];
    const seg = Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0));
    const steps = Math.max(1, Math.round(seg));
    for (let i = 0; i <= steps; i++) {
      if (Math.floor(acc) % (len + gap) < len) {
        const t = i / steps;
        const x = Math.round(x0 + (x1 - x0) * t);
        const y = Math.round(y0 + (y1 - y0) * t);
        blend(buf, x, y, WATER_HI, 120);
        blend(buf, x - 1, y, WATER_HI, 90);
      }
      acc += 1;
    }
  }
}

const EDGE_E = [CENTER + EDGE, CENTER];
const EDGE_W = [CENTER - EDGE, CENTER];
// Edge midpoints at 60 and 300 degrees (screen-y down): NE and SE of the hex.
const EDGE_CW = [CENTER + EDGE * 0.5, CENTER + EDGE * Math.sin(Math.PI / 3)];
const EDGE_CCW = [CENTER + EDGE * 0.5, CENTER - EDGE * Math.sin(Math.PI / 3)];

function meander(a, b, wiggle) {
  // Five points from a to b, the three interior ones nudged perpendicular.
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const nx = -dy / Math.max(1, Math.sqrt(dx * dx + dy * dy));
  const ny = dx / Math.max(1, Math.sqrt(dx * dx + dy * dy));
  const out = [a];
  for (let i = 1; i <= 3; i++) {
    const t = i / 4;
    const w = wiggle[i - 1];
    out.push([
      Math.round(a[0] + dx * t + nx * w),
      Math.round(a[1] + dy * t + ny * w),
    ]);
  }
  out.push(b);
  return out;
}

function template(name, size) {
  const r = size === "wide" ? 11 : 7;
  const pts =
    name === "straight"
      ? meander(EDGE_W, EDGE_E, [-2.5, 3, -2])
      : name === "curveC"
        ? [[Math.round(CENTER + EDGE), CENTER], [CENTER + 14, CENTER + 4], [EDGE_CW[0] | 0, EDGE_CW[1] | 0]]
        : name === "curveCC"
          ? [[Math.round(CENTER + EDGE), CENTER], [CENTER + 14, CENTER - 4], [EDGE_CCW[0] | 0, EDGE_CCW[1] | 0]]
          : // end: a rounded source blob with a short tail to the east edge
            [[CENTER + 16, CENTER], [CENTER + 9, CENTER], [Math.round(CENTER + EDGE), CENTER]];
  const buf = makeBuf(LOGICAL, LOGICAL);
  ribbon(buf, pts, r);
  // The end template's western blob: a second heavier stamp for the pool.
  if (name === "end") {
    stamp(buf, CENTER + 8, CENTER, r + 1);
    stamp(buf, CENTER + 3, CENTER + 1, r - 1);
  }
  ripples(buf, pts, size === "wide" ? 2 : 0);
  return { buf, pts, r };
}

function bridgeOverStraight() {
  // Wide water band, then a wooden bridge crossing it vertically near centre.
  const { buf, pts, r } = template("straight", "wide");
  // Silhouette the crossing with an outline-free plank span: vertical strip
  // across the band, planks running horizontally (perpendicular to the river).
  const x0 = CENTER - 5;
  const x1 = CENTER + 5;
  for (let y = CENTER - 2 * r - 2; y <= CENTER + 2 * r + 2; y++) {
    const row = y % 4 < 2 ? WOOD : WOOD_DK;
    for (let x = x0; x <= x1; x++) blend(buf, x, y, row, 255);
  }
  for (const y of [CENTER - 2 * r - 2, CENTER + 2 * r + 2]) {
    for (let x = x0; x <= x1; x++) blend(buf, x, y, WOOD_DK, 255);
  }
  for (const x of [x0 - 1, x1 + 1]) {
    for (let y = CENTER - 2 * r - 4; y <= CENTER + 2 * r + 4; y++) {
      blend(buf, x, y, WOOD_DK, 255);
    }
  }
  blend(buf, CENTER, CENTER - 2 * r - 3, WOOD_HI, 255);
  blend(buf, CENTER, CENTER + 2 * r + 3, WOOD_HI, 255);
  void pts;
  return buf;
}

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
  const parts = [sig, chunk("IHDR", ihdr), chunk("IDAT", compressed), chunk("IEND", new Uint8Array(0))];
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

const MASKS = ["end", "straight", "curveC", "curveCC"];
const checkOnly = process.argv.slice(2).includes("--check");
let drift = 0;

function emit(name, buf) {
  const file = path.join(OUT_DIR, `${name}.png`);
  const png = encode(buf);
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
    return;
  }
  writeFileSync(file, png);
  console.log("wrote", path.relative(ROOT, file), png.length, "bytes");
}

for (const size of ["small", "wide"]) {
  for (const mask of MASKS) {
    emit(`river-${size}-${mask}`, template(mask, size).buf);
  }
}
emit("river-wide-bridge", bridgeOverStraight());

if (checkOnly) {
  if (drift > 0) {
    console.error("fix: node tools/sprites/gen-river-tiles.mjs");
    process.exit(1);
  }
  console.log("river tiles up to date.");
}