// Strip a baked-in checkerboard "transparent" background from a sprite PNG,
// replacing it with real alpha. Flood-fills from the borders so enclosed
// gray tones (stone chimney, etc.) are untouched.
//
// Usage:
//   node .kilo/skills/building-sprite-gen/scripts/strip-checkerboard.mjs <file.png> [more.png ...]

import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";

const files = process.argv.slice(2);
if (!files.length) { console.error("usage: node strip-checkerboard.mjs <file.png> ..."); process.exit(1); }

const HTML = `<!DOCTYPE html><html><body><canvas id="c"></canvas><script>
window.fix = async (b64) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "data:image/png;base64," + b64; });
  const c = document.getElementById("c");
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const px = data.data, W = c.width, H = c.height;

  const at = (x, y) => (y * W + x) * 4;
  const dist = (i, r, g, b) => Math.hypot(px[i] - r, px[i + 1] - g, px[i + 2] - b);

  let colA = [144, 146, 145];
  for (let x = 0; x < W; x++) {
    const i = at(x, 0);
    if (px[i + 3] > 10) { colA = [px[i], px[i + 1], px[i + 2]]; break; }
  }
  let colB = null;
  for (let x = 1; x < W; x++) {
    const i = at(x, 0);
    if (px[i + 3] > 10 && Math.abs(px[i] - colA[0]) + Math.abs(px[i + 1] - colA[1]) + Math.abs(px[i + 2] - colA[2]) > 20) {
      colB = [px[i], px[i + 1], px[i + 2]]; break;
    }
  }
  const isBg = (i) => px[i + 3] < 10 || dist(i, ...colA) < 40 || (colB && dist(i, ...colB) < 40);
  const isGrayish = (i) => {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    return mx - mn < 30 && mn > 25 && mx < 215;
  };

  const bg = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p++) if (px[p * 4 + 3] < 10) bg[p] = 1;
  const stack = [];
  for (let x = 0; x < W; x++) { stack.push(x, (H - 1) * W + x); }
  for (let y = 0; y < H; y++) { stack.push(y * W, y * W + W - 1); }
  while (stack.length) {
    const p = stack.pop();
    if (bg[p]) continue;
    const i = p * 4;
    if (px[i + 3] < 10 || !isBg(i)) continue;
    bg[p] = 1;
    const x = p % W, y = (p / W) | 0;
    if (x > 0) stack.push(p - 1);
    if (x < W - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - W);
    if (y < H - 1) stack.push(p + W);
  }

  for (let pass = 0; pass < 16; pass++) {
    const add = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = y * W + x;
        if (bg[p]) continue;
        const nb = (x > 0 && bg[p - 1]) || (x < W - 1 && bg[p + 1]) || (y > 0 && bg[p - W]) || (y < H - 1 && bg[p + W]);
        if (nb && isGrayish(p * 4)) add.push(p);
      }
    }
    if (!add.length) break;
    for (const p of add) bg[p] = 1;
  }

  let cleared = 0;
  for (let p = 0; p < W * H; p++) {
    if (bg[p]) { px[p * 4 + 3] = 0; cleared++; }
  }
  ctx.putImageData(data, 0, 0);
  return { url: c.toDataURL("image/png"), cleared, total: W * H, colA, colB };
};
</script></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(HTML);

for (const file of files) {
  const buf = readFileSync(file);
  const r = await page.evaluate(async (b64) => window.fix(b64), buf.toString("base64"));
  writeFileSync(file, Buffer.from(r.url.split("base64,")[1], "base64"));
  console.log(`${file}: cleared ${(100 * r.cleared / r.total).toFixed(1)}% (${r.cleared}/${r.total} px) checkerA=[${r.colA}] checkerB=[${r.colB}]`);
}

await browser.close();
