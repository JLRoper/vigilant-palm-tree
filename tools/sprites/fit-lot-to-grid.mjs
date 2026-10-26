// Fit a generated town-centre sprite's LOT to the game's iso grid.
//
//   node fit-lot-to-grid.mjs <in-alpha.png> <out.png> [report.json]
//
// Two defects this removes, both measured rather than eyeballed:
//
// 1. PROJECTION. The city grid is TILE_W 96 x TILE_D 48 (src/core/cityGrid.ts),
//    so a cell's edges descend at dy/dx = 0.5 (26.57 deg). Image models draw
//    lots at ~30 deg (dy/dx ~0.575) even when told not to and given a 2:1
//    magenta guide. The sand's own lower edges are fitted from the sand mask
//    (not the alpha silhouette, which the soil slab contaminates), then the
//    image is scaled vertically about the sand's south vertex so those edges
//    land exactly on 0.5 - width, horizontal position and the sand's south
//    vertex are untouched, so the sprite stays a drop-in for the asset it
//    replaces.
//
// 2. THE SOIL SLAB ("plinth"). Every model added a 40-60 row dark band under
//    the sand's front edges, which draws as a ~4 px pedestal and lifts the sand
//    plane ~4 px above its cell vertex in game. The mask below the fitted sand
//    edges (keeping a 3 px outline allowance) is cleared, so the sand's south
//    vertex becomes the sprite's visible base and the engine's measured
//    anchorOffsetY plants it exactly on the cell's south vertex.
import { readFileSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";

const [, , inFile, outFile, reportFile] = process.argv;
if (!inFile || !outFile) {
  console.error("usage: node fit-lot-to-grid.mjs <in-alpha.png> <out.png> [report.json]");
  process.exit(1);
}
const TARGET_DYDX = 0.5;   // the grid's cell edge slope (26.57 deg)

const png = PNG.sync.read(readFileSync(inFile));
const { width: W, height: H, data } = png;
const px = (x, y) => { const i = (y * W + x) * 4; return [data[i], data[i + 1], data[i + 2], data[i + 3]]; };

// --- sand mask: warm, light, saturated enough to be ground rather than outline
const isSand = (r, g, b, a) => {
  if (a <= 128) return false;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return mx - mn > 25 && r >= g && g >= b && r - b > 45 && lum > 120;
};

// lowest sand row per column
const bottomOfColumn = new Int32Array(W).fill(-1);
for (let x = 0; x < W; x++) {
  for (let y = H - 1; y >= 0; y--) {
    const [r, g, b, a] = px(x, y);
    if (isSand(r, g, b, a)) { bottomOfColumn[x] = y; break; }
  }
}
const cols = [];
for (let x = 0; x < W; x++) if (bottomOfColumn[x] >= 0) cols.push([x, bottomOfColumn[x]]);
if (cols.length < 50) { console.error("fit-lot-to-grid: sand mask too small - is this the right kind of sprite?"); process.exit(2); }

// robust line fit y = m*x + b: least squares, drop residuals > 8 px, refit
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

// split at the sand's widest/lowest point -> south vertex
const southX = cols.reduce((best, p) => (p[1] > best[1] ? p : best), cols[0])[0];
const left = cols.filter((p) => p[0] < southX - 10);
const right = cols.filter((p) => p[0] > southX + 10);
const L = robustFit(left), R = robustFit(right);
const measuredDydx = (Math.abs(L.m) + Math.abs(R.m)) / 2;
const angleDeg = (Math.atan(measuredDydx) * 180) / Math.PI;

// south vertex from the fitted lines
const vx = (R.b - L.b) / (L.m - R.m);
const vy = L.m * vx + L.b;

// --- pass 1: vertical normalisation about the south vertex ---------------
const sy = TARGET_DYDX / measuredDydx;   // <1 flattens the art onto the grid (skill: target/measured, never the inverse)
const out = new PNG({ width: W, height: H });
out.data.fill(0);
for (let y = 0; y < H; y++) {
  const srcY = Math.round(vy + (y - vy) / sy);
  if (srcY < 0 || srcY > H - 1) continue;
  for (let x = 0; x < W; x++) {
    const si = (srcY * W + x) * 4, di = (y * W + x) * 4;
    out.data[di] = data[si]; out.data[di + 1] = data[si + 1];
    out.data[di + 2] = data[si + 2]; out.data[di + 3] = data[si + 3];
  }
}

// --- pass 2: cut everything below the sand's (now 2:1) front edges -------
const Lm = L.m * sy, Lb = vy + (L.b - vy) * sy + 0;   // y' = vy + sy*(y - vy) for points, y = m x + b -> m' = sy*m, b' = vy + sy*(b - vy)
const Rm = R.m * sy, Rb = vy + (R.b - vy) * sy;
const OUTLINE_ALLOWANCE = 3;
let cut = 0;
for (let x = 0; x < W; x++) {
  const yL = Lm * x + Lb, yR = Rm * x + Rb;
  const boundary = Math.round(Math.min(yL, yR)) + OUTLINE_ALLOWANCE;
  for (let y = Math.max(0, boundary); y < H; y++) {
    const i = (y * W + x) * 4;
    if (out.data[i + 3] > 0) { out.data[i + 3] = 0; cut++; }
  }
}

writeFileSync(outFile, PNG.sync.write(out));

// --- report on the result ------------------------------------------------
const png2 = PNG.sync.read(readFileSync(outFile));
const A2 = (x, y) => png2.data[(y * png2.width + x) * 4 + 3];
let minx = W, maxx = -1, miny = H, maxy = -1;
const rows = new Map();
for (let y = 0; y < H; y++) {
  let l = -1, r = -1;
  for (let x = 0; x < W; x++) if (A2(x, y) > 128) { if (l < 0) l = x; r = x; }
  if (l >= 0) { rows.set(y, [l, r]); if (y < miny) miny = y; if (y > maxy) maxy = y; if (l < minx) minx = l; if (r > maxx) maxx = r; }
}
const bandTop = maxy - Math.max(20, Math.round((maxy - miny + 1) * 0.3));
const pts2 = [...rows.entries()].filter(([y]) => y >= bandTop);
const slopeOf = (pts, idx) => {
  const n = pts.length;
  const my = pts.reduce((s, p) => s + p[0], 0) / n;
  const mx = pts.reduce((s, p) => s + p[1][idx], 0) / n;
  let num = 0, den = 0;
  for (const p of pts) { num += (p[0] - my) * (p[1][idx] - mx); den += (p[0] - my) ** 2; }
  return num / den;
};
const lDxDy = slopeOf(pts2, 0), rDxDy = slopeOf(pts2, 1);
const report = {
  file: inFile.replace(/\\/g, "/").split("/").slice(-1)[0],
  output: outFile.replace(/\\/g, "/").split("/").slice(-1)[0],
  sandEdge: {
    measuredDydx: +measuredDydx.toFixed(4), measuredAngleDeg: +angleDeg.toFixed(2),
    targetDydx: TARGET_DYDX, verticalScale: +sy.toFixed(4),
    southVertex: { x: Math.round(vx), y: Math.round(vy) },
    fitted: { left: { m: +L.m.toFixed(4), b: +L.b.toFixed(1), n: L.n }, right: { m: +R.m.toFixed(4), b: +R.b.toFixed(1), n: R.n } },
  },
  afterCut: {
    silhouette: { top: miny, bottom: maxy, h: maxy - miny + 1 },
    bottomPadRows: H - 1 - maxy,
    lowerEdgeDxDy: { left: +lDxDy.toFixed(4), right: +rDxDy.toFixed(4) },
    lowerEdgeAngleDeg: +(Math.atan(1 / ((Math.abs(lDxDy) + Math.abs(rDxDy)) / 2)) * 180 / Math.PI).toFixed(2),
    clearedBelowLotPixels: cut,
  },
};
console.log(JSON.stringify(report, null, 2));
if (reportFile) writeFileSync(reportFile, JSON.stringify(report, null, 2));
