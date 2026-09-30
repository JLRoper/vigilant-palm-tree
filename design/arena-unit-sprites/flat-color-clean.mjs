// One-off artifact cleanup for arena unit sprite samples (not part of the repo tooling).
// Mode A: erase every pixel within tolerance of one exact flat color (for flat-color
//         backgrounds whose enclosed pockets the border flood-fill strip cannot reach).
//           node flat-color-clean.mjs <file.png> <r,g,b> [tol=16]
// Mode B: erase enclosed, uniform, near-white opaque components (>=80 px, not touching
//         the border, >=98% of pixels within 6 of the component median) — white
//         background pockets that survive as opaque slivers inside the silhouette.
//           node flat-color-clean.mjs <file.png> --enclosed-white
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const [file, modeArg, colorArg, tolArg] = process.argv.slice(2);
if (!file || !modeArg) {
  console.error("usage: node flat-color-clean.mjs <file.png> <r,g,b> [tol] | <file.png> --enclosed-white");
  process.exit(1);
}
const tol = tolArg ? Number(tolArg) : 16;

const HTML = `<!DOCTYPE html><html><body><canvas id="c"></canvas><script>
window.clean = async (b64, mode, rgb, tol, rect) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "data:image/png;base64," + b64; });
  const c = document.getElementById("c");
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const px = data.data, W = c.width, H = c.height;
  const at = (x, y) => (y * W + x) * 4;
  const cleared = [];

  if (mode === "inspect") {
    const counts = new Map();
    for (let y = rgb[1]; y < rgb[3]; y++) {
      for (let x = rgb[0]; x < rgb[2]; x++) {
        const i = at(x, y);
        const key = \`a\${px[i + 3] >> 4} r\${px[i] >> 3} g\${px[i + 1] >> 3} b\${px[i + 2] >> 3}\`;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([k, n]) => {
        const m = k.match(/a([0-9]+) r([0-9]+) g([0-9]+) b([0-9]+)/);
        return \`rgba(\${(+m[2]) << 3},\${(+m[3]) << 3},\${(+m[4]) << 3},a~\${(+m[1]) << 4}) x\${n}\`;
      });
    return { cleared: top.map(t => ({ label: t, n: 0 })), url: null };
  }

  if (mode === "rectflat") {
    let n = 0;
    for (let y = rect[1]; y < rect[3]; y++) {
      for (let x = rect[0]; x < rect[2]; x++) {
        const i = at(x, y);
        if (px[i + 3] < 10) continue;
        if (Math.hypot(px[i] - rgb[0], px[i + 1] - rgb[1], px[i + 2] - rgb[2]) < tol) { px[i + 3] = 0; n++; }
      }
    }
    cleared.push({ label: "rect flat-color px", n });
    ctx.putImageData(data, 0, 0);
    return { url: c.toDataURL("image/png"), cleared };
  }

  if (mode === "rect") {
    let n = 0;
    for (let y = rgb[1]; y < rgb[3]; y++) {
      for (let x = rgb[0]; x < rgb[2]; x++) {
        const i = at(x, y);
        if (px[i + 3] > 10 && px[i] >= 245 && px[i + 1] >= 245 && px[i + 2] >= 245) { px[i + 3] = 0; n++; }
      }
    }
    cleared.push({ label: "rect near-white px", n });
    ctx.putImageData(data, 0, 0);
    return { url: c.toDataURL("image/png"), cleared };
  }

  if (mode === "flat") {
    let n = 0;
    for (let p = 0; p < W * H; p++) {
      const i = p * 4;
      if (px[i + 3] < 10) continue;
      if (Math.hypot(px[i] - rgb[0], px[i + 1] - rgb[1], px[i + 2] - rgb[2]) < tol) { px[i + 3] = 0; n++; }
    }
    cleared.push({ label: "flat-color px", n });
    ctx.putImageData(data, 0, 0);
    return { url: c.toDataURL("image/png"), cleared };
  }

  const nearWhite = (i) => px[i] >= 245 && px[i + 1] >= 245 && px[i + 2] >= 245 && px[i + 3] > 10;
  const comp = new Int32Array(W * H).fill(-1);
  const comps = [];
  for (let p = 0; p < W * H; p++) {
    if (comp[p] !== -1 || !nearWhite(p * 4)) continue;
    const id = comps.length;
    const pixels = [];
    const stack = [p];
    comp[p] = id;
    let touchesBorder = false;
    while (stack.length) {
      const q = stack.pop();
      pixels.push(q);
      const x = q % W, y = (q / W) | 0;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) touchesBorder = true;
      const nb = [];
      if (x > 0) nb.push(q - 1);
      if (x < W - 1) nb.push(q + 1);
      if (y > 0) nb.push(q - W);
      if (y < H - 1) nb.push(q + W);
      for (const t of nb) if (comp[t] === -1 && nearWhite(t * 4)) { comp[t] = id; stack.push(t); }
    }
    comps.push({ pixels, touchesBorder });
  }
  for (const cpt of comps) {
    if (cpt.touchesBorder || cpt.pixels.length < 80) continue;
    const rs = cpt.pixels.map(q => px[q * 4]).sort((a, b) => a - b);
    const gs = cpt.pixels.map(q => px[q * 4 + 1]).sort((a, b) => a - b);
    const bs = cpt.pixels.map(q => px[q * 4 + 2]).sort((a, b) => a - b);
    const med = k => {
      const m = k.length >> 1;
      return k.length % 2 ? k[m] : (k[m - 1] + k[m]) / 2;
    };
    const mr = med(rs), mg = med(gs), mb = med(bs);
    let uniform = 0;
    for (const q of cpt.pixels) {
      if (Math.abs(px[q * 4] - mr) <= 6 && Math.abs(px[q * 4 + 1] - mg) <= 6 && Math.abs(px[q * 4 + 2] - mb) <= 6) uniform++;
    }
    if (uniform / cpt.pixels.length < 0.98) continue;
    for (const q of cpt.pixels) px[q * 4 + 3] = 0;
    const xs = cpt.pixels.map(q => q % W), ys = cpt.pixels.map(q => (q / W) | 0);
    cleared.push({
      label: "enclosed white component",
      n: cpt.pixels.length,
      bbox: \`x \${Math.min(...xs)}-\${Math.max(...xs)}, y \${Math.min(...ys)}-\${Math.max(...ys)}\`,
    });
  }
  ctx.putImageData(data, 0, 0);
  return { url: c.toDataURL("image/png"), cleared };
};
</script></body></html>`;

