// One-off magic-wand erase: flood from a seed point, erasing the connected
// region of pixels matching a neutrality test, confined to a bounding rect.
//   node wand-erase.mjs <file.png> sx,sy x1,y1,x2,y2 [minLum=50] [maxSpread=14]
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const [file, seedArg, rectArg, minArg, spreadArg] = process.argv.slice(2);
if (!file || !seedArg || !rectArg) { console.error("usage: node wand-erase.mjs <file.png> sx,sy x1,y1,x2,y2 [minLum=50] [maxSpread=14]"); process.exit(1); }
const [sx, sy] = seedArg.split(",").map(Number);
const [x1, y1, x2, y2] = rectArg.split(",").map(Number);
const minLum = minArg ? Number(minArg) : 50;
const maxSpread = spreadArg ? Number(spreadArg) : 14;

const HTML = `<!DOCTYPE html><html><body><canvas id="c"></canvas><script>
window.wand = async (b64, sx, sy, rect, minLum, maxSpread) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "data:image/png;base64," + b64; });
  const c = document.getElementById("c");
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, c.width, c.height).data;
  const W = c.width;
  const at = (x, y) => (y * W + x) * 4;
  const match = (x, y) => {
    const i = at(x, y);
    if (px[i + 3] < 10) return false;
    const mn = Math.min(px[i], px[i + 1], px[i + 2]), mx = Math.max(px[i], px[i + 1], px[i + 2]);
    return mn >= minLum && mx - mn <= maxSpread;
  };
  const inRect = (x, y) => x >= rect[0] && x < rect[2] && y >= rect[1] && y < rect[3];
  if (!match(sx, sy)) return { n: -1 };
  const seen = new Set();
  const stack = [[sx, sy]];
  seen.add(sy * W + sx);
  let n = 0;
  while (stack.length) {
    const [cx, cy] = stack.pop();
    px[at(cx, cy) + 3] = 0; n++;
    for (const [nx, ny] of [[cx-1,cy],[cx+1,cy],[cx,cy-1],[cx,cy+1],[cx-1,cy-1],[cx+1,cy-1],[cx-1,cy+1],[cx+1,cy+1]]) {
      if (!inRect(nx, ny) || seen.has(ny * W + nx) || !match(nx, ny)) continue;
      seen.add(ny * W + nx);
      stack.push([nx, ny]);
    }
  }
  ctx.putImageData(new ImageData(px, c.width, c.height), 0, 0);
  return { url: c.toDataURL("image/png"), n };
};
</script></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(HTML);
const r = await page.evaluate(async ([b64, sx, sy, rect, minLum, maxSpread]) => window.wand(b64, sx, sy, rect, minLum, maxSpread), [readFileSync(file).toString("base64"), sx, sy, [x1, y1, x2, y2], minLum, maxSpread]);
if (r.n === -1) { console.error("seed does not match neutrality test — pick another seed"); process.exit(2); }
writeFileSync(file, Buffer.from(r.url.split("base64,")[1], "base64"));
console.log(file + ": wand-erased " + r.n + " px from seed " + sx + "," + sy);
await browser.close();
