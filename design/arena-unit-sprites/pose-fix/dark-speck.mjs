// Erase dark opaque pixels whose 8-neighborhood is mostly light (design-wave QA helper).
// Targets checker/noise specks trapped inside a light-colored sprite body while
// sparing the dark outline (outline pixels have dark neighbors).
//   node dark-speck.mjs <file.png> <maxDarkChannel> <minLightChannel> <minLightNeighborsOf8>
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const [file, darkArg, lightArg, nbArg] = process.argv.slice(2);
if (!file || !darkArg) { console.error("usage: node dark-speck.mjs <file.png> <maxDarkChannel> <minLightChannel> <minLightNeighborsOf8>"); process.exit(1); }
const maxDark = Number(darkArg), minLight = Number(lightArg ?? 140), minNb = Number(nbArg ?? 5);

const HTML = `<!DOCTYPE html><html><body><canvas id="c"></canvas><script>
window.run = async (b64, maxDark, minLight, minNb) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "data:image/png;base64," + b64; });
  const c = document.getElementById("c");
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, c.width, c.height).data;
  const W = c.width, H = c.height;
  const at = (x, y) => (y * W + x) * 4;
  const isDark = (x, y) => { const i = at(x, y); return px[i + 3] >= 10 && Math.max(px[i], px[i + 1], px[i + 2]) <= maxDark; };
  const isLight = (x, y) => { const i = at(x, y); return px[i + 3] >= 10 && Math.min(px[i], px[i + 1], px[i + 2]) >= minLight; };
  const kill = [];
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    if (!isDark(x, y)) continue;
    let nb = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      if (isLight(x + dx, y + dy)) nb++;
    }
    if (nb >= minNb) kill.push(at(x, y));
  }
  for (const i of kill) px[i + 3] = 0;
  ctx.putImageData(ctx.getImageData(0, 0, W, H), 0, 0);
  return { url: c.toDataURL("image/png"), n: kill.length };
};
</script></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(HTML);
const buf = readFileSync(file);
const r = await page.evaluate(async ([b64, a, b, c2]) => window.run(b64, a, b, c2), [buf.toString("base64"), maxDark, minLight, minNb]);
writeFileSync(file, Buffer.from(r.url.split("base64,")[1], "base64"));
console.log(`${file}: erased ${r.n} dark speck px`);
await browser.close();
