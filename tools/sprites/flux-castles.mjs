// FLUX alternate castle sprite generator.
// Generates 3 alternate isometric castle sprites (one per level) with a
// distinct visual style from the procedural originals.
//
// Usage:
//   $env:DEEPINFRA_API_KEY = "..." ; node tools/sprites/flux-castles.mjs

import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, "..", "..", "src", "resources");
const API = "https://api.deepinfra.com/v1/inference/black-forest-labs/FLUX-2-klein-4b";
const apiKey = process.env.DEEPINFRA_API_KEY;
if (!apiKey) { console.error("DEEPINFRA_API_KEY required"); process.exit(1); }

const JOBS = [
  {
    name: "castle-l1-alt.png",
    w: 96, h: 80,
    prompt: "Single isolated pixel art isometric fantasy small village with two cottages with dark gray slate roofs and cream stone walls, a small well in the center, dirt path in front, viewed from 3/4 angle, dark saturated colors, fills the entire canvas, pixel art style, thick black outlines, isolated on pure white background",
  },
  {
    name: "castle-l2-alt.png",
    w: 112, h: 112,
    prompt: "Single isolated pixel art isometric fantasy fortified town with a circular stone wall, two corner towers with conical red tile roofs, a wooden gate, several houses with dark roofs visible inside, viewed from 3/4 angle, dark saturated colors, fills the entire canvas, pixel art style, thick black outlines, isolated on pure white background",
  },
  {
    name: "castle-l3-alt.png",
    w: 128, h: 160,
    prompt: "Single isolated pixel art isometric fantasy grand stone castle with a tall central keep with blue conical roof and golden banner on top, two large round corner towers with battlements, a curtain wall with crenellations, portcullis gate, viewed from 3/4 angle, dark saturated colors, fills the entire canvas, pixel art style, thick black outlines, isolated on pure white background",
  },
];

async function gen(prompt, seed) {
  const r = await fetch(API, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, width: 1024, height: 1024, safety_tolerance: 2, output_format: "png", seed }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
  const d = await r.json();
  return Buffer.from(d.images[0].split("base64,")[1], "base64");
}

// Downscale + outline pipeline per job dimensions
function buildHtml(w, h) {
  return `<!DOCTYPE html><html><body>
<canvas id="c" width="${w}" height="${h}"></canvas>
<script>
window.fix = async (b64) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "data:image/png;base64," + b64; });
  const c = document.getElementById("c");
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.clearRect(0, 0, ${w}, ${h});
  ctx.drawImage(img, 0, 0, ${w}, ${h});
  const data = ctx.getImageData(0, 0, ${w}, ${h});
  const px = data.data;
  const N = ${w};
  const M = ${h};

  // Build alpha mask
  const mask = new Uint8Array(N * M);
  for (let i = 0; i < mask.length; i++) mask[i] = px[i*4 + 3];

  // Dilate mask by 2 passes for 2px outline
  let current = mask;
  for (let pass = 0; pass < 2; pass++) {
    const next = new Uint8Array(N * M);
    for (let y = 0; y < M; y++) {
      for (let x = 0; x < N; x++) {
        let m = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= M) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= N) continue;
            if (current[yy * N + xx] > 0) { m = 255; break; }
          }
          if (m) break;
        }
        next[y * N + x] = m;
      }
    }
    current = next;
  }

  // Paint outline (dilated XOR original) as solid black
  for (let i = 0; i < N * M; i++) {
    if (current[i] > 0 && mask[i] === 0) {
      px[i*4] = 0; px[i*4+1] = 0; px[i*4+2] = 0; px[i*4+3] = 255;
    }
  }

  // White→transparent for background cleanup
  for (let k = 0; k < px.length; k += 4) {
    const r = px[k], g = px[k+1], b = px[k+2];
    const bright = (r + g + b) / 3;
    if (bright > 235) px[k+3] = 0;
    else if (bright > 200) px[k+3] = Math.round((235 - bright) * 4.6);
  }

  ctx.putImageData(data, 0, 0);
  return c.toDataURL("image/png");
};
</script></body></html>`;
}

const browser = await chromium.launch();
let seed = 12000;
for (const job of JOBS) {
  process.stdout.write(`[${job.name}] `);
  try {
    process.stdout.write("generating... ");
    const raw = await gen(job.prompt, seed++);
    process.stdout.write("process... ");
    const page = await browser.newPage({ viewport: { width: 200, height: 200 } });
    await page.setContent(buildHtml(job.w, job.h));
    const b64 = raw.toString("base64");
    const dataUrl = await page.evaluate((b) => window.fix(b), b64);
    const final = Buffer.from(dataUrl.slice("data:image/png;base64,".length), "base64");
    writeFileSync(path.join(outDir, job.name), final);
    await page.close();
    console.log(`wrote (${final.length} bytes)`);
  } catch (err) {
    console.error(`FAILED: ${err.message}`);
  }
}

await browser.close();
console.log("done.");
