// Erase every opaque connected component EXCEPT the largest one (design-wave QA helper).
//   node keep-main.mjs <file.png>
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const file = process.argv[2];
if (!file) { console.error("usage: node keep-main.mjs <file.png>"); process.exit(1); }

const HTML = `<!DOCTYPE html><html><body><canvas id="c"></canvas><script>
window.run = async (b64) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "data:image/png;base64," + b64; });
  const c = document.getElementById("c");
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, c.width, c.height).data;
  const W = c.width, H = c.height, N = W * H;
  const seen = new Uint8Array(N);
  const comps = [];
  for (let s = 0; s < N; s++) {
    if (seen[s] || px[s * 4 + 3] < 10) continue;
    let n = 0;
    const stack = [s]; seen[s] = 1; const pixels = [];
    while (stack.length) {
      const p = stack.pop(); n++; pixels.push(p);
      const x = p % W, y = (p / W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const q = ny * W + nx;
        if (!seen[q] && px[q * 4 + 3] >= 10) { seen[q] = 1; stack.push(q); }
      }
    }
    comps.push({ n, pixels });
  }
  comps.sort((a, b) => b.n - a.n);
  let erased = 0;
  const bboxes = [];
  for (let i = 1; i < comps.length; i++) {
    for (const p of comps[i].pixels) { px[p * 4 + 3] = 0; erased++; }
    const xs = comps[i].pixels.map(q => q % W), ys = comps[i].pixels.map(q => (q / W) | 0);
    bboxes.push(\`n=\${comps[i].n} x \${Math.min(...xs)}-\${Math.max(...xs)} y \${Math.min(...ys)}-\${Math.max(...ys)}\`);
  }
  ctx.putImageData(ctx.getImageData(0, 0, W, H), 0, 0);
  return { url: c.toDataURL("image/png"), comps: comps.length, erased, bboxes };
};
</script></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(HTML);
const buf = readFileSync(file);
const r = await page.evaluate(async (b64) => window.run(b64), buf.toString("base64"));
writeFileSync(file, Buffer.from(r.url.split("base64,")[1], "base64"));
console.log(`${file}: ${r.comps} comps, kept main, erased ${r.erased} px in ${r.comps - 1} fragment(s)`);
for (const b of r.bboxes) console.log(`  ${b}`);
await browser.close();
