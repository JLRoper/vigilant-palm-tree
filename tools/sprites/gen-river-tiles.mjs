#!/usr/bin/env node
// Generator for the river overlay tiles:
//   src/resources/rivers/river-{small,wide}-{end,straight,curveC,curveCC}.png
//   src/resources/rivers/river-wide-bridge.png
//
// Rivers are an OVERLAY: the biome underneath stays painted, and these tiles
// composite blue water on top. The water core is near-opaque but the banks
// fade to alpha, so grass/sand/snow underneath tints them. Each tile is
// authored with its exit edge at 0 degrees (east); the painter rotates it by
// the direction index at draw time.
//
// Rendering notes (three review-driven fixes, all deterministic):
//   - MAX-alpha blending: a pixel keeps the most opaque covering stamp, so
//     the band resolves to a smooth distance-to-polyline profile. Source-over
//     composite stacked neighbouring stamps into dark blotches and a speckled
//     shoreline that read as per-hex outlines and noise at game scale.
//   - The water profile is supersampled at S=3 subpixels and box-filtered
//     down before the nearest-neighbour upscale, so the shoreline is
//     anti-aliased instead of a staircase of discrete dots.
//   - One continuous faint highlight along the centreline instead of dash
//     dots (dashes read as noise). Plus a thin uniform bank line just inside
//     the shore, which max-blending cannot stack into a harsh outline.
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
// widest band plus its soft spill to pass the hex rim. The alpha profile is
// drawn S=3 subpixels per logical pixel, then box-filtered back down.
const LOGICAL = 88;
const S = 3; // supersample factor for the water alpha profile
const SCALE = 16; // final nearest-neighbour upscale to the family PNG size
const CENTER = LOGICAL / 2;
// Distance from the hex centre to an edge midpoint (radius * cos30).
const EDGE = (32 * Math.sqrt(3)) / 2;

const WATER = [42, 90, 138]; // #2a5a8a -- TERRAIN_COLORS.water.fill
const WATER_DK = [29, 63, 102]; // #1d3f66
const WATER_HI = [95, 147, 196]; // #5f93c4
const WOOD = [138, 98, 52]; // #8a6234
const WOOD_DK = [90, 63, 32]; // #5a3f20
const WOOD_HI = [185, 141, 80]; // #b98d50

// Buffer at subpixel resolution (LOGICAL*S per side).
function makeBuf(w, h) {
  return { w, h, px: new Uint8Array(w * h * 4) };
}

// MAX-alpha single-pixel write (subpixel coordinates).
function blendAt(buf, x, y, rgb, alpha) {
  if (x < 0 || y < 0 || x >= buf.w || y >= buf.h) return;
  const i = (y * buf.w + x) * 4;
  if (alpha <= buf.px[i + 3]) return;
  buf.px[i] = rgb[0];
  buf.px[i + 1] = rgb[1];
  buf.px[i + 2] = rgb[2];
  buf.px[i + 3] = alpha;
}

// MAX-alpha block write in LOGICAL coordinates (for the bridge planks).
function blend(buf, x, y, rgb, alpha) {
  for (let dy = 0; dy < S; dy++) {
    for (let dx = 0; dx < S; dx++) blendAt(buf, x * S + dx, y * S + dy, rgb, alpha);
  }
}

// One stamp with subpixel coverage: distances are evaluated at each
// subpixel's centre against the circle in LOGICAL units.
function stamp(buf, cx, cy, r) {
  const cx0 = cx * S;
  const cy0 = cy * S;
  const rMin = Math.floor(cx0 - (r + 3) * S);
  const rMax = Math.ceil(cx0 + (r + 3) * S);
  const cMin = Math.floor(cy0 - (r + 3) * S);
  const cMax = Math.ceil(cy0 + (r + 3) * S);
  for (let y = cMin; y <= cMax; y++) {
    for (let x = rMin; x <= rMax; x++) {
      const d = Math.sqrt((x + 0.5 - cx0) ** 2 + (y + 0.5 - cy0) ** 2) / S;
      let alpha = 0;
      let rgb = WATER;
      if (d < r * 0.55) {
        alpha = 238;
      } else if (d < r * 0.88) {
        const t = (r * 0.88 - d) / (r * 0.33); // 1 -> 0
        alpha = Math.round(238 - 150 * (1 - t));
      } else if (d < r) {
        // Thin uniform bank line just inside the shore (max-blending keeps it
        // from stacking into a harsh outline).
        alpha = 120;
        rgb = WATER_DK;
      } else if (d < r + 2) {
        const t = (r + 2 - d) / 2; // 1 -> 0
        alpha = Math.round(55 * t);
      }
      if (alpha > 0) blendAt(buf, x, y, rgb, alpha);
    }
  }
}

function ribbon(buf, pts, r) {
  for (let s = 0; s < pts.length - 1; s++) {
    const [x0, y0] = pts[s];
    const [x1, y1] = pts[s + 1];
    const seg = Math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2);
    const steps = Math.max(1, Math.round(seg / 1.2));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      stamp(buf, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r);
    }
  }
}

