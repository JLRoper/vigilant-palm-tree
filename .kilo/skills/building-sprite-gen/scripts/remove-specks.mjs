// Remove isolated background specks (surviving checkerboard islands, stray
// dark/white pixels) from a sprite PNG. An opaque connected component is
// deleted only if it does NOT belong to the main sprite component, is small,
// and is low-saturation (whitish/grayish/blackish) — colored details such as
// gold flecks always survive, as does anything touching the main art.
//
// Usage:
//   node tools/sprites/remove-specks.mjs <file.png> [more.png ...]

import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";

const files = process.argv.slice(2);
if (!files.length) { console.error("usage: node remove-specks.mjs <file.png> ..."); process.exit(1); }

const MAX_SPECK_PX = 600;
const MIN_SPREAD = 40;

const HTML = `<!DOCTYPE html><html><body><canvas id="c"></canvas><script>
window.clean = async (b64) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "data:image/png;base64," + b64; });
  const c = document.getElementById("c");
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const px = data.data, W = c.width, H = c.height;
  const N = W * H;
  const opaque = new Uint8Array(N);
  for (let p = 0; p < N; p++) if (px[p * 4 + 3] >= 10) opaque[p] = 1;

  const comp = new Int32Array(N).fill(-1);
  const stats = [];
  const stack = [];
  for (let s = 0; s < N; s++) {
    if (!opaque[s] || comp[s] !== -1) continue;
    const id = stats.length;
    let size = 0, sr = 0, sg = 0, sb = 0;
    comp[s] = id;
    stack.length = 0; stack.push(s);
    while (stack.length) {
      const p = stack.pop();
      size++;
      sr += px[p * 4]; sg += px[p * 4 + 1]; sb += px[p * 4 + 2];
      const x = p % W, y = (p / W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const q = ny * W + nx;
        if (!opaque[q] || comp[q] !== -1) continue;
        comp[q] = id; stack.push(q);
      }
    }
    stats.push({ size, sr, sg, sb });
  }
  let mainId = 0;
  for (let i = 1; i < stats.length; i++) if (stats[i].size > stats[mainId].size) mainId = i;

  let removedPx = 0;
  for (let p = 0; p < N; p++) {
    const id = comp[p];
    if (id === -1 || id === mainId) continue;
    const st = stats[id];
    if (st.size > ${MAX_SPECK_PX}) continue;
    const r = st.sr / st.size, g = st.sg / st.size, b = st.sb / st.size;
    if (Math.max(r, g, b) - Math.min(r, g, b) >= ${MIN_SPREAD}) continue;
    px[p * 4 + 3] = 0;
    removedPx++;
  }
  ctx.putImageData(data, 0, 0);
  return { url: c.toDataURL("image/png"), removedPx, components: stats.length, mainSize: stats[mainId].size };
};
</script></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(HTML);

for (const file of files) {
  const buf = readFileSync(file);
  const r = await page.evaluate(async (b64) => window.clean(b64), buf.toString("base64"));
  writeFileSync(file, Buffer.from(r.url.split("base64,")[1], "base64"));
  console.log(`${file}: removed ${r.removedPx} speck px (sprite component: ${r.mainSize} px, ${r.components} components total)`);
}

await browser.close();
