// One-off scanner: bounding boxes of connected neutral-light opaque clusters (design artifacts only).
//   node scan-light-px.mjs <file.png> [minRGB=225] [maxChroma=20] [minArea=6]
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const [file, minArg, chromaArg, areaArg] = process.argv.slice(2);
const MIN = minArg ? Number(minArg) : 225;
const CHROMA = chromaArg ? Number(chromaArg) : 20;
const MINAREA = areaArg ? Number(areaArg) : 6;

const HTML = `<!DOCTYPE html><html><body><canvas id="c"></canvas><script>
window.scan = async (b64, MIN, CHROMA, MINAREA) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "data:image/png;base64," + b64; });
  const c = document.getElementById("c");
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, c.width, c.height).data;
  const W = c.width, H = c.height;
  const at = (x, y) => (y * W + x) * 4;
  const match = (x, y) => {
    const i = at(x, y);
    if (px[i + 3] < 100) return false;
    const mn = Math.min(px[i], px[i + 1], px[i + 2]);
    const mx = Math.max(px[i], px[i + 1], px[i + 2]);
    return mn >= MIN && mx - mn <= CHROMA;
  };
  const seen = new Uint8Array(W * H);
  const out = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (seen[y * W + x] || !match(x, y)) continue;
      const stack = [[x, y]];
      seen[y * W + x] = 1;
      let n = 0, x1 = x, x2 = x, y1 = y, y2 = y, sr = 0, sg = 0, sb = 0;
      while (stack.length) {
        const [cx, cy] = stack.pop();
        n++;
        sr += px[at(cx, cy)]; sg += px[at(cx, cy) + 1]; sb += px[at(cx, cy) + 2];
        if (cx < x1) x1 = cx; if (cx > x2) x2 = cx;
        if (cy < y1) y1 = cy; if (cy > y2) y2 = cy;
        for (const [nx, ny] of [[cx-1,cy],[cx+1,cy],[cx,cy-1],[cx,cy+1]]) {
          if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen[ny * W + nx] || !match(nx, ny)) continue;
          seen[ny * W + nx] = 1;
          stack.push([nx, ny]);
        }
      }
      if (n >= MINAREA) out.push({ x1, y1, x2, y2, n, avg: [Math.round(sr/n), Math.round(sg/n), Math.round(sb/n)] });
    }
  }
  out.sort((a, b) => b.n - a.n);
  return out;
};
</script></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(HTML);
const r = await page.evaluate(async ([b64, MIN, CHROMA, MINAREA]) => window.scan(b64, MIN, CHROMA, MINAREA), [readFileSync(file).toString("base64"), MIN, CHROMA, MINAREA]);
for (const c of r) console.log("bbox x " + c.x1 + "-" + c.x2 + ", y " + c.y1 + "-" + c.y2 + "  n=" + c.n + "  avg rgb(" + c.avg + ")");
console.log(r.length + " cluster(s)");
await browser.close();
