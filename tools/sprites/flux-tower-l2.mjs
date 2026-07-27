// FLUX isometric building sprite generator - tower level 2.
//
// Usage:
//   $env:DEEPINFRA_API_KEY = "..." ; node tools/sprites/flux-tower-l2.mjs

import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, "..", "..", "src", "resources", "buildings");
const API = "https://api.deepinfra.com/v1/inference/black-forest-labs/FLUX-2-klein-4b";
const apiKey = process.env.DEEPINFRA_API_KEY;
if (!apiKey) { console.error("DEEPINFRA_API_KEY required"); process.exit(1); }

const JOBS = [
  {
    name: "building-classic-tower-2.png",
    prompt: "Single isolated pixel art isometric fantasy tall reinforced guard tower, three stories high with grey stone walls and battlements, wooden hoardings at the top, narrow arrow-slit windows on each floor, large iron-bound wooden door at ground level, red flag banner flying from top spire, defensive fortification style, viewed from 3/4 angle, dark saturated colors, fills the entire canvas, pixel art, black outlines"
  },
];

async function gen(prompt, seed) {
  const r = await fetch(API, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, width: 512, height: 512, safety_tolerance: 2, output_format: "png", seed }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
  const d = await r.json();
  return Buffer.from(d.images[0].split("base64,")[1], "base64");
}

const HTML = `<!DOCTYPE html><html><body>
<canvas id="c" width="128" height="128"></canvas>
<script>
window.fix = async (b64) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "data:image/png;base64," + b64; });
  const c = document.getElementById("c");
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.clearRect(0, 0, 128, 128);
  ctx.drawImage(img, 0, 0, 128, 128);
  const data = ctx.getImageData(0, 0, 128, 128);
  const px = data.data;

  const N = 128;
  const mask = new Uint8Array(N * N);
  for (let i = 0; i < mask.length; i++) mask[i] = px[i*4 + 3];

  let current = mask;
  for (let pass = 0; pass < 2; pass++) {
    const next = new Uint8Array(N * N);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        let m = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= N) continue;
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

  for (let i = 0; i < N * N; i++) {
    if (current[i] > 0 && mask[i] === 0) {
      px[i*4] = 0; px[i*4+1] = 0; px[i*4+2] = 0; px[i*4+3] = 255;
    }
  }

  ctx.putImageData(data, 0, 0);
  return c.toDataURL("image/png");
};
<\/script></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(HTML);

let seed = 9600;
for (const job of JOBS) {
  process.stdout.write(`[${job.name}] `);
  try {
    process.stdout.write("generating... ");
    const raw = await gen(job.prompt, seed++);
    process.stdout.write("process... ");
    const b64 = raw.toString("base64");
    const dataUrl = await page.evaluate((b) => window.fix(b), b64);
    const final = Buffer.from(dataUrl.slice("data:image/png;base64,".length), "base64");
    writeFileSync(path.join(outDir, job.name), final);
    console.log(`wrote (${final.length} bytes)`);
  } catch (err) {
    console.error(`FAILED: ${err.message}`);
  }
}

await browser.close();
console.log("done.");
