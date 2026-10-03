import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const files = process.argv.slice(2);
const HTML = `<!DOCTYPE html><html><body><canvas id="c"></canvas><script>
window.probe = async (b64) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "data:image/png;base64," + b64; });
  const c = document.getElementById("c");
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, c.width, c.height).data;
  const W = c.width, H = c.height, N = W * H;
  const sel = new Uint8Array(N);
  for (let p = 0; p < N; p++) {
    if (px[p * 4 + 3] < 100) continue;
    const r = px[p * 4], g = px[p * 4 + 1], b = px[p * 4 + 2];
    const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
    if (mn >= 195 && mx - mn <= 32) sel[p] = 1;
  }
  const comp = new Int32Array(N).fill(-1);
  const out = [];
  const stack = [];
  for (let s = 0; s < N; s++) {
    if (!sel[s] || comp[s] !== -1) continue;
    const id = out.length;
    let size = 0, minx = W, maxx = 0, miny = H, maxy = 0, seed = s;
    comp[s] = id; stack.length = 0; stack.push(s);
    while (stack.length) {
      const p = stack.pop(); size++;
      const x = p % W, y = (p / W) | 0;
      if (x < minx) minx = x; if (x > maxx) maxx = x;
      if (y < miny) miny = y; if (y > maxy) maxy = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const q = ny * W + nx;
        if (sel[q] && comp[q] === -1) { comp[q] = id; stack.push(q); }
      }
    }
    if (size >= 300) out.push({ size, minx, maxx, miny, maxy, seed: [seed % W, (seed / W) | 0] });
  }
  return out;
};
</script></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(HTML);
for (const f of files) {
  const comps = await page.evaluate(async (b64) => window.probe(b64), readFileSync(f).toString("base64"));
  console.log(f);
  for (const k of comps.sort((a, b) => b.size - a.size).slice(0, 8)) {
    console.log(`  size=${k.size} bbox=(${k.minx},${k.miny})-(${k.maxx},${k.maxy}) seed=(${k.seed[0]},${k.seed[1]})`);
  }
}
await browser.close();
