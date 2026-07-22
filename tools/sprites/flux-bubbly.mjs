// Iso-bubbly regen — FLUX generates 5 bubbly cartoon pixel-art iso piles,
// then downscales to 64x64 and applies 2px black outline (consistent with
// other FLUX styles). Prompts emphasize simplified rounded shapes.

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
    name: "resource-gold-pile-bubbly.png",
    prompt: "Single isolated bubbly cartoon pixel-art style isometric pile of simplified rounded golden coins in a cute mound, viewed from 3/4 angle showing top and side faces, thick black outlines, flat saturated colors, fantasy game resource icon, isolated on pure white background, centered, no shadows, no text, 2D pixel art illustration",
  },
  {
    name: "resource-wood-pile-bubbly.png",
    prompt: "Single isolated bubbly cartoon pixel-art style isometric stack of simplified rounded wooden logs in a cute pyramid pile, viewed from 3/4 angle showing top and side faces, thick black outlines, flat saturated colors, fantasy game resource icon, isolated on pure white background, centered, no shadows, no text, 2D pixel art illustration",
  },
  {
    name: "resource-stone-pile-bubbly.png",
    prompt: "Single isolated bubbly cartoon pixel-art style isometric pile of simplified rounded gray stone boulders in a cute mound, viewed from 3/4 angle showing top and side faces, thick black outlines, flat saturated colors, fantasy game resource icon, isolated on pure white background, centered, no shadows, no text, 2D pixel art illustration",
  },
  {
    name: "resource-iron-pile-bubbly.png",
    prompt: "Single isolated bubbly cartoon pixel-art style isometric pile of simplified rounded dark iron ingots in a cute mound, viewed from 3/4 angle showing top and side faces, thick black outlines, flat saturated colors, fantasy game resource icon, isolated on pure white background, centered, no shadows, no text, 2D pixel art illustration",
  },
  {
    name: "resource-arcane-pile-bubbly.png",
    prompt: "Single isolated bubbly cartoon pixel-art style isometric pile of simplified rounded purple arcane crystals in a cute glowing mound, viewed from 3/4 angle showing top and side faces, thick black outlines, flat saturated colors, fantasy game resource icon, isolated on pure white background, centered, no shadows, no text, 2D pixel art illustration",
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

// Downscale + outline in one pass
const HTML = `<!DOCTYPE html><html><body>
<canvas id="c" width="64" height="64"></canvas>
<script>
window.fix = async (b64) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "data:image/png;base64," + b64; });
  const c = document.getElementById("c");
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.clearRect(0, 0, 64, 64);
  ctx.drawImage(img, 0, 0, 64, 64);
  const data = ctx.getImageData(0, 0, 64, 64);
  const px = data.data;

  // Build alpha mask
  const mask = new Uint8Array(64 * 64);
  for (let i = 0; i < mask.length; i++) mask[i] = px[i*4 + 3];

  // Dilate mask by 2 passes for 2px outline
  let current = mask;
  for (let pass = 0; pass < 2; pass++) {
    const next = new Uint8Array(64 * 64);
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        let m = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= 64) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= 64) continue;
            if (current[yy * 64 + xx] > 0) { m = 255; break; }
          }
          if (m) break;
        }
        next[y * 64 + x] = m;
      }
    }
    current = next;
  }

  // Paint outline (dilated XOR original) as solid black
  for (let i = 0; i < 64 * 64; i++) {
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

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 100, height: 100 } });
await page.setContent(HTML);

let seed = 8000;
for (const job of JOBS) {
  process.stdout.write(`[${job.name}] ... `);
  try {
    const raw = await gen(job.prompt, seed++);
    const b64 = raw.toString("base64");
    const dataUrl = await page.evaluate((b) => window.fix(b), b64);
    const small = Buffer.from(dataUrl.split("base64,")[1], "base64");
    writeFileSync(path.join(outDir, job.name), small);
    console.log(`wrote (${small.length} bytes)`);
  } catch (err) {
    console.error(`FAILED: ${err.message}`);
  }
}

await browser.close();
