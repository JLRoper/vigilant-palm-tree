#!/usr/bin/env node
// Deterministic, grid-exact isometric farm-field sprites.
//
// Why this exists: the model-generated farmField art is drawn in a ~1.45:1
// isometric diamond (30 deg) and carries a thick soil plinth. The city view is
// a true 2:1 dimetric grid (TILE_W 96 x TILE_D 48), so those plots read as
// askew and float inside their 2x2 footprint. This generator emits art whose
// ground plane is defined by the grid, not by a model:
//
//   * logical canvas 128x128, the plot diamond is 128 wide and 64 tall
//   * the diamond's south vertex is the bottom row of the canvas
//   * every pixel is upscaled 8x nearest-neighbour -> 1024x1024 PNG
//
// Drawn with `fitWidth` and hexSizeMul 1.0 the diamond maps exactly onto a 2x2
// city footprint: width 192 CSS px at tileScale 1, height 96, bottom vertex on
// the footprint's south vertex (see src/core/cityGrid.ts buildingFootprint).
// The 1024 canvas is square like the rest of the family, so the aspect-based
// height solve stays sh === sw; props above the north corner are free.
//
// Usage:
//   node tools/sprites/gen-farm-sprites.mjs                # write all styles
//   node tools/sprites/gen-farm-sprites.mjs --check        # verify bytes on disk
//   node tools/sprites/gen-farm-sprites.mjs --only wheat   # one style
//   node tools/sprites/gen-farm-sprites.mjs --preview 3    # 3x upscale for review
//
// Style keys are the sprite-key middle segment: building-pixel-<style>-1.png
// becomes key `pixel.<style>.1` (tools/sprites/gen-building-sprite-keys.mjs).

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, "..", "..", "src", "resources", "buildings");

const LOGICAL = 128;
const SCALE = 8;

// ── pixel buffer ─────────────────────────────────────────────────────
function makeBuf(w, h) {
  return { w, h, px: new Uint8Array(w * h * 4) };
}

function parseHex(hex) {
  const h = hex.startsWith("#") ? hex.slice(1) : hex;
  const n = parseInt(h, 16);
  if (h.length === 6) return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  if (h.length === 8) return [(n >> 24) & 255, (n >> 16) & 255, (n >> 8) & 255];
  throw new Error(`bad colour ${hex}`);
}

function put(buf, x, y, color, alpha = 255) {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || y < 0 || x >= buf.w || y >= buf.h) return;
  const [r, g, b] = parseHex(color);
  const i = (y * buf.w + x) * 4;
  buf.px[i] = r;
  buf.px[i + 1] = g;
  buf.px[i + 2] = b;
  buf.px[i + 3] = alpha;
}

function blend(buf, x, y, color, t = 0.5) {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || y < 0 || x >= buf.w || y >= buf.h) return;
  const i = (y * buf.w + x) * 4;
  if (buf.px[i + 3] === 0) return;
  const [r, g, b] = parseHex(color);
  buf.px[i] = Math.round(buf.px[i] * (1 - t) + r * t);
  buf.px[i + 1] = Math.round(buf.px[i + 1] * (1 - t) + g * t);
  buf.px[i + 2] = Math.round(buf.px[i + 2] * (1 - t) + b * t);
}

function rect(buf, x, y, w, h, color) {
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) put(buf, x + xx, y + yy, color);
}

function hline(buf, x0, x1, y, color) {
  const a = Math.min(x0, x1);
  const b = Math.max(x0, x1);
  for (let x = a; x <= b; x++) put(buf, x, y, color);
}

function vline(buf, x, y0, y1, color) {
  const a = Math.min(y0, y1);
  const b = Math.max(y0, y1);
  for (let y = a; y <= b; y++) put(buf, x, y, color);
}

