// Read-only: min distance (px) from each canvas edge to nearest alpha>=10 pixel,
// plus bbox and location of detached (non-main) opaque components.
//   node edge-dist.mjs <file.png> [more.png ...]
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const files = process.argv.slice(2);
if (!files.length) { console.error("usage: node edge-dist.mjs <file.png> ..."); process.exit(1); }

const HTML = `<!DOCTYPE html><html><body><canvas id="c"></canvas><script>
window.scan = async (b64) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "data:image/png;base64," + b64; });
  const c = document.getElementById("c");
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, c.width, c.height).data;
  const W = c.width, H = c.height, N = W * H;
  const at = (x, y) => (y * W + x) * 4;
  let top = Infinity, bottom = Infinity, left = Infinity, right = Infinity;
  const seen = new Uint8Array(N);
  const comps = [];
  for (let s = 0; s < N; s++) {
    if (seen[s] || px[s * 4 + 3] < 10) continue;
    let n = 0, x1 = W, x2 = 0, y1 = H, y2 = 0, sr = 0, sg = 0, sb = 0;
    const stack = [s]; seen[s] = 1;
    while (stack.length) {
      const p = stack.pop(); n++;
      const x = p % W, y = (p / W) | 0;
      sr += px[at(x, y)]; sg += px[at(x, y) + 1]; sb += px[at(x, y) + 2];
      if (x < x1) x1 = x; if (x > x2) x2 = x;
      if (y < y1) y1 = y; if (y > y2) y2 = y;
      if (y < top) top = y; if (y > bottom) bottom = y;
      if (x < left) left = x; if (x > right) right = x;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const q = ny * W + nx;
        if (!seen[q] && px[q * 4 + 3] >= 10) { seen[q] = 1; stack.push(q); }
      }
    }
    comps.push({ n, x1, y1, x2, y2, avg: [Math.round(sr / n), Math.round(sg / n), Math.round(sb / n)] });
  }
  comps.sort((a, b) => b.n - a.n);
  return {
    top, bottom: H - 1 - bottom, left, right: W - 1 - right,
    bbox: comps.length ? \`x \${Math.min(...comps.map(c => c.x1))}-\${Math.max(...comps.map(c => c.x2))}, y \${Math.min(...comps.map(c => c.y1))}-\${Math.max(...comps.map(c => c.y2))}\` : "none",
    detached: comps.slice(1).map(c => \`n=\${c.n} bbox x\${c.x1}-\${c.x2},y\${c.y1}-\${c.y2} avg rgb(\${c.avg.join(",")})\`),
  };
};
</script></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(HTML);
for (const f of files) {
  const r = await page.evaluate(async (b64) => window.scan(b64), readFileSync(f).toString("base64"));
  console.log("== " + f.split("/").pop() + "  edge-clear  top:" + r.top + " bottom:" + r.bottom + " left:" + r.left + " right:" + r.right + "   content-bbox " + r.bbox);
  for (const d of r.detached) console.log("   detached: " + d);
}
await browser.close();
