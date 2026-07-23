// Outline preview tool. Applies a thick black silhouette outline to a single
// resource icon and writes a side-by-side comparison PNG (original | outlined)
// to the temp dir so the user can review before we batch-apply.
//
// Usage:
//   node tools/sprites/outline-apply.mjs <name-without-ext> [thicknessPx]
//
// Example:
//   node tools/sprites/outline-apply.mjs resource-gold-illust 2

import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const resDir = path.join(repoRoot, "src", "resources");
const tmpDir = path.join(process.env.TEMP || process.env.TMPDIR || "C:\\Users\\Jacob\\AppData\\Local\\Temp\\kilo", "outline-preview");
mkdirSync(tmpDir, { recursive: true });

const FLUX_STYLES = ["illust", "constellation", "crest"];
const RESOURCES = ["gold", "wood", "stone", "iron", "arcane"];

const args = process.argv.slice(2);
const inPlace = args.includes("--in-place");
const all = args.includes("--all");
const positional = args.filter((a) => !a.startsWith("--"));
const name = positional[0];
const thickness = Math.max(1, parseInt(positional[1] || "2", 10));

let names;
if (all) {
  names = [];
  for (const style of FLUX_STYLES) {
    for (const res of RESOURCES) {
      names.push(`resource-${res}-${style}`);
    }
  }
} else if (name) {
  names = [name];
} else {
  console.error("Usage: node outline-apply.mjs <name-without-ext> [thicknessPx] [--in-place]");
  console.error("       node outline-apply.mjs --all [thicknessPx] [--in-place]");
  process.exit(1);
}

console.log(`outline thickness = ${thickness}px, target = ${inPlace ? "in-place" : "preview dir"}, count = ${names.length}`);

// HTML: load original image, render to 64x64 canvas, apply outline, export.
// Then build a side-by-side comparison canvas (original | outlined, gap=8px)
// and export that too.

const HTML = `<!DOCTYPE html><html><body>
<canvas id="src" width="64" height="64" style="display:none"></canvas>
<canvas id="out" width="64" height="64" style="display:none"></canvas>
<canvas id="cmp" width="136" height="64" style="display:none"></canvas>
<script>
window.applyOutline = async (b64, thickness) => {
  const img = new Image();
  await new Promise((r, j) => { img.onload = r; img.onerror = j; img.src = "data:image/png;base64," + b64; });

  const W = 64, H = 64;
  const src = document.getElementById("src");
  const out = document.getElementById("out");
  const sctx = src.getContext("2d");
  const octx = out.getContext("2d");
  sctx.imageSmoothingEnabled = true;
  octx.imageSmoothingEnabled = true;
  sctx.clearRect(0, 0, W, H);
  sctx.drawImage(img, 0, 0, W, H);

  const srcData = sctx.getImageData(0, 0, W, H);
  const srcPx = srcData.data;

  // Build alpha mask (0..255)
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < mask.length; i++) mask[i] = srcPx[i*4 + 3];

  // Build outline by dilating the original silhouette outward by N pixels,
  // then subtracting the original silhouette. The result = a ring of black pixels
  // around the icon.
  const dilated = new Uint8Array(W * H);
  // Iterative dilation — N passes, each pass expands by 1 px (8-neighbor kernel)
  let current = mask;
  for (let pass = 0; pass < thickness; pass++) {
    const next = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let m = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= H) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= W) continue;
            if (current[yy * W + xx] > 0) { m = 255; break; }
          }
          if (m) break;
        }
        next[y * W + x] = m;
      }
    }
    current = next;
    for (let i = 0; i < W * H; i++) dilated[i] = current[i];
  }

  // Copy src to out, then overlay outline (dilated XOR original) in solid black
  octx.clearRect(0, 0, W, H);
  octx.drawImage(src, 0, 0);
  const outData = octx.getImageData(0, 0, W, H);
  const outPx = outData.data;
  for (let i = 0; i < W * H; i++) {
    if (dilated[i] > 0 && mask[i] === 0) {
      // ring pixel — paint solid black, full opacity
      outPx[i*4]     = 0;
      outPx[i*4 + 1] = 0;
      outPx[i*4 + 2] = 0;
      outPx[i*4 + 3] = 255;
    }
  }
  octx.putImageData(outData, 0, 0);

  // Side-by-side comparison
  const cmp = document.getElementById("cmp");
  const cctx = cmp.getContext("2d");
  cctx.clearRect(0, 0, 136, 64);
  cctx.fillStyle = "#222";
  cctx.fillRect(0, 0, 136, 64);
  cctx.imageSmoothingEnabled = false;
  cctx.drawImage(src, 0, 0);
  cctx.drawImage(out, 72, 0);

  return {
    outlined: out.toDataURL("image/png"),
    compare:  cmp.toDataURL("image/png"),
  };
};
</script></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 200, height: 100 } });
await page.setContent(HTML);

const fs = await import("node:fs");

function decode(dataUrl, outPath) {
  const payload = dataUrl.slice("data:image/png;base64,".length);
  writeFileSync(outPath, Buffer.from(payload, "base64"));
}

for (const n of names) {
  const srcPath = path.join(resDir, n + ".png");
  if (!fs.existsSync(srcPath)) {
    console.warn(`[skip] ${n} (file not found)`);
    continue;
  }
  const raw = fs.readFileSync(srcPath);
  const b64 = raw.toString("base64");
  const result = await page.evaluate(
    ([b, t]) => window.applyOutline(b, t),
    [b64, thickness],
  );
  if (inPlace) {
    decode(result.outlined, srcPath);
    console.log(`[in-place] ${n}`);
  } else {
    decode(result.outlined, path.join(tmpDir, `${n}-outlined-t${thickness}.png`));
    decode(result.compare,  path.join(tmpDir, `${n}-compare-t${thickness}.png`));
    console.log(`[preview]  ${n}`);
  }
}

await browser.close();
console.log("done.");
