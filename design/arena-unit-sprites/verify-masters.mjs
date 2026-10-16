// Read-only pixel audit for the 12 icon masters (design artifact QA, not repo tooling).
// Reports per file: size, opaque %, 2px-border transparency, component stats,
// opaque pixels in the outer 4% frame, checkerboard-gray counts, semi-transparent
// bulk (baked shadow signature), and very-dark opaque clusters near the bottom.
//   node verify-masters.mjs <file.png> [more.png ...]
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const files = process.argv.slice(2);
if (!files.length) { console.error("usage: node verify-masters.mjs <file.png> ..."); process.exit(1); }

const HTML = `<!DOCTYPE html><html><body><canvas id="c"></canvas><script>
window.audit = async (b64) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "data:image/png;base64," + b64; });
  const c = document.getElementById("c");
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, c.width, c.height).data;
  const W = c.width, H = c.height, N = W * H;
  const at = (x, y) => (y * W + x) * 4;
  const lum = (i) => 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
  const r = { W, H, opaque: 0, borderBad: 0, frameOpaque: 0, frameCols: new Map(), semi: 0, darkOpaque: 0, bottomDark: 0, checker: 0 };
  const frame = Math.round(Math.min(W, H) * 0.04);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = at(x, y), a = px[i + 3];
      if (a >= 10) r.opaque++;
      if (a >= 10 && a < 250) r.semi++;
      if ((x < 2 || y < 2 || x >= W - 2 || y >= H - 2) && a >= 10) r.borderBad++;
      if (x < frame || y < frame || x >= W - frame || y >= H - frame) {
        if (a >= 10) {
          r.frameOpaque++;
          const key = (px[i] >> 4) + "," + (px[i + 1] >> 4) + "," + (px[i + 2] >> 4) + "," + (a >> 6);
          r.frameCols.set(key, (r.frameCols.get(key) || 0) + 1);
        }
      }
      if (a >= 250) {
        const l = lum(i);
        if (l < 60) r.darkOpaque++;
        if (y > H * 0.8 && l < 60) r.bottomDark++;
        const mx = Math.max(px[i], px[i + 1], px[i + 2]), mn = Math.min(px[i], px[i + 1], px[i + 2]);
        if (mn >= 190 && mx - mn <= 12 && (mx === 204 || mx === 255 || mx === 221)) r.checker++;
      }
    }
  }
  const seen = new Uint8Array(N);
  const comps = [];
  for (let s = 0; s < N; s++) {
    if (seen[s] || px[s * 4 + 3] < 10) continue;
    const id = comps.length;
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
        if (!seen[q] && px[q * 4 + 3] >= 10) { seen[q] = 1; stack.push(q); }
      }
    }
    comps.push(n);
  }
  comps.sort((a, b) => b - a);
  r.comps = comps.slice(0, 8);
  r.mainShare = comps.length ? (comps[0] / r.opaque) : 0;
  r.frameTop = [...r.frameCols.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
    .map(([k, n]) => { const m = k.split(","); return "rgb~" + m.slice(0, 3).map(v => (+v) << 4) + " a~" + ((+m[3]) << 6) + " x" + n; });
  return r;
};
</script></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(HTML);
for (const f of files) {
  const r = await page.evaluate(async (b64) => window.audit(b64), readFileSync(f).toString("base64"));
  console.log("== " + f);
  console.log(`  size ${r.W}x${r.H}  opaque ${r.opaque} (${(100 * r.opaque / (r.W * r.H)).toFixed(1)}%)  border-px-alpha>=10: ${r.borderBad}`);
  console.log(`  components: ${r.comps.length <= 8 ? r.comps.length : "8+"} shown [${r.comps.join(", ")}]  main-share ${(100 * r.mainShare).toFixed(1)}%`);
  console.log(`  semi-transparent px: ${r.semi}  dark-opaque(lum<60): ${r.darkOpaque}  bottom-20% dark: ${r.bottomDark}  checker-gray: ${r.checker}`);
  console.log(`  outer-4% frame opaque px: ${r.frameOpaque}${r.frameTop.length ? "  top: " + r.frameTop.join(" | ") : ""}`);
}
await browser.close();
