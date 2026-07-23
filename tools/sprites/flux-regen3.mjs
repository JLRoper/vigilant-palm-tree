// Final regen pass for the 4 persistent failures.

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
  // arcane-illust: very high contrast, violet star, deep purple ink
  {
    name: "resource-arcane-illust.png",
    prompt: "Single isolated old cartography map pin, circular parchment token with a huge bold violet-purple arcane four-pointed star with thick dark purple ink outline and bright white inner sparkles filling the central disc, fantasy game resource icon, isolated on pure white background, centered, no shadows, no text, top-down view, 2D illustration with thick black ink outlines and maximum contrast",
  },
  // iron-constellation: huge bold hammer silhouette
  {
    name: "resource-iron-constellation.png",
    prompt: "Single isolated circular dark navy blue constellation medallion with one massive bright rust-red hammer head and thick handle dominating the entire medallion, simple iconic hammer silhouette with three small connected bright red sparks, fantasy game resource icon, isolated on pure white background, centered, no shadows, no text, top-down view, 2D illustration, high contrast saturated palette",
  },
  // wood-crest: stag with huge dramatic antlers filling shield
  {
    name: "resource-wood-crest.png",
    prompt: "Single isolated heraldic banner shield, vivid saturated forest green shield field with bold black rampant stag whose massive multi-pronged branching antlers fill the top half of the shield, fantasy game resource icon, isolated on pure white background, centered, no shadows, no text, front-facing, 2D illustration, high contrast saturated palette, dramatic bold antlers",
  },
  // arcane-crest: wyvern (dragon-like, more recognizable than phoenix at small scale)
  {
    name: "resource-arcane-crest.png",
    prompt: "Single isolated heraldic banner shield, vivid saturated amethyst purple shield field with bold black rampant wyvern dragon with spread bat-like wings, long curling tail, open mouth showing fangs, fantasy game resource icon, isolated on pure white background, centered, no shadows, no text, front-facing, 2D illustration, high contrast saturated palette, iconic medieval wyvern",
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
<canvas id="c" width="32" height="32"></canvas>
<script>
window.fix = async (b) => {
  const i = new Image();
  await new Promise((res, rej) => { i.onload = res; i.onerror = rej; i.src = "data:image/png;base64," + b; });
  const c = document.getElementById("c");
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.clearRect(0, 0, 32, 32);
  ctx.drawImage(i, 0, 0, 32, 32);
  const data = ctx.getImageData(0, 0, 32, 32);
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

let seed = 5000;
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
