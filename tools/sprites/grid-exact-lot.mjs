// Re-author a fitted lot in the repo's grid-exact convention, then run the
// audit suite's own Part-1 measurements against it.
//
//   node grid-exact-lot.mjs <in-fitted.png> <out.png>
//
// Convention (the five building-pixel-farm<Style>-1.png plots, which
// test/townCenterSprite.e2e.ts calibrates on): the ground diamond spans the
// FULL canvas width and its south vertex is the canvas' bottom row, so the
// engine's anchor maths needs no bottom pad at all.
//
// The transform is a single uniform scale about the ground diamond's south
// vertex (never an axis-independent stretch, so the building keeps its
// proportions): s = canvasWidth / diamondWidth, then the south vertex is
// placed on the bottom row and the sprite is centred horizontally.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const [, , inFile, outFile] = process.argv;
if (!inFile || !outFile) {
  console.error("usage: node grid-exact-lot.mjs <in-fitted.png> <out.png>");
  process.exit(1);
}

// ── the audit suite's thresholds, copied from test/townCenterSprite.e2e.ts ──
const ISO_SLOPE = 0.5, MAX_SLOPE_DEV = 0.06, MAX_BOTTOM_PAD_ROWS = 2;
const MIN_GROUND_WIDTH_RATIO = 0.95, MAX_BELOW_GROUND_PX = 16;
const MAX_BASE_OFFSET_PX = 2, MAX_RENDERED_SLOPE_DEV = 0.08, MIN_RENDERED_FOOTPRINT_COVERAGE = 0.95;
const TILE_W = 96, TILE_D = 48;

function alphaRows(png, alphaMin = 10) {
  const { width, height, data } = png;
  const rows = [];
  for (let y = 0; y < height; y++) {
    let lo = -1, hi = -1;
    for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3] > alphaMin) { if (lo < 0) lo = x; hi = x; }
    rows.push(lo < 0 ? null : { lo, hi, w: hi - lo + 1 });
  }
  return rows;
}
function silhouetteOf(png) {
  const rows = alphaRows(png);
  let minY = 1e9, maxY = -1;
  for (let y = 0; y < rows.length; y++) if (rows[y]) { if (y < minY) minY = y; maxY = y; }
  let widest = null;
  for (let y = minY; y <= maxY; y++) { const r = rows[y]; if (r && (!widest || r.w > widest.w)) widest = { y, ...r }; }
  const bottomVertexX = Math.round((widest.lo + widest.hi) / 2);
  const run = bottomVertexX - widest.lo;
  return {
    width: png.width, height: png.height, minY, maxY, bottomPadRows: png.height - 1 - maxY,
    widest, bottomVertexX,
    edgeSlope: run > 0 ? (maxY - widest.y) / run : 0,
    widthRatio: widest.w / png.width,
    belowGroundPx: maxY - (widest.y + widest.w / 4),
  };
}

const src = PNG.sync.read(readFileSync(inFile));
const before = silhouetteOf(src);

// ── uniform scale so the diamond spans the canvas, south vertex on the bottom
const s = src.width / before.widest.w;
const out = new PNG({ width: src.width, height: src.height });
out.data.fill(0);
const vx = before.bottomVertexX, vy = before.maxY;
for (let y = 0; y < out.height; y++) {
  const sy = Math.round(vy + (y - (out.height - 1)) / s);
  if (sy < 0 || sy >= src.height) continue;
  for (let x = 0; x < out.width; x++) {
    const sx = Math.round(vx + (x - out.width / 2) / s);
    if (sx < 0 || sx >= src.width) continue;
    const si = (sy * src.width + sx) * 4, di = (y * out.width + x) * 4;
    out.data[di] = src.data[si]; out.data[di + 1] = src.data[si + 1];
    out.data[di + 2] = src.data[si + 2]; out.data[di + 3] = src.data[si + 3];
  }
}
writeFileSync(outFile, PNG.sync.write(out));

