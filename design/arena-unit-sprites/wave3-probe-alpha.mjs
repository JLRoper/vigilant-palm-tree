// Probe: component analysis at two alpha thresholds for a file + region dump.
//   node wave3-probe-alpha.mjs <file.png> [strongAlpha=100]
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const file = process.argv[2];
const STRONG = Number(process.argv[3] ?? 100);
const HTML = `<!DOCTYPE html><html><body><canvas id="c"></canvas><script>
window.scan = async (b64, strong) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "data:image/png;base64," + b64; });
  const c = document.getElementById("c");
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, c.width, c.height).data;
  const W = c.width, H = c.height, N = W * H;
  const comps = (thr) => {
    const seen = new Uint8Array(N);
    const out = [];
    for (let s = 0; s < N; s++) {
      if (seen[s] || px[s * 4 + 3] < thr) continue;
      let n = 0;
      const stack = [s]; seen[s] = 1;
      while (stack.length) {
        const p = stack.pop(); n++;
        const x = p % W, y = (p / W) | 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const q = ny * W + nx;
          if (!seen[q] && px[q * 4 + 3] >= thr) { seen[q] = 1; stack.push(q); }
        }
      }
      out.push(n);
    }
    out.sort((a, b) => b - a);
    return { count: out.length, top: out.slice(0, 6), small: out.slice(1).filter(n => n <= 500).length };
  };
  const semi = { a1_9: 0, a10_99: 0, a100_249: 0 };
  for (let i = 3; i < px.length; i += 4) {
    const a = px[i];
    if (a >= 1 && a <= 9) semi.a1_9++;
    else if (a >= 10 && a <= 99) semi.a10_99++;
    else if (a >= 100 && a <= 249) semi.a100_249++;
  }
  return { weak: comps(10), strong: comps(strong), semi };
};
</script></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(HTML);
const r = await page.evaluate(async ([b64, strong]) => window.scan(b64, strong), [readFileSync(file).toString("base64"), STRONG]);
console.log(`${file}`);
console.log(`  weak(a>=10):   comps=${r.weak.count} top=[${r.weak.top}] small(<=500px)=${r.weak.small}`);
console.log(`  strong(a>=${STRONG}): comps=${r.strong.count} top=[${r.strong.top}] small(<=500px)=${r.strong.small}`);
console.log(`  semi px: a1-9=${r.semi.a1_9} a10-99=${r.semi.a10_99} a100-249=${r.semi.a100_249}`);
await browser.close();
