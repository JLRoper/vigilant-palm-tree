// Single-tone background strip for sprites painted on a uniform solid background.
//
//   node tools/sprites/strip-solid-bg.mjs <in.png> <out.png> [floodTol=16] [haloTol=30]
//
// Background: the town-hall L2/L3 wave (design/building-pixel-townhall-l2-l3-wave).
// Why not the stock strippers on these outputs: strip-checker-any clusters the
// BORDER tones, and when the lot touches the canvas edge the sprite's own dark
// outline becomes a cluster -- its halo pass then eats every dark pixel adjacent
// to transparency, cutting 1-2px see-through seams under roof eaves. The repo's
// strip-checkerboard.mjs seeds the tone correctly but its halo pass removes any
// "grayish" pixel adjacent to background for 16 passes, which erodes a slate
// roof. These model outputs paint one uniform light-gray field (measured
// 190-226, +-1 noise across every candidate), so the precise pass is a flood
// fill from the border over ONE tone, plus a tight halo, and nothing else.
import { readFileSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";

const [, , inFile, outFile, floodArg, haloArg] = process.argv;
if (!inFile || !outFile) {
  console.error("usage: node strip-bg.mjs <in.png> <out.png> [floodTol] [haloTol]");
  process.exit(1);
}
const FLOOD = Number(floodArg ?? 16);
const HALO = Number(haloArg ?? 30);

const png = PNG.sync.read(readFileSync(inFile));
const { width: W, height: H, data } = png;
const at = (x, y) => (y * W + x) * 4;
const dist = (i, r, g, b) => Math.hypot(data[i] - r, data[i + 1] - g, data[i + 2] - b);

// modal border tone
const buckets = new Map();
const sample = (x, y) => {
  const i = at(x, y);
  if (data[i + 3] < 200) return;
  const k = `${data[i] >> 3},${data[i + 1] >> 3},${data[i + 2] >> 3}`;
  const b = buckets.get(k) ?? { n: 0, r: 0, g: 0, b: 0 };
  b.n++; b.r += data[i]; b.g += data[i + 1]; b.b += data[i + 2];
  buckets.set(k, b);
};
for (let x = 0; x < W; x++) { sample(x, 0); sample(x, H - 1); }
for (let y = 0; y < H; y++) { sample(0, y); sample(W - 1, y); }
const top = [...buckets.values()].sort((a, b) => b.n - a.n)[0];
const T = [top.r / top.n, top.g / top.n, top.b / top.n];
const total = top.n;
const otherPct = 100 * (1 - total / [...buckets.values()].reduce((s, b) => s + b.n, 0));
// The sprite's own lot can touch the canvas' bottom edge (the grid-exact lot
// runs to the last row), so a border sample always contains some sprite pixels.
// The modal bucket still wins by a wide margin on these outputs; only a REAL
// two-tone checker would split the border roughly in half, which is the case
// worth refusing.
if (otherPct > 45) {
  console.error(`strip-bg: border is NOT dominated by one tone (${otherPct.toFixed(0)}% of border pixels differ from it) - use a checkerboard stripper instead`);
  process.exit(2);
}
if (otherPct > 10) console.error(`strip-bg: note - ${otherPct.toFixed(0)}% of border pixels differ from the modal tone (sprite touching the edge); stripping the modal tone only`);

const bg = new Uint8Array(W * H);
const stack = [];
const push = (x, y) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const p = y * W + x;
  if (bg[p] || dist(p * 4, ...T) > FLOOD) return;
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
// tight halo: only pixels adjacent to cleared background AND close to the tone
for (let pass = 0; pass < 2; pass++) {
  const add = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (bg[p]) continue;
      const nb = (x > 0 && bg[p - 1]) || (x < W - 1 && bg[p + 1]) || (y > 0 && bg[p - W]) || (y < H - 1 && bg[p + W]);
      if (nb && dist(p * 4, ...T) <= HALO) add.push(p);
    }
  }
  if (!add.length) break;
  for (const p of add) bg[p] = 1;
}
let cleared = 0;
for (let p = 0; p < W * H; p++) if (bg[p]) { data[p * 4 + 3] = 0; cleared++; }
writeFileSync(outFile, PNG.sync.write(png));
console.log(`strip-bg: cleared ${(100 * cleared / (W * H)).toFixed(1)}% (tone ${T.map(Math.round).join(",")}, flood<=${FLOOD}, halo<=${HALO}) -> ${outFile}`);
