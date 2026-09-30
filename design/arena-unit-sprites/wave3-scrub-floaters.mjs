// Wave 3 floater scrub: erase every opaque-or-semi component (alpha >= 10) that
// is NOT the main sprite and is smaller than CAP px. Unlike remove-specks.mjs
// this makes no saturation/opacity distinction, so semi-transparent checker
// remnants die too. Only safe on single-connected-figure masters (all wave-3
// subjects are). Idempotent; re-encodes via canvas.
//   node wave3-scrub-floaters.mjs <file.png> [capPx=2000]
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const file = process.argv[2];
const CAP = Number(process.argv[3] ?? 2000);
if (!file) { console.error("usage: node wave3-scrub-floaters.mjs <file.png> [capPx=2000]"); process.exit(1); }

const HTML = `<!DOCTYPE html><html><body><canvas id="c"></canvas><script>
window.scrub = async (b64, cap) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "data:image/png;base64," + b64; });
  const c = document.getElementById("c");
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const px = data.data, W = c.width, H = c.height, N = W * H;
  const seen = new Uint8Array(N);
  const comps = [];
  for (let s = 0; s < N; s++) {
    if (seen[s] || px[s * 4 + 3] < 10) continue;
    const id = comps.length;
    const cells = [];
    const stack = [s]; seen[s] = 1;
    while (stack.length) {
      const p = stack.pop(); cells.push(p);
      const x = p % W, y = (p / W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const q = ny * W + nx;
        if (!seen[q] && px[q * 4 + 3] >= 10) { seen[q] = 1; stack.push(q); }
      }
    }
    comps.push(cells);
  }
  comps.sort((a, b) => b.length - a.length);
  let killed = 0, islands = 0;
  for (let i = 1; i < comps.length; i++) {
    if (comps[i].length > cap) { islands++; continue; }
    for (const p of comps[i]) { px[p * 4 + 3] = 0; killed++; }
  }
  ctx.putImageData(data, 0, 0);
  return { url: c.toDataURL("image/png"), killed, islands, comps: comps.length, main: comps.length ? comps[0].length : 0 };
};
</script></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(HTML);
const buf = readFileSync(file);
const r = await page.evaluate(async ([b64, cap]) => window.scrub(b64, cap), [buf.toString("base64"), CAP]);
writeFileSync(file, Buffer.from(r.url.split("base64,")[1], "base64"));
console.log(`${file}: killed ${r.killed} px in floaters, kept ${r.islands} big island(s), comps=${r.comps} main=${r.main}px`);
await browser.close();
