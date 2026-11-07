// Cut a raw model output for a faction-collision unit sprite into the shipped
// 128x128 arena/icon contract:
//
//   1. strip the model's fake-transparency background (one uniform tone OR a
//      two-tone checkerboard) with a border-seeded flood fill + a tight halo;
//   2. drop detached floaters (anything that is not the figure);
//   3. crop to the figure's alpha bbox;
//   4. draw it into the 128x128 canvas at the target box with high-quality
//      smoothing (the same downscale convention as downscale-arena.mjs), and
//   5. zero the 2px edge ring and print the metrics the footprint test asserts.
//
// Modes:
//   idle  the figure's BASE lands on the canvas' LAST row, centred — the
//         bottom-anchored `unit.<id>.<pose>` descriptor puts that row at the
//         hex's south vertex, so the unit stands on its iso footprint with no
//         transparent pad under the feet and no ground plinth. Box 120x94.
//   icon  the figure is centred in the canvas (roster bust). Box 120x120.
//
// Usage: node design/arena-unit-sprites/collision-cut.mjs <in.png> <out.png> <idle|icon>
//        [--flood 26] [--halo 34] [--min-frac 0.003] [--report-only]
//
// Deterministic: no RNG, no network. pngjs + bundled Chromium (Playwright
// devDependency) only, like the rest of the wave's helpers.
import { readFileSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";
import { chromium } from "playwright";

const [, , inFile, outFile, modeArg, ...rest] = process.argv;
if (!inFile || !outFile || !["idle", "icon"].includes(modeArg ?? "")) {
  console.error("usage: node collision-cut.mjs <in.png> <out.png> <idle|icon> [--flood n] [--halo n] [--min-frac f] [--report-only]");
  process.exit(1);
}
const opt = (name, dflt) => {
  const i = rest.indexOf(name);
  return i >= 0 ? Number(rest[i + 1]) : dflt;
};
const FLOOD = opt("--flood", 26);
const HALO = opt("--halo", 34);
const MIN_FRAC = opt("--min-frac", 0.003);
const REPORT_ONLY = rest.includes("--report-only");
const BOX = modeArg === "idle" ? { w: 120, h: 94 } : { w: 120, h: 120 };
const OUT = 128;
const RING = 2;

const src = PNG.sync.read(readFileSync(inFile));
const { width: W, height: H, data } = src;
const at = (x, y) => (y * W + x) * 4;
const dist = (i, t) => Math.hypot(data[i] - t[0], data[i + 1] - t[1], data[i + 2] - t[2]);

// ── 1. background tones, from the border ────────────────────────────────────
const buckets = new Map();
const sample = (x, y) => {
  const i = at(x, y);
  if (data[i + 3] < 200) return;
  const k = `${data[i] >> 4},${data[i + 1] >> 4},${data[i + 2] >> 4}`;
  const b = buckets.get(k) ?? { n: 0, r: 0, g: 0, b: 0 };
  b.n++; b.r += data[i]; b.g += data[i + 1]; b.b += data[i + 2];
  buckets.set(k, b);
};
for (let x = 0; x < W; x++) { sample(x, 0); sample(x, H - 1); }
for (let y = 0; y < H; y++) { sample(0, y); sample(W - 1, y); }
const ranked = [...buckets.values()].sort((a, b) => b.n - a.n);
const borderN = ranked.reduce((s, b) => s + b.n, 0);
const tones = [ranked[0]];
// A checkerboard is exactly two border tones, each a large share of the border.
if (ranked[1] && ranked[1].n / borderN >= 0.2) tones.push(ranked[1]);
const TONES = tones.map((t) => [t.r / t.n, t.g / t.n, t.b / t.n]);
const nearestTone = (i) => Math.min(...TONES.map((t) => dist(i, t)));
console.log(`tones: ${TONES.map((t) => t.map(Math.round).join(",")).join(" | ")} (border share ${tones.map((t) => (100 * t.n / borderN).toFixed(0) + "%").join(", ")})`);

// ── 2. flood fill from the border over the background tones, then a tight halo ─
const bg = new Uint8Array(W * H);
const stack = [];
const push = (x, y) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const p = y * W + x;
  if (bg[p] || nearestTone(p * 4) > FLOOD) return;
  bg[p] = 1;
  stack.push(p);
};
for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1); }
for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y); }
while (stack.length) {
  const p = stack.pop();
  const x = p % W, y = (p - x) / W;
  push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
}
for (let pass = 0; pass < 2; pass++) {
  const add = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (bg[p]) continue;
      const nb = (x > 0 && bg[p - 1]) || (x < W - 1 && bg[p + 1]) || (y > 0 && bg[p - W]) || (y < H - 1 && bg[p + W]);
      if (nb && nearestTone(p * 4) <= HALO) add.push(p);
    }
  }
  if (!add.length) break;
  for (const p of add) bg[p] = 1;
}
let cleared = 0;
for (let p = 0; p < W * H; p++) if (bg[p]) { data[p * 4 + 3] = 0; cleared++; }
console.log(`background: cleared ${(100 * cleared / (W * H)).toFixed(1)}% (flood<=${FLOOD}, halo<=${HALO})`);

