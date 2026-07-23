// Isometric-pile regen — 5 FLUX illustrations of realistic resource piles,
// viewed from a 3/4 isometric angle. Downscale to 64x64 with the same
// soft-alpha pipeline as flux-gen.mjs.

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
    name: "resource-gold-pile.png",
    prompt: "Single isolated isometric pile of shiny golden coins stacked into a small mound, viewed from 3/4 angle showing top and side faces, fantasy game resource icon, isolated on pure white background, centered, no shadows on background, no text, 2D illustration with thick black ink outlines and high contrast saturated palette",
  },
  {
    name: "resource-wood-pile.png",
    prompt: "Single isolated isometric stack of cut wooden logs stacked into a small pyramid pile, viewed from 3/4 angle showing top and side faces, brown bark and pale wood end-grain visible, fantasy game resource icon, isolated on pure white background, centered, no shadows on background, no text, 2D illustration with thick black ink outlines and high contrast saturated palette",
  },
  {
    name: "resource-stone-pile.png",
    prompt: "Single isolated isometric pile of rough gray stone boulders and rock chunks stacked into a small mound, viewed from 3/4 angle showing top and side faces, fantasy game resource icon, isolated on pure white background, centered, no shadows on background, no text, 2D illustration with thick black ink outlines and high contrast saturated palette",
  },
  {
    name: "resource-iron-pile.png",
    prompt: "Single isolated isometric pile of dark iron ingots and rough iron ore chunks stacked into a small mound, viewed from 3/4 angle showing top and side faces, fantasy game resource icon, isolated on pure white background, centered, no shadows on background, no text, 2D illustration with thick black ink outlines and high contrast saturated palette",
  },
  {
    name: "resource-arcane-pile.png",
    prompt: "Single isolated isometric pile of glowing purple arcane crystals and magical gems stacked into a small mound emitting soft violet light, viewed from 3/4 angle showing top and side faces, fantasy game resource icon, isolated on pure white background, centered, no shadows on background, no text, 2D illustration with thick black ink outlines and high contrast saturated palette",
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

const HTML = `<!DOCTYPE html><html><body>
<canvas id="c" width="64" height="64"></canvas>
<script>
window.fix = async (b) => {
  const i = new Image();
  await new Promise((res, rej) => { i.onload = res; i.onerror = rej; i.src = "data:image/png;base64," + b; });
  const c = document.getElementById("c");
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.clearRect(0, 0, 64, 64);
  ctx.drawImage(i, 0, 0, 64, 64);
  const data = ctx.getImageData(0, 0, 64, 64);
  const p = data.data;
  for (let k = 0; k < p.length; k += 4) {
    const r = p[k], g = p[k+1], b = p[k+2];
    const bright = (r + g + b) / 3;
    if (bright > 235) p[k+3] = 0;
    else if (bright > 200) p[k+3] = Math.round((235 - bright) * 4.6);
    else p[k+3] = 255;
  }
  ctx.putImageData(data, 0, 0);
  return c.toDataURL("image/png");
};
</script></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 100, height: 100 } });
await page.setContent(HTML);

let seed = 7000;
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
