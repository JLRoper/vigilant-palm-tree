// Probe: dimensions + 4-corner alpha + coverage buckets for sprite files.
//   node ashen-probe-alpha.mjs <file.png> [more.png ...]
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const files = process.argv.slice(2);
if (!files.length) { console.error("usage: node ashen-probe-alpha.mjs <file.png> ..."); process.exit(1); }

const HTML = `<!DOCTYPE html><html><body><canvas id="c"></canvas><script>
window.scan = async (b64) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "data:image/png;base64," + b64; });
  const c = document.getElementById("c");
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, c.width, c.height).data;
  const W = c.width, H = c.height;
  const corners = [0, W - 1, (H - 1) * W, H * W - 1].map(i => px[i * 4 + 3]);
  let opaque = 0, partial = 0;
  for (let i = 3; i < px.length; i += 4) {
    if (px[i] === 0) continue;
    if (px[i] < 255) partial++;
    else opaque++;
  }
  return { w: W, h: H, corners, opaquePct: (100 * opaque / (W * H)).toFixed(1), partialPct: (100 * partial / (W * H)).toFixed(2) };
};
</script></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(HTML);
for (const f of files) {
  const r = await page.evaluate(async (b64) => window.scan(b64), readFileSync(f).toString("base64"));
  const bg = r.corners.every(a => a === 0) ? "corners-transparent" : `CORNERS=[${r.corners}]`;
  console.log(`${f}: ${r.w}x${r.h} ${bg} opaque=${r.opaquePct}% partial=${r.partialPct}%`);
}
await browser.close();
