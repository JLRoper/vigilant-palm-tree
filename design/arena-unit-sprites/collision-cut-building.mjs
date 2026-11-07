// Cut a raw model output for a faction-collision BUILDING sprite into the
// shipped iso-lot contract.
//
// This is the building twin of collision-cut.mjs, added by the wave that gave
// the ironmark ram pens their own sprite (the one CROSS-faction building
// collision, `building-pixel-ramPens-1.png` == `building-pixel-stables-1.png`).
// The unit helper's `idle` / `icon` modes cut a figure into a 128x128 unit
// canvas; a building is authored on the 1024x1024 `building-pixel-*` canvas and
// its own GROUND PLANE has to land on the iso footprint, so it needs a third
// mode rather than a flag. collision-cut.mjs is left byte-identical: the unit
// waves' recorded provenance hashes stay true.
//
//   1. strip the model's fake-transparency background (one uniform tone OR a
//      two-tone checkerboard) with a border-seeded flood fill + a tight halo;
//   2. drop detached floaters (anything that is not the building);
//   3. fit the LOT to the grid: measure the sand's own lower-edge slope from its
//      mask (the alpha silhouette is contaminated by the soil slab the models
//      always add), scale the image VERTICALLY about the sand's south vertex so
//      those edges land on the grid's dy/dx = 0.5 (26.57 deg), then clear every
//      pixel below the fitted edges -- the SLAB/PLINTH that lifts the plot plane
//      above its cell;
//   4. crop to the alpha bbox and draw into the 1024x1024 canvas so the ground
//      diamond spans `--lot` of the canvas width (the shipped 1x1 building lots
//      measure 0.84-0.92) and the sprite's own visible base IS the canvas' last
//      row, then
//   5. print the metrics the building tests and the anchor generator assert.
//
// The last step is what makes `tools/sprites/gen-building-anchors.mjs` measure a
// bottom pad of 0 and therefore an `anchorOffsetY` of 0: the lot's lowest row is
// the canvas' lowest row, so `anchor: "bottom"` puts the lot exactly on its
// cell's south vertex with no float and no plinth.
//
// Usage:
//   node design/arena-unit-sprites/collision-cut-building.mjs <in.png> <out.png>
//        [--canvas 1024] [--lot 0.855] [--flood 26] [--halo 34] [--report-only]
//
// Deterministic: no RNG, no network. pngjs + bundled Chromium (Playwright
// devDependency) only, like the rest of the wave's helpers.
import { readFileSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";
import { chromium } from "playwright";

const [, , inFile, outFile, ...rest] = process.argv;
if (!inFile || !outFile) {
  console.error(
    "usage: node collision-cut-building.mjs <in.png> <out.png> " +
      "[--canvas 1024] [--lot 0.855] [--flood 26] [--halo 34] [--report-only]",
  );
  process.exit(1);
}
const opt = (name, dflt) => {
  const i = rest.indexOf(name);
  return i >= 0 ? Number(rest[i + 1]) : dflt;
};
const OUT = opt("--canvas", 1024);
const LOT = opt("--lot", 0.855);
const FLOOD = opt("--flood", 26);
const HALO = opt("--halo", 34);
const MIN_FRAC = opt("--min-frac", 0.003);
const TARGET_DYDX = 0.5; // the city grid's cell edge slope (src/core/cityGrid.ts)
const OUTLINE_ALLOWANCE = 3;
const REPORT_ONLY = rest.includes("--report-only");

// ── 0. decode: a model that returns JFIF bytes behind a .png path ──────────
const raw0 = readFileSync(inFile);
const isPng = raw0.length > 8 && raw0.readUInt32BE(0) === 0x89504e47;
let src = null;
async function decodeViaChromium(buf) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent("<!DOCTYPE html><html><body><canvas id='c'></canvas></body></html>");
  const url = await page.evaluate(async (b64) => {
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
      img.src = "data:image/png;base64," + b64;
    });
    const c = document.getElementById("c");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    return c.toDataURL("image/png");
  }, buf.toString("base64"));
  await browser.close();
  return PNG.sync.read(Buffer.from(url.split("base64,")[1], "base64"));
}

src = isPng ? PNG.sync.read(raw0) : await decodeViaChromium(raw0);
const { width: W, height: H, data } = src;
console.log(`input: ${W}x${H}${isPng ? "" : " (decoded through Chromium: the model returned JPEG)"}`);
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

// ── 3. keep the building, drop detached floaters ────────────────────────────
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
const minPx = Math.max(200, total * MIN_FRAC);
const keep = comps.filter((c) => c.length >= minPx);
const droppedPx = comps.filter((c) => c.length < minPx).reduce((s, c) => s + c.length, 0);
for (const c of comps) {
  if (c.length >= minPx) continue;
  for (const p of c) data[p * 4 + 3] = 0;
}
console.log(`building: ${comps.length} components, kept ${keep.length}, dropped ${comps.length - keep.length} (${droppedPx}px, ${(100 * droppedPx / Math.max(1, total)).toFixed(2)}% of the sprite)`);

