// Read-only region crop/zoom export for design QA (writes zoomed crop to stdout path arg).
//   node crop.mjs <file.png> <x1,y1,x2,y2> <out.png> [zoom=2] [checker=1]
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const [file, rectArg, out, zoomArg, checkerArg] = process.argv.slice(2);
if (!file || !rectArg || !out) { console.error("usage: node crop.mjs <file.png> <x1,y1,x2,y2> <out.png> [zoom=2] [checker=1]"); process.exit(1); }
const rect = rectArg.split(",").map(Number);
const zoom = zoomArg ? Number(zoomArg) : 2;
const checker = checkerArg === "0" ? false : true;

const HTML = `<!DOCTYPE html><html><body><canvas id="c"></canvas><script>
window.crop = async (b64, rect, zoom, checker) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "data:image/png;base64," + b64; });
  const [x1, y1, x2, y2] = rect;
  const w = x2 - x1, h = y2 - y1;
  const c = document.getElementById("c");
  c.width = w * zoom; c.height = h * zoom;
  const ctx = c.getContext("2d");
  if (checker) {
    const s = 8;
    for (let y = 0; y < c.height; y += s) for (let x = 0; x < c.width; x += s) {
      ctx.fillStyle = ((x / s + y / s) % 2) ? "#cccccc" : "#ffffff";
      ctx.fillRect(x, y, s, s);
    }
  }
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, x1, y1, w, h, 0, 0, w * zoom, h * zoom);
  return c.toDataURL("image/png");
};
</script></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(HTML);
const url = await page.evaluate(async ([b64, rect, zoom, checker]) => window.crop(b64, rect, zoom, checker), [readFileSync(file).toString("base64"), rect, zoom, checker]);
writeFileSync(out, Buffer.from(url.split("base64,")[1], "base64"));
console.log("wrote " + out);
await browser.close();
