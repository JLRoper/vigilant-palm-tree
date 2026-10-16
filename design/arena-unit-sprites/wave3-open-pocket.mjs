// Wave 3 pocket opener: flood a seed point inside an enclosed near-white opaque
// pocket and turn that contiguous region transparent (background the model
// painted white; the border flood-fill in strip-checkerboard can't reach it).
//   node wave3-open-pocket.mjs <file.png> <seedX> <seedY> [minRGB=225] [maxChroma=20]
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const file = process.argv[2];
const SX = Number(process.argv[3]);
const SY = Number(process.argv[4]);
const MIN = Number(process.argv[5] ?? 225);
const CHROMA = Number(process.argv[6] ?? 20);
if (!file || Number.isNaN(SX) || Number.isNaN(SY)) {
  console.error("usage: node wave3-open-pocket.mjs <file.png> <seedX> <seedY> [minRGB=225] [maxChroma=20]");
  process.exit(1);
}

const HTML = `<!DOCTYPE html><html><body><canvas id="c"></canvas><script>
window.open2 = async (b64, sx, sy, min, chroma) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "data:image/png;base64," + b64; });
  const c = document.getElementById("c");
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const px = data.data, W = c.width, H = c.height;
  const ok = (p) => {
    if (px[p * 4 + 3] < 100) return false;
    const r = px[p * 4], g = px[p * 4 + 1], b = px[p * 4 + 2];
    const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
    return mn >= min && mx - mn <= chroma;
  };
  const seed = sy * W + sx;
  if (!ok(seed)) return { killed: 0, seedOk: false };
  const seen = new Uint8Array(W * H);
  const stack = [seed];
  seen[seed] = 1;
  let killed = 0;
  while (stack.length) {
    const p = stack.pop();
    px[p * 4 + 3] = 0;
    killed++;
    const x = p % W, y = (p / W) | 0;
    for (const [nx, ny] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]]) {
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const q = ny * W + nx;
      if (!seen[q] && ok(q)) { seen[q] = 1; stack.push(q); }
    }
  }
  ctx.putImageData(data, 0, 0);
  return { url: c.toDataURL("image/png"), killed, seedOk: true };
};
</script></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(HTML);
const r = await page.evaluate(async ([b64, sx, sy, min, chroma]) => window.open2(b64, sx, sy, min, chroma), [readFileSync(file).toString("base64"), SX, SY, MIN, CHROMA]);
if (!r.seedOk) { console.log(`${file}: seed (${SX},${SY}) is not near-white opaque — nothing opened`); process.exit(1); }
writeFileSync(file, Buffer.from(r.url.split("base64,")[1], "base64"));
console.log(`${file}: opened pocket, ${r.killed} px -> transparent`);
await browser.close();
