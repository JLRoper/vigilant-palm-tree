// One-off surgical erase for icon masters (design artifact QA, not repo tooling).
// Mode "neutral": inside each rect, erase opaque pixels that are NEUTRAL gray
//   (channel spread <= maxSpread) and light (min channel >= minLum) — targets
//   desaturated inpaint smudges without touching blue-tinted armor or colored art.
// Mode "all": erase every opaque pixel inside each rect (for isolated debris).
//   node fix-erase.mjs <file.png> neutral <minLum> <maxSpread> x1,y1,x2,y2 [more rects]
//   node fix-erase.mjs <file.png> all x1,y1,x2,y2 [more rects]
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const [file, mode, ...rest] = process.argv.slice(2);
if (!file || !mode) { console.error("usage: see header"); process.exit(1); }
let minLum = 0, maxSpread = 0, rectArgs;
if (mode === "neutral") { minLum = Number(rest[0]); maxSpread = Number(rest[1]); rectArgs = rest.slice(2); }
else rectArgs = rest;
const rects = rectArgs.map((s) => s.split(",").map(Number));

const HTML = `<!DOCTYPE html><html><body><canvas id="c"></canvas><script>
window.erase = async (b64, mode, minLum, maxSpread, rects) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "data:image/png;base64," + b64; });
  const c = document.getElementById("c");
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, c.width, c.height).data;
  const W = c.width;
  let n = 0;
  for (const [x1, y1, x2, y2] of rects) {
    for (let y = y1; y < y2; y++) for (let x = x1; x < x2; x++) {
      const i = (y * W + x) * 4;
      if (px[i + 3] < 10) continue;
      if (mode === "neutral") {
        const mn = Math.min(px[i], px[i + 1], px[i + 2]), mx = Math.max(px[i], px[i + 1], px[i + 2]);
        if (mn < minLum || mx - mn > maxSpread) continue;
      }
      px[i + 3] = 0; n++;
    }
  }
  ctx.putImageData(ctx.getImageData(0, 0, c.width, c.height), 0, 0);
  ctx.putImageData(new ImageData(px, c.width, c.height), 0, 0);
  return { url: c.toDataURL("image/png"), n };
};
</script></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(HTML);
const r = await page.evaluate(async ([b64, mode, minLum, maxSpread, rects]) => window.erase(b64, mode, minLum, maxSpread, rects), [readFileSync(file).toString("base64"), mode, minLum, maxSpread, rects]);
writeFileSync(file, Buffer.from(r.url.split("base64,")[1], "base64"));
console.log(file + ": erased " + r.n + " px (" + mode + ")");
await browser.close();