function hash(x, y, seed) {
  // Decorrelated 2D hash: the naive FNV chain produced u/v pairs that tracked
  // each other, which laid scatter dots out along a single horizontal band.
  let h = Math.imul(x + 0x9e3779b9, 0x85ebca6b);
  h ^= Math.imul(y + 0x7f4a7c15, 0xc2b2ae35);
  h ^= Math.imul(seed + 1, 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2545f491);
  h ^= h >>> 13;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ── iso geometry ─────────────────────────────────────────────────────
// Diamond: left (0,96) right (128,96) top (63.5,64) bottom (63.5,128).
const CX = LOGICAL / 2;
const CY = 96;
const HW = LOGICAL / 2; // 64
const HH = 32;

// u: 0 at the west edge, 1 at the east edge, running up-right along W->N.
// v: 0 at the north-west edge, 1 at the south-east edge, running down-right.
function uvOf(x, y) {
  const dx = (x + 0.5 - CX) / HW;
  const dy = (y + 0.5 - CY) / HH;
  return { u: (dx + dy) / 2 + 0.5, v: (dx - dy) / 2 + 0.5 };
}

function ground(u, v) {
  return { x: CX + (u + v - 1) * HW, y: CY + (u - v) * HH };
}

function depth(x, y) {
  return (y + 0.5 - CY) / HH;
}

/** Distance in logical pixels from the diamond edge, 0 at the rim, 32 at the centre. */
function edgeDist(x, y) {
  const dx = Math.abs((x + 0.5 - CX) / HW);
  const dy = Math.abs((y + 0.5 - CY) / HH);
  const d = dx + dy;
  return (1 - d) * Math.min(HW, HH * 2) * 0.5;
}

/** Iterate every pixel whose centre is inside the plot diamond. */
function forEachPlotPixel(buf, cb) {
  for (let y = 64; y < LOGICAL; y++) {
    for (let x = 0; x < buf.w; x++) {
      const dx = Math.abs((x + 0.5 - CX) / HW);
      const dy = Math.abs((y + 0.5 - CY) / HH);
      if (dx + dy > 1) continue;
      const { u, v } = uvOf(x, y);
      cb(x, y, u, v);
    }
  }
}

/** Ground tone: darker toward the back (small v) so the plot reads as lit from the south. */
function shade(color, amount) {
  const [r, g, b] = parseHex(color);
  const k = Math.max(0, Math.min(1, amount));
  const mix = (c) => Math.round(c * k);
  return `#${[mix(r), mix(g), mix(b)].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

// ── shared plot furniture ────────────────────────────────────────────
/**
 * Hard cell clip. Every plot is a 2x2 tile, and the city view draws a farm
 * field as one sprite: anything a prop paints outside its own diamond lands in
 * a neighbouring plot's cell and gets guillotined by that neighbour's ground
 * (or paints over the neighbour's crops). Trimming at the diamond keeps each
 * plot a self-contained tile, so adjacent fields meet edge-to-edge with no
 * sliced canopies or stalks.
 */
function clipToPlot(buf) {
  const EPS = 0.008;
  for (let y = 0; y < LOGICAL; y++) {
    for (let x = 0; x < buf.w; x++) {
      const i = (y * buf.w + x) * 4;
      if (buf.px[i + 3] === 0) continue;
      const { u, v } = uvOf(x, y);
      if (u < -EPS || u > 1 + EPS || v < -EPS || v > 1 + EPS) buf.px[i + 3] = 0;
    }
  }
}

/**
 * Rim treatment shared by every style: a 1px dark outline hugging the diamond
 * edge, then `verge` px of the style's own border colour. Never a side wall:
 * the plot sits flush in its cells.
 */
function drawRim(buf, { verge = 0, vergeColor, rimColor, outline }) {
  forEachPlotPixel(buf, (x, y) => {
    const d = edgeDist(x, y);
    if (d < 1.15) put(buf, x, y, outline);
    else if (d < 1.15 + verge) put(buf, x, y, vergeColor);
    else if (d < 1.15 + verge + 1) blend(buf, x, y, rimColor, 0.55);
  });
}

/** Deterministic pebbles/tufts scattered over the plot. */
function scatter(buf, { count, seed, palette, y0 = 66, y1 = 127, minU = 0.04, maxU = 0.96, size = 1 }) {
  let placed = 0;
  for (let i = 0; i < count * 12 && placed < count; i++) {
    const u = minU + hash(i, 1, seed) * (maxU - minU);
    const v = minU + hash(i, 2, seed) * (maxU - minU);
    const p = ground(u, v);
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    if (y < y0 || y > y1) continue;
    if (edgeDist(x, y) < 3.2) continue;
    const color = palette[Math.round(hash(i, 3, seed) * (palette.length - 1))];
    if (size === 1) put(buf, x, y, color);
    else {
      put(buf, x, y, color);
      put(buf, x + 1, y, color);
      put(buf, x, y + 1, shade(color, 0.7));
    }
    placed++;
  }
}

/** Back-to-front prop pass, so trees/bales overlap correctly. */
function paintProps(buf, props) {
  props.sort((a, b) => a.depth - b.depth);
  for (const p of props) p.draw(buf);
}

// ── style 1: wheat rows ──────────────────────────────────────────────
function drawWheat(buf) {
  const soil = "#6b4122";
  const soilRidge = "#7c4e29";
  const furrow = "#4a2b14";

  const ROWS = 7;
  forEachPlotPixel(buf, (x, y, u, v) => {
    const band = Math.floor(v * ROWS);
    const t = (v * ROWS) % 1;
    const lit = 0.84 + 0.16 * v;
    let c = band % 2 === 0 ? soilRidge : soil;
    if (t < 0.2) c = furrow;
    else if (t > 0.82) c = soilRidge;
    put(buf, x, y, shade(c, lit));
  });

  scatter(buf, { count: 26, seed: 11, palette: ["#8a5a30", "#54331c", "#9c6a3a"], size: 1 });

  const props = [];
  const SHEAVES = 36;
  for (let iv = 0; iv < ROWS; iv++) {
    const v = (iv + 0.5) / ROWS;
    const far = v < 0.36;
    for (let iu = 0; iu < SHEAVES; iu++) {
      const u = 0.03 + ((iu + 0.5) / SHEAVES) * 0.94;
      const p = ground(u, v);
      const x = Math.round(p.x);
      const y = Math.round(p.y);
      if (edgeDist(x, y) < 1.4) continue;
      const r = hash(iu, iv, 7);
      if (r < 0.02) continue; // gap in the stand
      const h = 7 + Math.round(hash(iu, iv, 13) * 5);
      const stalk = far ? "#a8721e" : "#c98c2a";
      const body = far ? "#d69a34" : "#e8b046";
      const head = far ? "#e6ae46" : "#f4c862";
      const lit = far ? "#f2c85e" : "#ffe09a";
      const lean = hash(iu, iv, 17) < 0.35 ? 1 : hash(iu, iv, 19) < 0.4 ? -1 : 0;
      props.push({
        depth: depth(x, y),
        draw: (b) => {
          // soil shadow at the root
          put(b, x, y, "#3a2110");
          put(b, x + 1, y, "#42260f");
          // stem + second stem for mass
          vline(b, x, y - (h - 3), y - 1, stalk);
          put(b, x + 2, y - 1, stalk);
          vline(b, x + 2, y - (h - 5), y - 2, stalk);
          // ear: 2px wide, 4 tall, lit on the west side
          vline(b, x, y - h + 3, y - h, head);
          put(b, x, y - h - 1, lit);
          put(b, x + 1, y - h + 1, body);
          put(b, x + 1, y - h + 2, body);
          put(b, x + 2, y - h + 5, lit);
          put(b, x + 2, y - h + 4, head);
          if (lean) put(b, x + lean, y - h - 1, head);
        },
      });
    }
  }

  // a few tall seed heads breaking the silhouette at the back
  for (const [u, v] of [[0.24, 0.26], [0.72, 0.31], [0.48, 0.18]]) {
    const p = ground(u, v);
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    props.push({
      depth: depth(x, y) + 0.001,
      draw: (b) => {
        vline(b, x, y - 13, y, "#b8802a");
        put(b, x, y - 15, "#ffe09a");
        put(b, x, y - 14, "#f4c862");
        put(b, x, y - 13, "#e6ae46");
        put(b, x + 1, y - 11, "#e6ae46");
        put(b, x - 1, y - 9, "#e6ae46");
      },
    });
  }

  paintProps(buf, props);
  clipToPlot(buf);
  drawRim(buf, { verge: 2, vergeColor: "#7a4a28", rimColor: "#3f2412", outline: "#2a1a10" });
}

// ── style 2: vegetable beds ──────────────────────────────────────────
function drawVegetable(buf) {
  const soil = "#54331c";
  const BEDS = 5;
  forEachPlotPixel(buf, (x, y, u, v) => {
    const band = Math.floor(u * BEDS);
    const t = (u * BEDS) % 1;
    let c = band % 2 === 0 ? "#5b3720" : soil;
    if (t < 0.12) c = "#7a5233"; // plank/earth lip of the raised bed
    put(buf, x, y, shade(c, 0.84 + 0.16 * v));
  });

  // irrigation channel along the near (lower-left) edge
  forEachPlotPixel(buf, (x, y, u, v) => {
    if (v < 0.085) {
      put(buf, x, y, edgeDist(x, y) < 1.15 ? "#2a1a10" : "#3f5f66");
      put(buf, x, y, "#4f7280");
      if (v < 0.06) put(buf, x, y, "#6f95a0");
      if (v < 0.03) put(buf, x, y, "#8fb4bc");
    }
  });

  const props = [];
  // cabbages: two rows per bed
  for (let ib = 0; ib < BEDS; ib++) {
    for (let row = 0; row < 2; row++) {
      const u = (ib + (row === 0 ? 0.34 : 0.68)) / BEDS;
      const n = 10;
      for (let i = 0; i < n; i++) {
        const v = 0.08 + ((i + 0.5) / n) * 0.78;
        const p = ground(u, v);
        const x = Math.round(p.x);
        const y = Math.round(p.y);
        if (edgeDist(x, y) < 2.2) continue;
        const r = hash(i, ib * 2 + row, 23);
        const big = r > 0.4;
        props.push({
          depth: depth(x, y),
          draw: (b) => {
            const body = big ? "#6f9a37" : "#5f7d23";
            const light = big ? "#9dbb52" : "#87a336";
            // shadow
            put(b, x, y + 1, "#3a2a14");
            if (big) {
              // 5x4 head
              hline(b, x - 2, x + 2, y - 3, "#7fa93a");
              hline(b, x - 2, x + 2, y - 2, body);
              hline(b, x - 2, x + 2, y - 1, body);
              hline(b, x - 1, x + 1, y, "#4c6620");
              put(b, x - 2, y - 2, light);
              put(b, x - 1, y - 3, light);
              put(b, x, y - 4, light);
              put(b, x + 2, y - 1, "#4c6620");
              put(b, x - 1, y - 1, "#87a336");
            } else {
              put(b, x, y, body);
              put(b, x - 1, y, "#4c6620");
              put(b, x + 1, y, body);
              put(b, x, y - 1, light);
              put(b, x - 1, y - 1, body);
              put(b, x, y - 2, "#9dbb52");
            }
          },
        });
      }
    }
  }

  // wooden sluice gate at one end of the channel
  const g1 = ground(0.16, 0.05);
  const gx = Math.round(g1.x);
  const gy = Math.round(g1.y);
  props.push({
    depth: depth(gx, gy) + 0.01,
    draw: (b) => {
      rect(b, gx - 1, gy - 6, 3, 7, "#8a5a30");
      hline(b, gx - 1, gx + 1, gy - 6, "#b07a48");
      put(b, gx - 2, gy - 5, "#6d4526");
      put(b, gx + 2, gy - 5, "#6d4526");
      put(b, gx, gy - 3, "#a8c05a");
    },
  });

  paintProps(buf, props);
  clipToPlot(buf);
  drawRim(buf, { verge: 3, vergeColor: "#77882a", rimColor: "#4c6620", outline: "#2a1a10" });
}

// ── style 3: orchard ─────────────────────────────────────────────────
function drawOrchard(buf) {
  const grass = "#7d8f2c";
  forEachPlotPixel(buf, (x, y, u, v) => {
    const stripe = Math.floor(v * 7) % 2 === 0 ? grass : "#84962f";
    put(buf, x, y, shade(stripe, 0.84 + 0.16 * v));
  });

  scatter(buf, {
    count: 46,
    seed: 31,
    palette: ["#94a838", "#6c7a26", "#aab84a", "#5c6b1e"],
    size: 1,
  });

  const props = [];
  // Fixed two-row layout in plot pixels (offsets from the diamond centre). The
  // geometry is chosen so every canopy stays inside the 128x64 diamond: the
  // near row is wider and taller, the far row is smaller and pulled toward the
  // centre, where the diamond is narrow. Nothing overflows into a neighbour's
  // cell, so no tree is ever sliced by the next plot's ground.
  const TREES = [
    { x0: -22, y0: 11, w: 6, hh: 7, seed: 1 },
    { x0: 0, y0: 11, w: 7, hh: 7, seed: 2 },
    { x0: 22, y0: 11, w: 6, hh: 7, seed: 3 },
    { x0: -9, y0: -11, w: 5, hh: 5, seed: 4 },
    { x0: 0, y0: -11, w: 5, hh: 5, seed: 5 },
    { x0: 9, y0: -11, w: 5, hh: 5, seed: 6 },
  ];
  for (const tree of TREES) {
    const x = Math.round(CX + tree.x0);
    const y = Math.round(CY + tree.y0);
    const r = hash(tree.seed, 3, 41);
    const w = tree.w + (r > 0.55 ? 1 : 0);
    const hh = tree.hh;
    props.push({
      depth: depth(x, y),
      draw: (b) => {
        // ground shadow
        for (let dx = -6; dx <= 6; dx++) {
          for (let dy = 0; dy <= 2; dy++) {
            if (Math.abs(dx) / 6.5 + Math.abs(dy - 1) / 1.6 > 1) continue;
            blend(b, x + dx, y + dy - 1, "#2f3d12", 0.32);
          }
        }
        // trunk + root flare
        vline(b, x, y - 6, y, "#6a4423");
        put(b, x + 1, y - 5, "#5a3920");
        put(b, x + 1, y, "#4a2e18");
        put(b, x - 1, y - 1, "#7a5230");
        // canopy: an ellipse with a dark rim, a lit upper-west face and a shaded underside
        const cy = y - hh - 4;
        for (let dy = -hh; dy <= hh; dy++) {
          const span = Math.round(w * Math.sqrt(Math.max(0, 1 - (dy / (hh + 0.4)) ** 2)));
          for (let dx = -span; dx <= span; dx++) {
            const d = (dx / (span + 0.6)) ** 2 + (dy / (hh + 0.6)) ** 2;
            let c = "#5c8a2c";
            if (d > 0.66) c = "#3c6620";
            else if (dy < -hh * 0.25 && dx < span * 0.35) c = "#7fa93a";
            else if (dy > hh * 0.45) c = "#4a7426";
            put(b, x + dx, cy + dy, c);
          }
        }
        // crown highlight on the lit shoulder
        hline(b, x - Math.round(w * 0.5), x - Math.round(w * 0.15), cy - hh + 1, "#9cc050");
        hline(b, x - Math.round(w * 0.62), x - Math.round(w * 0.4), cy - hh + 2, "#9cc050");
        put(b, x - Math.round(w * 0.2), cy - hh, "#a8cc5c");
        // leaf texture
        for (let i = 0; i < 5; i++) {
          const dx = Math.round((hash(i, tree.seed, 47) - 0.5) * w * 1.3);
          const dy = Math.round((hash(i, tree.seed + 7, 53) - 0.55) * hh * 1.3);
          if ((dx / w) ** 2 + (dy / hh) ** 2 > 0.6) continue;
          put(b, x + dx, cy + dy, "#6f9a37");
        }
        // apples
        put(b, x - 3, cy + 2, "#c8483a");
        put(b, x + 4, cy - 1, "#c8483a");
        put(b, x + 1, cy + 4, "#d85a44");
        put(b, x - 5, cy - 2, "#b03c30");
      },
    });
  }

  // fallen apples + grass tufts
  for (const [u, v, c] of [[0.3, 0.55, "#c8483a"], [0.62, 0.32, "#c8483a"], [0.44, 0.72, "#d85a44"]]) {
    const p = ground(u, v);
    put(buf, Math.round(p.x), Math.round(p.y), c);
  }

  paintProps(buf, props);
  clipToPlot(buf);
  drawRim(buf, { verge: 3, vergeColor: "#6c7a26", rimColor: "#4c6620", outline: "#2a1a10" });
}

// ── style 4: paddock ─────────────────────────────────────────────────
function drawPaddock(buf) {
  const grass = "#8a9a3a";
  forEachPlotPixel(buf, (x, y, u, v) => {
    const patch = Math.floor(u * 3 + v * 2) % 2 === 0 ? grass : "#93a33e";
    put(buf, x, y, shade(patch, 0.86 + 0.14 * v));
  });
  scatter(buf, {
    count: 60,
    seed: 53,
    palette: ["#a2b24a", "#6c7a26", "#b0be58", "#5c6b1e"],
    size: 1,
  });

  const props = [];

  // post-and-rail fence along the two near edges, inset so it sits inside the plot.
  // Edge A runs W->S (v near 0), edge B runs S->E (u near 1); the near edges are
  // the ones with the lowest screen y, i.e. v = 0 and u = 1.
  const rail = (u0, v0, u1, v1, fenceSeed) => {
    const steps = 34;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const u = u0 + (u1 - u0) * t;
      const v = v0 + (v1 - v0) * t;
      const p = ground(u, v);
      const x = Math.round(p.x);
      const y = Math.round(p.y);
      const post = i % 5 === 0;
      props.push({
        depth: depth(x, y) + 0.002,
        draw: (b) => {
          // two rails, 2px thick with a dark under-line so they read at game scale
          put(b, x, y - 1, "#4a2e18");
          put(b, x, y - 2, "#a06a3c");
          put(b, x, y - 3, "#8a5a30");
          put(b, x, y - 4, "#5f3a20");
          put(b, x, y - 6, "#3f2412");
          put(b, x, y - 7, "#8a5a30");
          put(b, x, y - 8, "#a06a3c");
          if (post) {
            vline(b, x, y - 10, y, "#6d4526");
            put(b, x + 1, y - 10, "#4a2e18");
            put(b, x, y - 11, "#c08a52");
            put(b, x, y, "#3f2412");
          }
          if (hash(i, fenceSeed, 59) < 0.22) put(b, x, y - 1, "#6c7a26");
        },
      });
    }
  };
  // The front/lower edges of the diamond are v ~ 0 (W->S) and u ~ 1 (S->E).
  rail(0.05, 0.04, 0.95, 0.04, 3);
  rail(0.96, 0.05, 0.96, 0.95, 4);

  // gate posts on the near edge, with the fence line broken between them
  const gateA = ground(0.45, 0.04);
  props.push({
    depth: depth(gateA.x, gateA.y) + 0.02,
    draw: (b) => {
      const gx = Math.round(gateA.x);
      const gy = Math.round(gateA.y);
      vline(b, gx - 4, gy - 11, gy, "#6d4526");
      vline(b, gx + 4, gy - 11, gy, "#6d4526");
      put(b, gx - 4, gy - 12, "#b07a48");
      put(b, gx + 4, gy - 12, "#b07a48");
      put(b, gx - 5, gy - 9, "#8a5a30");
      put(b, gx + 5, gy - 9, "#8a5a30");
    },
  });

  // hay bales
  const bales = [
    [0.24, 0.44, 1],
    [0.34, 0.55, 0],
    [0.7, 0.62, 1],
  ];
  for (const [u, v, tall] of bales) {
    const p = ground(u, v);
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    props.push({
      depth: depth(x, y) + 0.004,
      draw: (b) => {
        const w = 5;
        const h = tall ? 7 : 5;
        for (let dx = -w; dx <= w; dx++) {
          for (let dy = -h; dy <= 0; dy++) {
            if (Math.abs(dx) / w + Math.abs(dy + h / 2) / (h / 2 + 0.5) > 1) continue;
            put(b, x + dx, y + dy, "#d8a848");
          }
        }
        hline(b, x - 3, x + 3, y - h + 1, "#f0cc78");
        hline(b, x - 4, x + 4, y, "#8a5a30");
        vline(b, x - 2, y - h + 2, y - 1, "#b07a30");
        vline(b, x + 2, y - h + 2, y - 1, "#b07a30");
        put(b, x - 1, y - h, "#f0cc78");
      },
    });
  }

  // sheep
  for (const [u, v, face] of [[0.58, 0.32, 1], [0.18, 0.66, -1], [0.62, 0.8, 1]]) {
    const p = ground(u, v);
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    props.push({
      depth: depth(x, y) + 0.006,
      draw: (b) => {
        for (let dx = -3; dx <= 3; dx++) {
          for (let dy = -5; dy <= 0; dy++) {
            const ex = dx / 3.3;
            const ey = (dy + 2.4) / 2.9;
            if (ex * ex + ey * ey > 1) continue;
            put(b, x + dx, y + dy, ey < -0.45 ? "#f6f2e6" : "#e8e2d0");
          }
        }
        put(b, x - 3, y, "#4a3828");
        put(b, x + 2, y, "#4a3828");
        // head, planted on the body's shoulder so it reads as an animal
        put(b, x + face * 3, y - 5, "#2f231a");
        put(b, x + face * 3, y - 4, "#3a2a20");
        put(b, x + face * 4, y - 4, "#3a2a20");
        put(b, x + face * 4, y - 5, "#241a12");
      },
    });
  }

  paintProps(buf, props);
  clipToPlot(buf);
  drawRim(buf, { verge: 2, vergeColor: "#6c7a26", rimColor: "#55641e", outline: "#2a1a10" });
}

// ── style 5: vineyard ────────────────────────────────────────────────
function drawVineyard(buf) {
  const soil = "#5d3a20";
  const ROWS = 5;
  forEachPlotPixel(buf, (x, y, u, v) => {
    const band = Math.floor(v * ROWS);
    const t = (v * ROWS) % 1;
    let c = band % 2 === 0 ? "#63401f" : soil;
    if (t < 0.2) c = "#4a2c15";
    put(buf, x, y, shade(c, 0.84 + 0.16 * v));
  });
  scatter(buf, { count: 34, seed: 71, palette: ["#7a4e2a", "#4a2c15", "#8a5a30"], size: 1 });

  const props = [];
  const ROWS_V = 4;
  for (let ir = 0; ir < ROWS_V; ir++) {
    const v = (ir + 0.5) / ROWS_V;
    // Continuous vine hedge along the row, with posts and hanging grape bunches.
    for (let iu = 0; iu < 46; iu++) {
      const u = 0.05 + (iu / 45) * 0.9;
      const p = ground(u, v);
      const x = Math.round(p.x);
      const y = Math.round(p.y);
      if (edgeDist(x, y) < 1.6) continue;
      const post = iu === 0 || iu === 45 || iu % 11 === 0;
      const r = hash(iu, ir, 83);
      props.push({
        depth: depth(x, y),
        draw: (b) => {
          put(b, x, y - 5, "#4f7a2a");
          put(b, x, y - 6, "#5c8a2c");
          put(b, x, y - 7, "#7fa93a");
          put(b, x, y - 8, "#87a93a");
          put(b, x, y - 4, "#3f5f20");
          if (r > 0.62) {
            put(b, x, y - 3, "#6a4a7a");
            put(b, x + 1, y - 3, "#8f6aa2");
            put(b, x, y - 2, "#5a3c68");
          } else if (r < 0.12) {
            put(b, x, y - 9, "#9cc050");
          }
          if (post) {
            vline(b, x, y - 13, y, "#6d4526");
            put(b, x + 1, y - 12, "#54331c");
            put(b, x, y - 14, "#a06a3c");
            put(b, x, y, "#3f2412");
            put(b, x, y - 10, "#8a6a3a");
            put(b, x, y - 6, "#8a6a3a");
          }
        },
      });
    }
  }

  // stone edging stones on the near edges
  for (let i = 0; i < 14; i++) {
    const u = 0.06 + (i / 13) * 0.88;
    for (const [uu, vv] of [[u, 0.02], [0.98, u]]) {
      const p = ground(uu, vv);
      const x = Math.round(p.x);
      const y = Math.round(p.y);
      props.push({
        depth: depth(x, y) + 0.01,
        draw: (b) => {
          put(b, x, y - 1, "#a8a49a");
          put(b, x + 1, y - 1, "#c0bcae");
          put(b, x, y, "#6a6a5c");
        },
      });
    }
  }

  paintProps(buf, props);
  clipToPlot(buf);
  drawRim(buf, { verge: 2, vergeColor: "#8a8a72", rimColor: "#5a5a48", outline: "#2a1a10" });
}

// ── png encoding ─────────────────────────────────────────────────────
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

function encodePng(buf) {
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = new Uint8Array(13);
  ihdr[0] = (buf.w >>> 24) & 0xff;
  ihdr[1] = (buf.w >>> 16) & 0xff;
  ihdr[2] = (buf.w >>> 8) & 0xff;
  ihdr[3] = buf.w & 0xff;
  ihdr[4] = (buf.h >>> 24) & 0xff;
  ihdr[5] = (buf.h >>> 16) & 0xff;
  ihdr[6] = (buf.h >>> 8) & 0xff;
  ihdr[7] = buf.h & 0xff;
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const stride = buf.w * 4;
  const raw = new Uint8Array((stride + 1) * buf.h);
  for (let y = 0; y < buf.h; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(buf.px.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const compressed = deflateSync(raw, { level: 9 });
  const png = new Uint8Array(
    sig.length + (4 + 4 + 13 + 4) + (4 + 4 + compressed.length + 4) + (4 + 4 + 0 + 4),
  );
  let off = 0;
  png.set(sig, off);
  off += sig.length;
  const ihdrChunk = chunk("IHDR", ihdr);
  png.set(ihdrChunk, off);
  off += ihdrChunk.length;
  const idatChunk = chunk("IDAT", compressed);
  png.set(idatChunk, off);
  off += idatChunk.length;
  const iendChunk = chunk("IEND", new Uint8Array(0));
  png.set(iendChunk, off);
  return png;
}

function upscale(buf, factor) {
  const out = makeBuf(buf.w * factor, buf.h * factor);
  for (let y = 0; y < buf.h; y++) {
    for (let x = 0; x < buf.w; x++) {
      const i = (y * buf.w + x) * 4;
      if (buf.px[i + 3] === 0) continue;
      for (let dy = 0; dy < factor; dy++) {
        for (let dx = 0; dx < factor; dx++) {
          const j = ((y * factor + dy) * out.w + (x * factor + dx)) * 4;
          out.px[j] = buf.px[i];
          out.px[j + 1] = buf.px[i + 1];
          out.px[j + 2] = buf.px[i + 2];
          out.px[j + 3] = buf.px[i + 3];
        }
      }
    }
  }
  return out;
}

// ── registry + run ───────────────────────────────────────────────────
const STYLES = [
  { id: "farmWheat", label: "Wheat rows", draw: drawWheat },
  { id: "farmVeg", label: "Vegetable beds", draw: drawVegetable },
  { id: "farmOrchard", label: "Orchard", draw: drawOrchard },
  { id: "farmPaddock", label: "Paddock", draw: drawPaddock },
  { id: "farmVines", label: "Vineyard", draw: drawVineyard },
];

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const onlyIdx = args.indexOf("--only");
const only = onlyIdx >= 0 ? args[onlyIdx + 1] : null;
const previewIdx = args.indexOf("--preview");
const preview = previewIdx >= 0 ? Number(args[previewIdx + 1]) : 0;

const targets = STYLES.filter((s) => !only || s.id.toLowerCase().includes(only.toLowerCase()));
if (targets.length === 0) {
  console.error(`no style matched --only ${only}`);
  process.exit(1);
}

let drift = 0;
for (const style of targets) {
  const buf = makeBuf(LOGICAL, LOGICAL);
  style.draw(buf);
  const big = preview ? upscale(buf, preview) : upscale(buf, SCALE);
  const png = encodePng(big);
  const name = `building-pixel-${style.id}-1.png`;
  const out = path.join(outDir, name);
  if (checkOnly) {
    const onDisk = existsSync(out) ? readFileSync(out) : null;
    if (!onDisk || !onDisk.equals(Buffer.from(png))) {
      console.error(`drift: ${name}`);
      drift++;
    } else {
      console.log(`ok: ${name}`);
    }
    continue;
  }
  writeFileSync(out, png);
  console.log(`wrote ${name} (${png.length} bytes, ${style.label})`);
}
if (checkOnly && drift > 0) process.exit(1);