// One continuous, faint highlight line along the centreline.
function ripples(buf, pts) {
  for (let s = 0; s < pts.length - 1; s++) {
    const [x0, y0] = pts[s];
    const [x1, y1] = pts[s + 1];
    const seg = Math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2);
    const steps = Math.max(1, Math.round(seg / 1.2));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      stampSmall(buf, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
    }
  }
}

function stampSmall(buf, cx, cy) {
  const cx0 = cx * S;
  const cy0 = cy * S;
  for (let y = Math.floor(cy0 - 3); y <= Math.ceil(cy0 + 3); y++) {
    for (let x = Math.floor(cx0 - 3); x <= Math.ceil(cx0 + 3); x++) {
      const d = Math.sqrt((x + 0.5 - cx0) ** 2 + (y + 0.5 - cy0) ** 2) / S;
      if (d < 1.6) blendAt(buf, x, y, WATER_HI, 60);
    }
  }
}

const EDGE_E = [CENTER + EDGE, CENTER];
const EDGE_W = [CENTER - EDGE, CENTER];
const EDGE_CW = [CENTER + EDGE * 0.5, CENTER + EDGE * Math.sin(Math.PI / 3)];
const EDGE_CCW = [CENTER + EDGE * 0.5, CENTER - EDGE * Math.sin(Math.PI / 3)];

function meander(a, b, wiggle) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const nx = -dy / Math.max(1, Math.sqrt(dx * dx + dy * dy));
  const ny = dx / Math.max(1, Math.sqrt(dx * dx + dy * dy));
  const out = [a];
  for (let i = 1; i <= 3; i++) {
    const t = i / 4;
    const w = wiggle[i - 1];
    out.push([Math.round(a[0] + dx * t + nx * w), Math.round(a[1] + dy * t + ny * w)]);
  }
  out.push(b);
  return out;
}

function template(name, size) {
  const r = size === "wide" ? 9 : 7;
  const pts =
    name === "straight"
      ? meander(EDGE_W, EDGE_E, [-2.5, 3, -2])
      : name === "curveC"
        ? [[Math.round(CENTER + EDGE), CENTER], [CENTER + 14, CENTER + 4], [Math.floor(EDGE_CW[0]), Math.floor(EDGE_CW[1])]]
        : name === "curveCC"
          ? [[Math.round(CENTER + EDGE), CENTER], [CENTER + 14, CENTER - 4], [Math.floor(EDGE_CCW[0]), Math.floor(EDGE_CCW[1])]]
          : [[CENTER + 16, CENTER], [CENTER + 9, CENTER], [Math.round(CENTER + EDGE), CENTER]];
  const buf = makeBuf(LOGICAL * S, LOGICAL * S);
  ribbon(buf, pts, r);
  if (name === "end") {
    stamp(buf, CENTER + 8, CENTER, r + 1);
    stamp(buf, CENTER + 3, CENTER + 1, r - 1);
  }
  ripples(buf, pts);
  return buf;
}

function bridgeOverStraight() {
  const buf = template("straight", "wide");
  const r = 9;
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

/**
 * Box-filter the supersampled buffer to LOGICAL pixels (premultiplied-aware
 * average), then nearest-neighbour upscale to the output PNG size.
 */
function encode(buf) {
  const logical = LOGICAL;
  const mid = new Uint8Array(logical * logical * 4);
  for (let y = 0; y < logical; y++) {
    for (let x = 0; x < logical; x++) {
      const acc = [0, 0, 0, 0];
      for (let dy = 0; dy < S; dy++) {
        for (let dx = 0; dx < S; dx++) {
          const i = ((y * S + dy) * logical * S + (x * S + dx)) * 4;
          const a = buf.px[i + 3] / 255;
          acc[0] += buf.px[i] * a;
          acc[1] += buf.px[i + 1] * a;
          acc[2] += buf.px[i + 2] * a;
          acc[3] += a;
        }
      }
      const n = S * S;
      const mi = (y * logical + x) * 4;
      const a = acc[3] / n;
      if (a > 0) {
        mid[mi] = Math.round(acc[0] / acc[3]);
        mid[mi + 1] = Math.round(acc[1] / acc[3]);
        mid[mi + 2] = Math.round(acc[2] / acc[3]);
        mid[mi + 3] = Math.round(a * 255);
      }
    }
  }

  const w = logical * SCALE;
  const h = logical * SCALE;
  const stride = w * 4;
  const raw = new Uint8Array((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    const srcY = Math.floor(y / SCALE);
    raw[y * (stride + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const srcX = Math.floor(x / SCALE);
      const s = (srcY * logical + srcX) * 4;
      const d = y * (stride + 1) + 1 + x * 4;
      raw[d] = mid[s];
      raw[d + 1] = mid[s + 1];
      raw[d + 2] = mid[s + 2];
      raw[d + 3] = mid[s + 3];
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
    emit(`river-${size}-${mask}`, template(mask, size));
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