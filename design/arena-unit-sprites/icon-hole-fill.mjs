// One-off enclosed-flaw fill for generated 1024px unit icons (design-review artifacts only).
// For each given rect: (1) transparent components (alpha<10) fully inside the rect are
// filled with the median color of their opaque ring (light ring preferred); (2) opaque
// dark islands (lum<90) fully inside the rect are filled the same way. Fixes erase-hole
// damage and dark mis-inpaints without touching anything outside the rects.
//   node icon-hole-fill.mjs <file.png> x1,y1,x2,y2 [x1,y1,x2,y2 ...]
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const [file, ...rectArgs] = process.argv.slice(2);
if (!file || rectArgs.length === 0) {
  console.error("usage: node icon-hole-fill.mjs <file.png> x1,y1,x2,y2 [...]");
  process.exit(1);
}
const rects = rectArgs.map((s) => {
  const n = s.split(",").map(Number);
  return { r: n.slice(0, 4), lumMax: n.length > 4 ? n[4] : 90 };
});

const HTML = `<!DOCTYPE html><html><body><canvas id="c"></canvas><script>
window.fill = async (b64, rects) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "data:image/png;base64," + b64; });
  const c = document.getElementById("c");
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const px = data.data, W = c.width;
  const at = (x, y) => (y * W + x) * 4;
  const lum = (i) => 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
  const report = [];

  for (const { r: [rx1, ry1, rx2, ry2], lumMax } of rects) {
    const inRect = (x, y) => x >= rx1 && x < rx2 && y >= ry1 && y < ry2;
    const seen = new Uint8Array(W * c.height);
    let filledTotal = 0, comps = 0;

    for (let pass = 0; pass < 200; pass++) {
      const seeds = [];
      for (let y = ry1; y < ry2; y++) {
        for (let x = rx1; x < rx2; x++) {
          const i = at(x, y);
          if (px[i + 3] >= 10) continue;
          let transNb = 0, lightNb = false;
          for (const [nx, ny] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1],[x-1,y-1],[x+1,y-1],[x-1,y+1],[x+1,y+1]]) {
            if (nx < 0 || ny < 0 || nx >= W || ny >= c.height || !inRect(nx, ny)) { transNb += 2; continue; }
            const j = at(nx, ny);
            if (px[j + 3] < 10) transNb++;
            else if (lum(j) > 110) lightNb = true;
          }
          if (lightNb && transNb <= 6) seeds.push([x, y]);
        }
      }
      if (!seeds.length) break;
      const ringCols = [];
      for (const [sx, sy] of seeds) {
        for (const [nx, ny] of [[sx-1,sy],[sx+1,sy],[sx,sy-1],[sx,sy+1],[sx-1,sy-1],[sx+1,sy-1],[sx-1,sy+1],[sx+1,sy+1]]) {
          if (nx < 0 || ny < 0 || nx >= W || ny >= c.height || !inRect(nx, ny)) continue;
          const j = at(nx, ny);
          if (px[j + 3] >= 10) ringCols.push([px[j], px[j + 1], px[j + 2]]);
        }
      }
      if (!ringCols.length) break;
      const med = (k) => { const s = k.slice().sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
      const col = [med(ringCols.map((r) => r[0])), med(ringCols.map((r) => r[1])), med(ringCols.map((r) => r[2]))];
      for (const [sx, sy] of seeds) {
        const i = at(sx, sy);
        px[i] = col[0]; px[i + 1] = col[1]; px[i + 2] = col[2]; px[i + 3] = 255;
      }
      filledTotal += seeds.length;
    }
    if (filledTotal) { comps++; report.push(\`rect \${rx1},\${ry1}: pocket-sealed \${filledTotal}px\`); }

    for (const mode of ["transparent", "dark"]) {
      const match = (x, y) => {
        const i = at(x, y);
        return mode === "transparent" ? px[i + 3] < 10 : px[i + 3] >= 10 && lum(i) < lumMax;
      };
      for (let y = ry1; y < ry2; y++) {
        for (let x = rx1; x < rx2; x++) {
          if (seen[y * W + x] || !match(x, y)) continue;
          const stack = [[x, y]];
          seen[y * W + x] = 1;
          const comp = [];
          let touchesEdge = false;
          while (stack.length) {
            const [cx, cy] = stack.pop();
            comp.push([cx, cy]);
            for (const [nx, ny] of [[cx-1,cy],[cx+1,cy],[cx,cy-1],[cx,cy+1],[cx-1,cy-1],[cx+1,cy-1],[cx-1,cy+1],[cx+1,cy+1]]) {
              if (nx < 0 || ny < 0 || nx >= W || ny >= c.height) { touchesEdge = true; continue; }
              if (!inRect(nx, ny)) { touchesEdge = true; continue; }
              if (seen[ny * W + nx] || !match(nx, ny)) continue;
              seen[ny * W + nx] = 1;
              stack.push([nx, ny]);
            }
          }
          if (touchesEdge || comp.length < 12) continue;
          const ring = [];
          for (const [cx, cy] of comp) {
            for (const [nx, ny] of [[cx-1,cy],[cx+1,cy],[cx,cy-1],[cx,cy+1],[cx-1,cy-1],[cx+1,cy-1],[cx-1,cy+1],[cx+1,cy+1]]) {
              if (nx < 0 || ny < 0 || nx >= W || ny >= c.height || !inRect(nx, ny)) continue;
              if (match(nx, ny)) continue;
              const j = at(nx, ny);
              if (px[j + 3] >= 10) ring.push([px[j], px[j + 1], px[j + 2], lum(j)]);
            }
          }
          if (!ring.length) continue;
          const lit = ring.filter((r) => r[3] > lumMax + 40);
          const src = lit.length >= ring.length * 0.25 ? lit : ring;
          const med = (k) => { const s = k.slice().sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
          const col = [med(src.map((r) => r[0])), med(src.map((r) => r[1])), med(src.map((r) => r[2]))];
          for (const [cx, cy] of comp) {
            const i = at(cx, cy);
            px[i] = col[0]; px[i + 1] = col[1]; px[i + 2] = col[2]; px[i + 3] = 255;
          }
          filledTotal += comp.length; comps++;
          report.push(\`rect \${rx1},\${ry1}: filled \${mode} comp of \${comp.length}px with rgb(\${col})\`);
        }
      }
    }
    if (!comps) report.push(\`rect \${rx1},\${ry1}: nothing filled\`);
  }
  ctx.putImageData(data, 0, 0);
  return { url: c.toDataURL("image/png"), report };
};
</script></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(HTML);
const buf = readFileSync(file);
const r = await page.evaluate(async ([b64, r2]) => window.fill(b64, r2), [buf.toString("base64"), rects]);
writeFileSync(file, Buffer.from(r.url.split("base64,")[1], "base64"));
for (const line of r.report) console.log(line);
await browser.close();