// ── 4. fit the LOT to the grid ──────────────────────────────────────────────
// Sand mask: warm, light and saturated enough to be ground rather than outline.
const isSand = (r, g, b, a) => {
  if (a <= 128) return false;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return mx - mn > 25 && r >= g && g >= b && r - b > 45 && lum > 120;
};
const bottomOfColumn = new Int32Array(W).fill(-1);
for (let x = 0; x < W; x++) {
  for (let y = H - 1; y >= 0; y--) {
    const i = at(x, y);
    if (data[i + 3] > 128 && isSand(data[i], data[i + 1], data[i + 2], data[i + 3])) { bottomOfColumn[x] = y; break; }
  }
}
const cols = [];
for (let x = 0; x < W; x++) if (bottomOfColumn[x] >= 0) cols.push([x, bottomOfColumn[x]]);
if (cols.length < 50) {
  console.error(`collision-cut-building: the sand mask is too small (${cols.length} columns) - is the lot sandy?`);
  process.exit(2);
}
function robustFit(points) {
  let pts = points.slice();
  for (let pass = 0; pass < 3; pass++) {
    const n = pts.length;
    const mx = pts.reduce((s, p) => s + p[0], 0) / n;
    const my = pts.reduce((s, p) => s + p[1], 0) / n;
    let num = 0, den = 0;
    for (const p of pts) { num += (p[0] - mx) * (p[1] - my); den += (p[0] - mx) ** 2; }
    const m = den === 0 ? 0 : num / den;
    const b = my - m * mx;
    pts = pts.filter((p) => Math.abs(p[1] - (m * p[0] + b)) <= 8);
    if (pts.length < 20) break;
  }
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p[0], 0) / n;
  const my = pts.reduce((s, p) => s + p[1], 0) / n;
  let num = 0, den = 0;
  for (const p of pts) { num += (p[0] - mx) * (p[1] - my); den += (p[0] - mx) ** 2; }
  const m = den === 0 ? 0 : num / den;
  return { m, b: my - m * mx, n: pts.length };
}
// south vertex, then a fit per side (never across it - the vertex is a corner)
const southPoint = cols.reduce((best, p) => (p[1] > best[1] ? p : best), cols[0]);
const southX = southPoint[0];
const left = cols.filter((p) => p[0] < southX - 10);
const right = cols.filter((p) => p[0] > southX + 10);
const L = robustFit(left), R = robustFit(right);
const measuredDydx = (Math.abs(L.m) + Math.abs(R.m)) / 2;
const angleDeg = (Math.atan(measuredDydx) * 180) / Math.PI;
const vx = (R.b - L.b) / (L.m - R.m);
const vy = L.m * vx + L.b;
console.log(`lot: sand ${cols.length} columns, lower edges dy/dx ${measuredDydx.toFixed(4)} (${angleDeg.toFixed(2)} deg) — left ${L.m.toFixed(4)} right ${R.m.toFixed(4)}, south vertex ${Math.round(vx)},${Math.round(vy)}`);

// vertical normalisation about the south vertex: y' = vy + sy*(y - vy)
const sy = TARGET_DYDX / measuredDydx;
const fitted = new PNG({ width: W, height: H });
fitted.data.fill(0);
for (let y = 0; y < H; y++) {
  const srcY = Math.round(vy + (y - vy) / sy);
  if (srcY < 0 || srcY > H - 1) continue;
  for (let x = 0; x < W; x++) {
    const si = at(x, srcY), di = (y * W + x) * 4;
    fitted.data[di] = data[si]; fitted.data[di + 1] = data[si + 1];
    fitted.data[di + 2] = data[si + 2]; fitted.data[di + 3] = data[si + 3];
  }
}
// clear everything below the fitted (now 2:1) front edges: the soil slab/plinth
const Lm = L.m * sy, Lb = vy + (L.b - vy) * sy;
const Rm = R.m * sy, Rb = vy + (R.b - vy) * sy;
let cut = 0;
for (let x = 0; x < W; x++) {
  const boundary = Math.round(Math.min(Lm * x + Lb, Rm * x + Rb)) + OUTLINE_ALLOWANCE;
  for (let y = Math.max(0, boundary); y < H; y++) {
    const i = (y * W + x) * 4;
    if (fitted.data[i + 3] > 0) { fitted.data[i + 3] = 0; cut++; }
  }
}
console.log(`plinth: vertical scale ${sy.toFixed(4)}, ${cut}px cleared below the lot's front edges`);

// the sand's own width after the fit == the ground diamond's full width
let sandMinX = W, sandMaxX = -1;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    if (fitted.data[i + 3] > 128 && isSand(fitted.data[i], fitted.data[i + 1], fitted.data[i + 2], 255)) {
      if (x < sandMinX) sandMinX = x;
      if (x > sandMaxX) sandMaxX = x;
    }
  }
}
const sandWidth = sandMaxX - sandMinX + 1;
console.log(`lot: sand spans x ${sandMinX}..${sandMaxX} = ${sandWidth}px (${(sandWidth / W).toFixed(3)} of the raw canvas)`);