// ── 3. keep the figure, drop detached floaters ──────────────────────────────
const opaque = new Uint8Array(W * H);
let total = 0;
for (let p = 0; p < W * H; p++) if (data[p * 4 + 3] > 0) { opaque[p] = 1; total++; }
const label = new Int32Array(W * H).fill(-1);
const comps = [];
for (let p0 = 0; p0 < W * H; p0++) {
  if (!opaque[p0] || label[p0] >= 0) continue;
  const id = comps.length;
  const px = [];
  const q = [p0];
  label[p0] = id;
  while (q.length) {
    const p = q.pop();
    px.push(p);
    const x = p % W, y = (p - x) / W;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const np = ny * W + nx;
      if (!opaque[np] || label[np] >= 0) continue;
      label[np] = id;
      q.push(np);
    }
  }
  comps.push(px);
}
const keep = comps.filter((c) => c.length >= Math.max(200, total * MIN_FRAC));
const dropped = comps.length - keep.length;
const droppedPx = comps.filter((c) => c.length < Math.max(200, total * MIN_FRAC)).reduce((s, c) => s + c.length, 0);
for (const c of comps) {
  if (keep.includes(c)) continue;
  for (const p of c) data[p * 4 + 3] = 0;
}
console.log(`figure: ${comps.length} components, kept ${keep.length}, dropped ${dropped} (${droppedPx}px, ${(100 * droppedPx / Math.max(1, total)).toFixed(2)}% of the figure)`);

// ── 4. crop to the figure's bbox ────────────────────────────────────────────
let minX = W, minY = H, maxX = -1, maxY = -1;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (data[at(x, y) + 3] === 0) continue;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
}
const cw = maxX - minX + 1, ch = maxY - minY + 1;
console.log(`crop: ${cw}x${ch} at ${minX},${minY}`);

const cropped = new PNG({ width: cw, height: ch });
for (let y = 0; y < ch; y++) {
  for (let x = 0; x < cw; x++) {
    const s = at(minX + x, minY + y), d = (y * cw + x) * 4;
    cropped.data[d] = data[s]; cropped.data[d + 1] = data[s + 1]; cropped.data[d + 2] = data[s + 2]; cropped.data[d + 3] = data[s + 3];
  }
}
const scale = Math.min(BOX.w / cw, BOX.h / ch);
const dw = Math.max(1, Math.round(cw * scale));
const dh = Math.max(1, Math.round(ch * scale));
const dx = Math.round((OUT - dw) / 2);
const dy = modeArg === "idle" ? OUT - dh : Math.round((OUT - dh) / 2);

// ── 5. draw into the 128 canvas, then zero the ring ────────────────────────
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent("<!DOCTYPE html><html><body><canvas id='c'></canvas></body></html>");
const url = await page.evaluate(
  async ([b64, cw, ch, dw, dh, dx, dy, OUT]) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "data:image/png;base64," + b64; });
    const c = document.getElementById("c");
    c.width = OUT; c.height = OUT;
    const ctx = c.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, cw, ch, dx, dy, dw, dh);
    return c.toDataURL("image/png");
  },
  [PNG.sync.write(cropped).toString("base64"), cw, ch, dw, dh, dx, dy, OUT],
);
await browser.close();

const out = PNG.sync.read(Buffer.from(url.split("base64,")[1], "base64"));
const oAt = (x, y) => (y * out.width + x) * 4;
for (let y = 0; y < OUT; y++) {
  for (let x = 0; x < OUT; x++) {
    const onRing = x < RING || y < RING || x >= OUT - RING || (y >= OUT - RING && modeArg === "icon");
    if (onRing) out.data[oAt(x, y) + 3] = 0;
  }
}

// ── metrics: what the footprint test asserts ────────────────────────────────
const rowWidth = (y) => { let n = 0; for (let x = 0; x < OUT; x++) if (out.data[oAt(x, y) + 3] > 0) n++; return n; };
let bottom = OUT - 1;
while (bottom >= 0 && rowWidth(bottom) === 0) bottom--;
let top = 0;
while (top < OUT && rowWidth(top) === 0) top++;
let widest = 0, left = OUT, right = -1;
for (let y = 0; y < OUT; y++) {
  const w = rowWidth(y);
  if (w > widest) widest = w;
  if (w === 0) continue;
  for (let x = 0; x < OUT; x++) {
    if (out.data[oAt(x, y) + 3] === 0) continue;
    if (x < left) left = x;
    if (x > right) right = x;
  }
}
const baseBand = Math.max(rowWidth(bottom - 2), rowWidth(bottom - 1), rowWidth(bottom));
const centre = (left + right) / 2;
let ringBad = 0;
for (let y = 0; y < OUT; y++) {
  for (let x = 0; x < OUT; x++) {
    if (x < RING || y < RING || x >= OUT - RING || (y >= OUT - RING && modeArg === "icon")) {
      if (out.data[oAt(x, y) + 3] > 0) ringBad++;
    }
  }
}
console.log(`drawn ${dw}x${dh} at ${dx},${dy}`);
console.log(`metrics: ${OUT}x${OUT}, content rows ${top}..${bottom} (bottomPad ${OUT - 1 - bottom}), x ${left}..${right}, centre ${centre} (axis ${(OUT - 1) / 2}), widest ${widest}, baseBand ${baseBand} (ratio ${(baseBand / Math.max(1, widest)).toFixed(2)}), ringOpaque ${ringBad}`);
if (REPORT_ONLY) { console.log("report-only: nothing written"); process.exit(0); }
writeFileSync(outFile, PNG.sync.write(out));
console.log(`wrote ${outFile}`);