// ── re-measure with the audit suite's formulas ─────────────────────────────
const art = silhouetteOf(PNG.sync.read(readFileSync(outFile)));
const ref = silhouetteOf(PNG.sync.read(readFileSync(path.join(ROOT, "src", "resources", "buildings", "building-pixel-farmWheat-1.png"))));
const drawnHeight1x1 = TILE_W * 0.9, drawnHeight2x2 = 2 * TILE_W * 0.9;
const committedOffsetY = Math.round((art.bottomPadRows * drawnHeight1x1) / art.height);
const requiredOffsetY = (art.bottomPadRows * drawnHeight2x2) / art.height;

function rendered(hexSizeMul) {
  const sw = TILE_W * hexSizeMul, sh = sw;              // square canvas, fitWidth
  const canvasToDrawn = sw / art.width;
  const groundWidth = art.widest.w * canvasToDrawn;
  // paintCityBuilding: dy = y + td*0.5 - sh + anchorOffsetY, where td = 2*TILE_D
  // for this 2x2 footprint, so visibleBase - southVertex = anchorOffsetY - pad*(sh/dh).
  const baseOffset = committedOffsetY - art.bottomPadRows * (sh / art.height);
  const slope = art.edgeSlope;
  return {
    hexSizeMul, drawnWidth: +sw.toFixed(1), drawnHeight: +sh.toFixed(1),
    groundWidthDrawn: +groundWidth.toFixed(1),
    footprintWidth: 2 * TILE_W,
    coverage: +(groundWidth / (2 * TILE_W)).toFixed(3),
    coveragePass: groundWidth >= MIN_RENDERED_FOOTPRINT_COVERAGE * 2 * TILE_W,
    baseOffsetPx: +baseOffset.toFixed(2),
    basePass: Math.abs(baseOffset) <= MAX_BASE_OFFSET_PX,
    slopePass: Math.abs(slope - ISO_SLOPE) <= MAX_RENDERED_SLOPE_DEV,
  };
}

console.log(JSON.stringify({
  input: inFile.replace(/\\/g, "/").split("/").slice(-1)[0],
  output: outFile.replace(/\\/g, "/").split("/").slice(-1)[0],
  uniformScale: +s.toFixed(4),
  before: { edgeSlope: +before.edgeSlope.toFixed(3), bottomPadRows: before.bottomPadRows, widthRatio: +before.widthRatio.toFixed(3), belowGroundPx: +before.belowGroundPx.toFixed(1) },
  part1_auditChecks: {
    A1_slope: { value: +art.edgeSlope.toFixed(3), tolerance: ISO_SLOPE + " +-" + MAX_SLOPE_DEV, pass: Math.abs(art.edgeSlope - ISO_SLOPE) <= MAX_SLOPE_DEV, reference: +ref.edgeSlope.toFixed(3) },
    A2_bottomPad: { value: art.bottomPadRows, max: MAX_BOTTOM_PAD_ROWS, pass: art.bottomPadRows <= MAX_BOTTOM_PAD_ROWS, reference: ref.bottomPadRows },
    A3_widthRatio: { value: +art.widthRatio.toFixed(3), min: MIN_GROUND_WIDTH_RATIO, pass: art.widthRatio >= MIN_GROUND_WIDTH_RATIO, reference: +ref.widthRatio.toFixed(3) },
    A4_belowGround: { value: +art.belowGroundPx.toFixed(1), max: MAX_BELOW_GROUND_PX, pass: art.belowGroundPx <= MAX_BELOW_GROUND_PX, reference: +ref.belowGroundPx.toFixed(1) },
    A5_anchor: { committedOffsetY, requiredOffsetY: +requiredOffsetY.toFixed(2), pass: Math.abs(committedOffsetY - requiredOffsetY) <= 1 },
  },
  art: { minY: art.minY, maxY: art.maxY, widestRow: art.widest.y, widestWidth: art.widest.w, bottomVertexX: art.bottomVertexX },
  renderedNow_hexSizeMul_0_9: rendered(0.9),
  renderedIfDescriptorFixed_hexSizeMul_2_0: rendered(2.0),
}, null, 2));
