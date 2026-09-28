// Repair alpha-channel damage in sprite PNGs — specifically the thin
// transparent seams that strip-checkerboard.mjs / remove-specks.mjs can
// over-erode into art boundaries. On the drake commander sprites
// (src/resources/units/horse/commander-9) those 1-5px seams shattered single
// sprites into up to 95 disconnected opaque fragments with see-through slits
// in-game. This tool applies the repair validated on that damage:
//   1. seam bridge — transparent pixels within --bridge px (default 3) of
//      opaque art on both sides along any axis (H/V/both diagonals), above
//      the under-belly line (bottom third of the content bbox), get sealed:
//      ghost px (0<alpha<255) snap to opaque keeping RGB; fully-transparent
//      px are ring-inpainted, then snapped to the ring's dominant colors.
//   2. lake-drain safeguard — the background is re-flooded from the borders
//      after bridging; any legit opening the bridging just enclosed (wing
//      scallops, under-belly windows) gets a corridor re-opened to the
//      outside.
//   3. remaining enclosed holes above the under-belly line and < 2000 px are
//      ring-inpainted + dominant-snapped. Bottom-third holes and anything
//      bigger are only reported (conservative; leg gaps / scallops live
//      there).
//   4. interior partial-alpha pixels (all 8 neighbours opaque) snap to
//      opaque, iterated to fixpoint.
// Opaque art RGB is never modified. Idempotent: the repair passes only run
// when the --check defect classification finds something (suspect holes,
// interior partial alpha, or heavy fragmentation); a clean file — including
// one this tool repaired before — reports zeros and is not rewritten.
//
// Usage:
//   node repair-alpha.mjs <file.png> [more.png ...] [--check] [--bridge N] [--dry-run] [--quiet]
//
// Modes:
//   default   repair in place
//   --check   report only, no writes; exit 1 if any defect found, 0 if clean
//   --bridge N   max seam half-width in px (default 3)
//   --dry-run    run the repair pipeline, change nothing on disk
//   --quiet      suppress per-file lines for clean/unchanged files
//
// Defects (the --check gate): enclosed holes above the under-belly line,
// interior partial-alpha pixels, or fragmentation (>12 opaque components AND
// the main component holding <50% of all opaque px). Small detached islands
// (foot-claw highlights etc.) and enclosed pockets in the bottom third of the
// content bbox are reported but are not defects and are never touched.

import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";

const USAGE = "usage: node repair-alpha.mjs <file.png> [more.png ...] [--check] [--bridge N] [--dry-run] [--quiet]";

const files = [];
let mode = "repair";
let bridge = 3;
let dryRun = false;
let quiet = false;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--check") mode = "check";
  else if (a === "--dry-run") dryRun = true;
  else if (a === "--quiet") quiet = true;
  else if (a === "--bridge") {
    bridge = Number(argv[++i]);
    if (!Number.isFinite(bridge) || bridge < 1 || bridge > 32) { console.error("--bridge expects a number in 1..32"); process.exit(2); }
  } else if (a === "--help" || a === "-h") { console.log(USAGE); process.exit(0); }
  else if (a.startsWith("--")) { console.error("Unknown flag: " + a + "\n" + USAGE); process.exit(2); }
  else files.push(a);
}
if (!files.length) { console.error(USAGE); process.exit(2); }

