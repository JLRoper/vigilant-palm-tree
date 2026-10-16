// Probe: sample average color/alpha in small windows of a PNG.
//   node wave3-sample.mjs <file.png> x,y x,y ...
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const file = process.argv[2];
const points = process.argv.slice(3).map((s) => s.split(",").map(Number));
const HTML = `<!DOCTYPE html><html><body><canvas id="c"></canvas><script>
window.sample = async (b64, pts) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "data:image/png;base64," + b64; });
  const c = document.getElementById("c");
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const out = [];
  for (const [x, y] of pts) {
    const d = ctx.getImageData(x - 6, y - 6, 13, 13).data;
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    const hist = {};
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 100) { hist["a" + d[i + 3]] = (hist["a" + d[i + 3]] || 0) + 1; continue; }
      r += d[i]; g += d[i + 1]; b += d[i + 2]; a += d[i + 3]; n++;
    }
    out.push({ x, y, opaque: n, avg: n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : null, alphaHist: hist });
  }
  return out;
};
</script></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(HTML);
const r = await page.evaluate(async ([b64, pts]) => window.sample(b64, pts), [readFileSync(file).toString("base64"), points]);
for (const s of r) console.log(`(${s.x},${s.y}) opaque=${s.opaque}/169 avg=${s.avg ? s.avg.join(",") : "n/a"} alpha-hist=${JSON.stringify(s.alphaHist)}`);
await browser.close();