// ── 5. crop to the alpha bbox, draw into the canvas at the target lot width ─
let minX = W, minY = H, maxX = -1, maxY = -1;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (fitted.data[(y * W + x) * 4 + 3] === 0) continue;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
}
const cw = maxX - minX + 1, ch = maxY - minY + 1;
const cropped = new PNG({ width: cw, height: ch });
for (let y = 0; y < ch; y++) {
  for (let x = 0; x < cw; x++) {
    const s = (minY + y) * W * 4 + (minX + x) * 4, d = (y * cw + x) * 4;
    cropped.data[d] = fitted.data[s]; cropped.data[d + 1] = fitted.data[s + 1];
    cropped.data[d + 2] = fitted.data[s + 2]; cropped.data[d + 3] = fitted.data[s + 3];
  }
}
const scale = (LOT * OUT) / sandWidth; // uniform: the fitted 2:1 stays 2:1
const dw = Math.round(cw * scale);
let dh = Math.round(ch * scale);
if (dh > OUT) dh = OUT;
const dx = Math.round((OUT - dw) / 2);
const dy = OUT - dh; // the sprite's own visible base IS the canvas' last row
console.log(`crop: ${cw}x${ch} at ${minX},${minY} -> drawn ${dw}x${dh} at ${dx},${dy} (scale ${scale.toFixed(4)})`);

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
if (out.width !== OUT || out.height !== OUT) throw new Error(`unexpected output size ${out.width}x${out.height}`);
const ALPHA_THRESHOLD = 10; // what tools/sprites/gen-building-anchors.mjs measures with
const oAt = (x, y) => (y * OUT + x) * 4;
const rowWidth = (y) => { let n = 0; for (let x = 0; x < OUT; x++) if (out.data[oAt(x, y) + 3] > ALPHA_THRESHOLD) n++; return n; };
let bottom = OUT - 1;
while (bottom >= 0 && rowWidth(bottom) === 0) bottom--;
let top = 0;
while (top < OUT && rowWidth(top) === 0) top++;
let widest = 0, left2 = OUT, right2 = -1;
for (let y = 0; y < OUT; y++) {
  const w = rowWidth(y);
  if (w > widest) widest = w;
  if (w === 0) continue;
  for (let x = 0; x < OUT; x++) {
    if (out.data[oAt(x, y) + 3] <= ALPHA_THRESHOLD) continue;
    if (x < left2) left2 = x;
    if (x > right2) right2 = x;
  }
}
// slope of the finished sprite's own lower edges (bottom 30% band, ground only)
const bandTop = bottom - Math.max(20, Math.round((bottom - top + 1) * 0.3));
const rows = [];
for (let y = bandTop; y <= bottom; y++) {
  let l = -1, r = -1;
  for (let x = 0; x < OUT; x++) if (out.data[oAt(x, y) + 3] > ALPHA_THRESHOLD) { if (l < 0) l = x; r = x; }
  if (l >= 0) rows.push([y, l, r]);
}
const slopeOf = (idx) => {
  const n = rows.length;
  const my = rows.reduce((s, p) => s + p[0], 0) / n;
  const mx = rows.reduce((s, p) => s + p[idx], 0) / n;
  let num = 0, den = 0;
  for (const p of rows) { num += (p[0] - my) * (p[idx] - mx); den += (p[0] - my) ** 2; }
  return num / den;
};
const lSlope = Math.abs(slopeOf(1)), rSlope = Math.abs(slopeOf(2));
const outDydx = (lSlope + rSlope) / 2;
const outAngle = (Math.atan(outDydx) * 180) / Math.PI;
const padRows = OUT - 1 - bottom;
const ring = 2;
let ringBad = 0;
for (let y = 0; y < OUT; y++) for (let x = 0; x < OUT; x++) {
  if ((x < ring || y < ring || x >= OUT - ring || y >= OUT - ring) && out.data[oAt(x, y) + 3] > 0) ringBad++;
}
console.log(
  `metrics: ${OUT}x${OUT}, content rows ${top}..${bottom} (bottomPad ${padRows}), x ${left2}..${right2} ` +
    `(width ${right2 - left2 + 1} = ${((right2 - left2 + 1) / OUT).toFixed(3)}), widest ${widest}, ` +
    `lower-edge dy/dx ${outDydx.toFixed(4)} (${outAngle.toFixed(2)} deg), ringOpaque ${ringBad}`,
);
console.log(
  `anchor: gen-building-anchors measures bottomPad ${padRows} -> anchorOffsetY ` +
    `${Math.round((padRows * 86.4) / OUT)} (0 == planted on the cell's south vertex)`,
);
if (REPORT_ONLY) { console.log("report-only: nothing written"); process.exit(0); }
writeFileSync(outFile, PNG.sync.write(out));
console.log(`wrote ${outFile}`);