const flag = ["--enclosed-white", "--inspect", "--rect-white", "--rect-flat"].find(f => modeArg === f || colorArg === f);
const mode = flag === "--enclosed-white" ? "enclosed" : flag === "--inspect" ? "inspect" : flag === "--rect-white" ? "rect" : flag === "--rect-flat" ? "rectflat" : "flat";
const colorSrc = modeArg === flag ? colorArg : modeArg;
const rect = process.argv.slice(6, 10).map(Number);
const rgb = mode === "flat" || mode === "rectflat" ? colorSrc.split(",").map(Number) : mode === "inspect" || mode === "rect" ? [colorArg, tolArg, process.argv[6], process.argv[7]].map(Number) : null;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(HTML);
const buf = readFileSync(file);
const r = await page.evaluate(async ([b64, m, rgb2, tol2, rect2]) => window.clean(b64, m, rgb2, tol2, rect2), [buf.toString("base64"), mode, rgb, tol, rect]);
if (r.url) writeFileSync(file, Buffer.from(r.url.split("base64,")[1], "base64"));
if (mode === "inspect") { console.log(`${file} inspect:`); for (const t of r.cleared) console.log(`  ${t.label}`); }
for (const entry of r.cleared) {
  console.log(`${file}: erased ${entry.n} px (${entry.label}${entry.bbox ? `; ${entry.bbox}` : ""})`);
}
if (!r.cleared.length) console.log(`${file}: nothing erased`);
await browser.close();