// Plain Node + Playwright canvas, same pattern as strip-checkerboard.mjs: the
// pixel algorithm runs in the bundled Chromium, files move in/out as base64.
const HTML = `<!DOCTYPE html><html><body><canvas id="c"></canvas><script>
window.repairAlpha = async (b64, opts) => {
  const OPAQUE = 128;
  const img = new Image();
  await new Promise((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error("image decode failed"));
    img.src = "data:image/png;base64," + b64;
  });
  const w = img.naturalWidth, h = img.naturalHeight, N = w * h;
  const c = document.getElementById("c");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0);
  const id = ctx.getImageData(0, 0, w, h);

  function analyze(d) {
    const px = d.data;
    const alpha = new Uint8Array(N);
    for (let i = 0; i < N; i++) alpha[i] = px[i * 4 + 3];

    let minx = w, miny = h, maxx = -1, maxy = -1, opaqueCount = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (alpha[y * w + x] >= OPAQUE) {
          opaqueCount++;
          if (x < minx) minx = x;
          if (x > maxx) maxx = x;
          if (y < miny) miny = y;
          if (y > maxy) maxy = y;
        }
      }
    }
    const contentBbox = maxx < 0 ? null : [minx, miny, maxx, maxy];
    const underY = contentBbox ? contentBbox[1] + (contentBbox[3] - contentBbox[1] + 1) * (2 / 3) : h;
    let upperOpaque = 0;
    for (let i = 0; i < N; i++) if (alpha[i] >= OPAQUE && ((i - (i % w)) / w) < underY) upperOpaque++;

    function label(pred, keep) {
      const labels = new Int32Array(N).fill(-1);
      const queue = new Int32Array(N);
      const comps = [];
      for (let s = 0; s < N; s++) {
        if (!pred(s) || labels[s] !== -1) continue;
        const cid = comps.length;
        labels[s] = cid;
        let head = 0, tail = 0;
        queue[tail++] = s;
        let count = 0, sx = 0, sy = 0, mnx = w, mny = h, mxx = -1, mxy = -1, border = false;
        const pixels = keep ? [] : null;
        while (head < tail) {
          const p = queue[head++];
          const x = p % w, y = (p - x) / w;
          count++; sx += x; sy += y;
          if (x < mnx) mnx = x;
          if (x > mxx) mxx = x;
          if (y < mny) mny = y;
          if (y > mxy) mxy = y;
          if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
          if (pixels) pixels.push(p);
          if (x > 0 && pred(p - 1) && labels[p - 1] === -1) { labels[p - 1] = cid; queue[tail++] = p - 1; }
          if (x < w - 1 && pred(p + 1) && labels[p + 1] === -1) { labels[p + 1] = cid; queue[tail++] = p + 1; }
          if (y > 0 && pred(p - w) && labels[p - w] === -1) { labels[p - w] = cid; queue[tail++] = p - w; }
          if (y < h - 1 && pred(p + w) && labels[p + w] === -1) { labels[p + w] = cid; queue[tail++] = p + w; }
        }
        comps.push({ count, cx: sx / count, cy: sy / count, bbox: [mnx, mny, mxx, mxy], touchesBorder: border, pixels });
      }
      return comps;
    }

    const holes = label((i) => alpha[i] < OPAQUE, true)
      .filter((cc) => !cc.touchesBorder)
      .map((cc) => ({
        count: cc.count, cx: cc.cx, cy: cc.cy, bbox: cc.bbox,
        location: cc.cy >= underY ? "underbelly" : "suspect", pixels: cc.pixels,
      }));

    const opComps = label((i) => alpha[i] >= OPAQUE, false);
    opComps.sort((a, b) => b.count - a.count);
    const main = opComps[0] || { count: 0, bbox: null };
    const islands = opComps.slice(1).filter((cc) => cc.count < 400);
    const bigOthers = opComps.slice(1).filter((cc) => cc.count >= 400);

    let partialTotal = 0, partialClusters = 0;
    {
      const pflag = new Uint8Array(N);
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x, a = alpha[i];
          if (a < 1 || a > 254) continue;
          if (
            alpha[i - 1] >= OPAQUE && alpha[i + 1] >= OPAQUE &&
            alpha[i - w] >= OPAQUE && alpha[i + w] >= OPAQUE &&
            alpha[i - w - 1] >= OPAQUE && alpha[i - w + 1] >= OPAQUE &&
            alpha[i + w - 1] >= OPAQUE && alpha[i + w + 1] >= OPAQUE
          ) { pflag[i] = 1; partialTotal++; }
        }
      }
      const seen = new Uint8Array(N);
      const stack = [];
      for (let i0 = 0; i0 < N; i0++) {
        if (!pflag[i0] || seen[i0]) continue;
        partialClusters++;
        stack.length = 0; stack.push(i0); seen[i0] = 1;
        while (stack.length) {
          const p = stack.pop();
          const x = p % w;
          const nbs = [p - 1, p + 1, p - w, p + w];
          for (const nb of nbs) {
            if (nb < 0 || nb >= N) continue;
            if (Math.abs((nb % w) - x) > 1) continue;
            if (pflag[nb] && !seen[nb]) { seen[nb] = 1; stack.push(nb); }
          }
        }
      }
    }

    return {
      size: [w, h], contentBbox, opaqueCount, upperOpaque, underY,
      mainComponent: { count: main.count, bbox: main.bbox },
      opaqueComponentCount: opComps.length,
      holes, islands, bigOtherCount: bigOthers.length,
      partial: { total: partialTotal, clusters: partialClusters },
    };
  }

  const rep = analyze(id);
  const slim = (r) => JSON.parse(JSON.stringify(r, (k, v) => (k === "pixels" ? undefined : v)));

  if (opts.mode === "check") return { rep: slim(rep) };

  // Defect gate (same classification as --check): only damaged sprites get
  // the repair passes. A clean file — one this tool repaired before, or one
  // whose thin transparent channels are legit surface detail — is left
  // byte-identical.
  const suspectPx0 = rep.holes.filter((x) => x.location === "suspect").reduce((s, x) => s + x.count, 0);
  const mainPct0 = rep.opaqueCount ? (100 * rep.mainComponent.count) / rep.opaqueCount : 100;
  const hasDefects =
    suspectPx0 > 0 ||
    rep.partial.total > 0 ||
    (rep.opaqueComponentCount > 12 && mainPct0 < 50);
  if (!hasDefects) return { clean: true, rep: slim(rep) };

  const stopRatio = rep.upperOpaque > 0 ? suspectPx0 / rep.upperOpaque : 0;
  if (stopRatio > 0.25) {
    return { stopped: true, stopRatio, suspectPx0, upperOpaque: rep.upperOpaque, rep: slim(rep) };
  }

  const orig = id.data;
  const out = new ImageData(new Uint8ClampedArray(orig), w, h);
  const od = out.data;
  const a0 = new Uint8Array(N);
  for (let i = 0; i < N; i++) a0[i] = orig[i * 4 + 3];
  const underY = rep.underY;
  const walkMax = opts.bridge;
  const changed = { seam: new Set(), hole: new Set(), drain: new Set() };
  const stats = {
    seamPasses: 0, seamGhostKept: 0, seamFilled: 0, seamSnapDominant: 0,
    lakesDrained: 0, lakesKept: 0,
    holeFilled: 0, holeSkippedTooBig: 0, holeSnapDominant: 0,
    partialSnapped: 0, partialPasses: 0, belowUnderY: 0,
  };

  const curAlpha = () => {
    const a = new Uint8Array(N);
    for (let i = 0; i < N; i++) a[i] = od[i * 4 + 3];
    return a;
  };

  function enclosedComps() {
    const alpha = curAlpha();
    const labels = new Int32Array(N).fill(-1);
    const queue = new Int32Array(N);
    const comps = [];
    let compId = 0;
    const borderLabels = new Set();
    for (let s = 0; s < N; s++) {
      if (alpha[s] >= OPAQUE || labels[s] !== -1) continue;
      const cid = compId++;
      let head = 0, tail = 0;
      labels[s] = cid; queue[tail++] = s;
      const pixels = [];
      let border = false;
      while (head < tail) {
        const p = queue[head++];
        pixels.push(p);
        const x = p % w;
        if (x === 0 || x === w - 1 || p < w || p >= N - w) border = true;
        if (x > 0 && alpha[p - 1] < OPAQUE && labels[p - 1] === -1) { labels[p - 1] = cid; queue[tail++] = p - 1; }
        if (x < w - 1 && alpha[p + 1] < OPAQUE && labels[p + 1] === -1) { labels[p + 1] = cid; queue[tail++] = p + 1; }
        if (p >= w && alpha[p - w] < OPAQUE && labels[p - w] === -1) { labels[p - w] = cid; queue[tail++] = p - w; }
        if (p + w < N && alpha[p + w] < OPAQUE && labels[p + w] === -1) { labels[p + w] = cid; queue[tail++] = p + w; }
      }
      comps.push({ count: pixels.length, pixels, border, idRef: cid });
      if (border) borderLabels.add(cid);
    }
    return comps.filter((cc) => !cc.border);
  }

  function dominantSnap(pixels) {
    const buckets = new Map();
    for (const p of pixels) {
      const x = p % w, y = (p - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const nb = ny * w + nx;
          if (od[nb * 4 + 3] < OPAQUE) continue;
          const q4 = nb * 4;
          const key = ((od[q4] >> 4) << 8) | ((od[q4 + 1] >> 4) << 4) | (od[q4 + 2] >> 4);
          buckets.set(key, (buckets.get(key) || 0) + 1);
        }
      }
    }
    const dom = [...buckets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([k]) => [((k >> 8) & 15) * 16 + 8, ((k >> 4) & 15) * 16 + 8, (k & 15) * 16 + 8]);
    if (!dom.length) return 0;
    let snapped = 0;
    for (const p of pixels) {
      const q4 = p * 4;
      const col = [od[q4], od[q4 + 1], od[q4 + 2]];
      let bd = Infinity, bc = col;
      for (const d of dom) {
        const dd = (d[0] - col[0]) ** 2 + (d[1] - col[1]) ** 2 + (d[2] - col[2]) ** 2;
        if (dd < bd) { bd = dd; bc = d; }
      }
      if (bc !== col) { od[q4] = bc[0]; od[q4 + 1] = bc[1]; od[q4 + 2] = bc[2]; snapped++; }
    }
    return snapped;
  }

  // 1. seam bridge (above the under-belly line only), iterated: sealing a
  //    channel narrows neighbouring channels, so candidates are recomputed
  //    every pass until none remain or the pass cap is hit.
  const AXES = [[1, 0], [0, 1], [1, 1], [1, -1]];
  const seamInpainted = [];
  while (stats.seamPasses < 8) {
    const alpha = curAlpha();
    const cands = [];
    for (let y = 1; y < h - 1; y++) {
      if (y >= underY) continue;
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (alpha[i] >= OPAQUE || changed.seam.has(i)) continue;
        for (const [dx, dy] of AXES) {
          let f = -1;
          for (let t = 1; t <= walkMax; t++) {
            const qx = x + dx * t, qy = y + dy * t;
            if (qx < 0 || qy < 0 || qx >= w || qy >= h) break;
            if (alpha[qy * w + qx] >= OPAQUE) { f = t; break; }
          }
          if (f < 0) continue;
          let b = -1;
          for (let t = 1; t <= walkMax; t++) {
            const qx = x - dx * t, qy = y - dy * t;
            if (qx < 0 || qy < 0 || qx >= w || qy >= h) break;
            if (alpha[qy * w + qx] >= OPAQUE) { b = t; break; }
          }
          if (b > 0) { cands.push(i); break; }
        }
      }
    }
    if (!cands.length) break;
    stats.seamPasses++;
    const candSet = new Set(cands);
    for (const p of cands) {
      if (a0[p] > 0) {
        od[p * 4 + 3] = 255;
        changed.seam.add(p);
        stats.seamGhostKept++;
      }
    }
    const ghostOrFilled = (p) => (a0[p] > 0 && candSet.has(p)) || changed.seam.has(p);
    let pending = cands.filter((p) => a0[p] === 0);
    let guard = 0;
    while (pending.length && guard++ <= pending.length + 10) {
      const next = [];
      for (const p of pending) {
        const x = p % w;
        const nbs = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w];
        let r = 0, g = 0, b = 0, n = 0;
        for (const nb of nbs) {
          if (nb < 0 || nb >= N) continue;
          if (a0[nb] >= OPAQUE || ghostOrFilled(nb)) {
            const q4 = nb * 4;
            r += od[q4]; g += od[q4 + 1]; b += od[q4 + 2]; n++;
          }
        }
        if (n > 0) {
          const q4 = p * 4;
          od[q4] = Math.round(r / n); od[q4 + 1] = Math.round(g / n); od[q4 + 2] = Math.round(b / n); od[q4 + 3] = 255;
          changed.seam.add(p);
          seamInpainted.push(p);
          stats.seamFilled++;
        } else {
          next.push(p);
        }
      }
      if (next.length === pending.length) {
        for (const p of next) { od[p * 4 + 3] = 255; changed.seam.add(p); seamInpainted.push(p); stats.seamFilled++; }
        break;
      }
      pending = next;
    }
  }
  stats.seamSnapDominant = dominantSnap(seamInpainted);

  // 2. lake-drain safeguard: background that was border-connected before the
  //    bridging and got enclosed by it re-opens via a corridor through the
  //    freshly bridged/filled pixels.
  const beforeHoleSet = new Set();
  for (const bh of rep.holes) for (const p of bh.pixels) beforeHoleSet.add(p);
  const openSet = new Uint8Array(N);
  {
    const stack = [];
    const seed = (p) => { if (!openSet[p] && od[p * 4 + 3] < OPAQUE) { openSet[p] = 1; stack.push(p); } };
    for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
    while (stack.length) {
      const p = stack.pop();
      const x = p % w;
      if (x > 0) seed(p - 1);
      if (x < w - 1) seed(p + 1);
      if (p >= w) seed(p - w);
      if (p + w < N) seed(p + w);
    }
  }
  const lakeDrainMinPx = 200;
  for (const lake of enclosedComps()) {
    if (lake.count <= lakeDrainMinPx) { stats.lakesKept++; continue; }
    let overlapsBefore = false;
    for (const p of lake.pixels) if (beforeHoleSet.has(p)) { overlapsBefore = true; break; }
    if (overlapsBefore) { stats.lakesKept++; continue; }
    const lakeSet = new Set(lake.pixels);
    const isFill = (p) => (changed.seam.has(p) || changed.hole.has(p)) && a0[p] < OPAQUE;
    const parent = new Map();
    const visited = new Set(lakeSet);
    let queue = [];
    for (const p of lake.pixels) {
      const x = p % w;
      const nbs = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w];
      for (const nb of nbs) {
        if (nb < 0 || nb >= N || visited.has(nb)) continue;
        if (isFill(nb)) { visited.add(nb); parent.set(nb, p); queue.push(nb); }
      }
    }
    let exit = -1;
    let head = 0;
    while (head < queue.length && exit < 0) {
      const p = queue[head++];
      const x = p % w;
      const nbs = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w];
      for (const nb of nbs) {
        if (nb < 0 || nb >= N) continue;
        if (openSet[nb]) { exit = p; break; }
        if (!visited.has(nb) && isFill(nb)) { visited.add(nb); parent.set(nb, p); queue.push(nb); }
      }
      if (queue.length > 40000) break;
    }
    if (exit >= 0) {
      const path = [];
      let cur = exit;
      while (cur !== undefined && !lakeSet.has(cur)) { path.push(cur); cur = parent.get(cur); }
      for (const p of path) {
        const q4 = p * 4;
        od[q4] = 0; od[q4 + 1] = 0; od[q4 + 2] = 0; od[q4 + 3] = 0;
        changed.seam.delete(p);
        changed.hole.delete(p);
        changed.drain.add(p);
        openSet[p] = 1;
      }
      stats.lakesDrained++;
    } else {
      stats.lakesKept++;
    }
  }

  // 3. fill remaining enclosed holes above the under-belly line (and below
  //    the size cap); ring-inpaint from surrounding opaque art, then snap the
  //    fill to the ring's dominant colors.
  for (const hl of enclosedComps()) {
    if (hl.count > 2000) { stats.holeSkippedTooBig++; continue; }
    const cy = hl.pixels.reduce((s, p) => s + (p - (p % w)) / w, 0) / hl.count;
    if (cy >= underY) continue;
    const pixels = hl.pixels;
    const inRegion = new Set(pixels);
    const isSrc = (p) => od[p * 4 + 3] >= OPAQUE && !inRegion.has(p);
    const filled = new Map();
    let pending2 = new Set(pixels);
    let frontier = [];
    const hasSrcNb = (p) => {
      const x = p % w;
      const nbs = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w];
      return nbs.some((nb) => nb >= 0 && nb < N && isSrc(nb));
    };
    const hasFilledNb = (p) => {
      const x = p % w;
      const nbs = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w];
      return nbs.some((nb) => nb >= 0 && nb < N && filled.has(nb));
    };
    for (const p of pixels) if (hasSrcNb(p)) frontier.push(p);
    let rounds = 0;
    while (frontier.length && pending2.size && rounds++ <= pixels.length + 10) {
      for (const p of frontier) {
        if (!pending2.has(p)) continue;
        let r = 0, g = 0, b = 0, n = 0;
        const x = p % w;
        const nbs = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w];
        for (const nb of nbs) {
          if (nb < 0 || nb >= N) continue;
          if (isSrc(nb)) { const q4 = nb * 4; r += od[q4]; g += od[q4 + 1]; b += od[q4 + 2]; n++; }
          else if (filled.has(nb)) { const cc = filled.get(nb); r += cc[0]; g += cc[1]; b += cc[2]; n++; }
        }
        const avg = n > 0 ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : [128, 128, 128];
        filled.set(p, avg);
        const q4 = p * 4;
        od[q4] = avg[0]; od[q4 + 1] = avg[1]; od[q4 + 2] = avg[2]; od[q4 + 3] = 255;
        changed.hole.add(p);
        pending2.delete(p);
      }
      const next = [];
      for (const p of pending2) if (hasFilledNb(p)) next.push(p);
      frontier = next;
    }
    for (const p of pending2) {
      const q4 = p * 4;
      od[q4 + 3] = 255;
      changed.hole.add(p);
      filled.set(p, [od[q4], od[q4 + 1], od[q4 + 2]]);
    }
    stats.holeSnapDominant += dominantSnap(pixels);
    stats.holeFilled += filled.size;
    for (const p of pixels) if ((p - (p % w)) / w >= underY) stats.belowUnderY++;
  }

  // 4. interior partial-alpha px (all 8 neighbours opaque) -> opaque,
  //    iterated to fixpoint.
  while (stats.partialPasses < 64) {
    let snapped = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x, a = od[i * 4 + 3];
        if (a < 1 || a > 254) continue;
        if (
          od[(i - 1) * 4 + 3] >= OPAQUE && od[(i + 1) * 4 + 3] >= OPAQUE &&
          od[(i - w) * 4 + 3] >= OPAQUE && od[(i + w) * 4 + 3] >= OPAQUE &&
          od[(i - w - 1) * 4 + 3] >= OPAQUE && od[(i - w + 1) * 4 + 3] >= OPAQUE &&
          od[(i + w - 1) * 4 + 3] >= OPAQUE && od[(i + w + 1) * 4 + 3] >= OPAQUE
        ) { od[i * 4 + 3] = 255; stats.partialSnapped++; snapped++; }
      }
    }
    stats.partialPasses++;
    if (!snapped) break;
  }

  let changedPx = 0;
  const verify = { violationsOpaqueRgbTouched: 0, changedBelowUnderY: 0 };
  for (let i = 0; i < N; i++) {
    const q4 = i * 4;
    const differs = orig[q4] !== od[q4] || orig[q4 + 1] !== od[q4 + 1] || orig[q4 + 2] !== od[q4 + 2] || orig[q4 + 3] !== od[q4 + 3];
    if (!differs) continue;
    changedPx++;
    if (a0[i] >= OPAQUE) {
      if (orig[q4] !== od[q4] || orig[q4 + 1] !== od[q4 + 1] || orig[q4 + 2] !== od[q4 + 2]) verify.violationsOpaqueRgbTouched++;
    } else if (((i - (i % w)) / w) >= underY && !changed.drain.has(i)) {
      verify.changedBelowUnderY++;
    }
  }

  const after = analyze(out);
  let b64out = null;
  if (changedPx > 0) {
    ctx.putImageData(out, 0, 0);
    b64out = c.toDataURL("image/png").split(",")[1];
  }
  return { stopped: false, stopRatio, rep: slim(rep), after: slim(after), stats, verify, changedPx, b64: b64out };
};
</script></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(HTML);

const fmt = (r) => {
  const sus = r.holes.filter((x) => x.location === "suspect");
  const ub = r.holes.filter((x) => x.location === "underbelly");
  return {
    comps: r.opaqueComponentCount,
    mainPct: r.opaqueCount ? +((100 * r.mainComponent.count) / r.opaqueCount).toFixed(1) : 0,
    suspectHoles: sus.length,
    suspectPx: sus.reduce((s, x) => s + x.count, 0),
    underbellyHoles: ub.length,
    underbellyPx: ub.reduce((s, x) => s + x.count, 0),
    islands: r.islands.length,
    islandPx: r.islands.reduce((s, x) => s + x.count, 0),
    bigOthers: r.bigOtherCount,
    partial: r.partial.total,
  };
};

let exitCode = 0;
let nDefect = 0;
let nRepaired = 0;
let nClean = 0;
let nErrors = 0;

for (const file of files) {
  let buf;
  try {
    buf = readFileSync(file);
  } catch (e) {
    console.error(file + ": " + e.message);
    exitCode = 2;
    nErrors++;
    continue;
  }
  try {
    const res = await page.evaluate(async (payload) => window.repairAlpha(payload.b64, payload.opts), { b64: buf.toString("base64"), opts: { mode, bridge } });

    if (mode === "check") {
      const m = fmt(res.rep);
      const defects = [];
      if (m.suspectHoles > 0) defects.push("suspectHoles " + m.suspectPx + "px in " + m.suspectHoles + " hole(s)");
      if (m.partial > 0) defects.push("interiorPartialAlpha " + m.partial + "px");
      if (m.comps > 12 && m.mainPct < 50) defects.push("fragmentation " + m.comps + " comps, main " + m.mainPct + "%");
      if (defects.length) {
        nDefect++;
        exitCode = Math.max(exitCode, 1);
        console.log(file + ": comps=" + m.comps + " main=" + m.mainPct + "% enclosedHoles suspect=" + m.suspectHoles + "(" + m.suspectPx + "px) underbelly=" + m.underbellyHoles + "(" + m.underbellyPx + "px) | islands=" + m.islands + "(" + m.islandPx + "px) bigOthers=" + m.bigOthers + " | interiorPartial=" + m.partial + "px | DEFECT: " + defects.join("; "));
      } else if (!quiet) {
        console.log(file + ": comps=" + m.comps + " main=" + m.mainPct + "% enclosedHoles suspect=" + m.suspectHoles + "(" + m.suspectPx + "px) underbelly=" + m.underbellyHoles + "(" + m.underbellyPx + "px) | islands=" + m.islands + "(" + m.islandPx + "px) bigOthers=" + m.bigOthers + " | interiorPartial=" + m.partial + "px | OK");
      }
      continue;
    }

    if (res.stopped) {
      console.error(file + ": SKIPPED - suspect hole px " + res.suspectPx0 + " is " + (res.stopRatio * 100).toFixed(1) + "% of the opaque px above the under-belly line (>25%). Not repairing; inspect or regenerate this sprite.");
      exitCode = Math.max(exitCode, 1);
      continue;
    }

    const b = fmt(res.rep);
    if (res.clean) {
      nClean++;
      if (!quiet) console.log(file + ": comps " + b.comps + " (main " + b.mainPct + "%), suspectHoles " + b.suspectPx + "px, partial " + b.partial + " | no defects, already clean");
      continue;
    }
    const a = fmt(res.after);
    if (res.changedPx === 0) {
      nClean++;
      if (!quiet) console.log(file + ": comps " + b.comps + "->" + a.comps + " (main " + b.mainPct + "%->" + a.mainPct + "%), suspectHoles " + b.suspectPx + "px->" + a.suspectPx + "px, partial " + b.partial + "->" + a.partial + " | unchanged (already clean)");
      continue;
    }
    if (res.verify.violationsOpaqueRgbTouched > 0) {
      console.error(file + ": INTERNAL ERROR - repair touched opaque art RGB on " + res.verify.violationsOpaqueRgbTouched + " px; not writing. Please report this.");
      exitCode = 2;
      continue;
    }
    const ops = "seam " + (res.stats.seamFilled + res.stats.seamGhostKept) + "px in " + res.stats.seamPasses + " pass(es) (ghost " + res.stats.seamGhostKept + ", inpainted " + res.stats.seamFilled + ", dominantSnapped " + res.stats.seamSnapDominant + "), lakesDrained " + res.stats.lakesDrained + ", holesFilled " + res.stats.holeFilled + "px, partialSnapped " + res.stats.partialSnapped + "px";
    const tail = dryRun ? "dry-run, not written" : "wrote";
    if (!dryRun) writeFileSync(file, Buffer.from(res.b64, "base64"));
    nRepaired++;
    console.log(file + ": comps " + b.comps + "->" + a.comps + " (main " + b.mainPct + "%->" + a.mainPct + "%), suspectHoles " + b.suspectPx + "px->" + a.suspectPx + "px, underbellyHoles " + b.underbellyPx + "px->" + a.underbellyPx + "px, partial " + b.partial + "->" + a.partial + " | " + ops + (res.verify.changedBelowUnderY ? " | note: " + res.verify.changedBelowUnderY + " alpha-only px changed below the under-belly line" : "") + " | " + tail);
  } catch (e) {
    console.error(file + ": " + (e.message || e));
    exitCode = 2;
    nErrors++;
  }
}

if (mode === "check") {
  console.log(files.length + " file(s) checked: " + nDefect + " with defects, " + (files.length - nDefect - nErrors) + " clean");
} else if (!quiet) {
  console.log(files.length + " file(s): " + nRepaired + " " + (dryRun ? "would be repaired" : "repaired") + ", " + nClean + " already clean");
}

await browser.close();
process.exit(exitCode);
