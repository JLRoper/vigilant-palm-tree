// Regenerate specific icons with adjusted prompts. Bypasses the full
// STYLES table and just runs the named jobs.
//
// Usage:
//   $env:DEEPINFRA_API_KEY = "..." ; node tools/sprites/flux-regen.mjs

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
    name: "resource-gold-illust.png",
    prompt: "Single isolated old cartography map pin, circular parchment token with bold high-contrast golden sun symbol featuring eight thick radiating rays and a dark central disc, fantasy game resource icon, isolated on pure white background, centered, no shadows, no text, top-down view, 2D illustration with thick black ink outlines",
  },
  {
    name: "resource-wood-illust.png",
    prompt: "Single isolated old cartography map pin, circular parchment token with bold high-contrast dark green oak leaf symbol featuring thick black veins and clear silhouette, fantasy game resource icon, isolated on pure white background, centered, no shadows, no text, top-down view, 2D illustration with thick black ink outlines",
  },
  // Constellation set — deeply saturated dark navy field with high-contrast glowing symbols
  {
    name: "resource-gold-constellation.png",
    prompt: "Single isolated circular dark navy blue constellation medallion with bold bright golden-yellow stars and thick glowing gold lines forming a Leo sun-burst constellation pattern, deep saturated colors, fantasy game resource icon, isolated on pure white background, centered, no shadows, no text, top-down view, 2D illustration, high contrast saturated palette",
  },
  {
    name: "resource-wood-constellation.png",
    prompt: "Single isolated circular dark navy blue constellation medallion with bold bright forest green stars and thick glowing green lines forming a tree-of-life or forest constellation pattern, deep saturated colors, fantasy game resource icon, isolated on pure white background, centered, no shadows, no text, top-down view, 2D illustration, high contrast saturated palette",
  },
  {
    name: "resource-stone-constellation.png",
    prompt: "Single isolated circular dark navy blue constellation medallion with bold bright white and slate gray stars and thick glowing silver lines forming a three mountain peaks constellation pattern, deep saturated colors, fantasy game resource icon, isolated on pure white background, centered, no shadows, no text, top-down view, 2D illustration, high contrast saturated palette",
  },
  {
    name: "resource-iron-constellation.png",
    prompt: "Single isolated circular dark navy blue constellation medallion with bold bright red-orange stars and thick glowing rust-red lines forming an anvil and hammer constellation pattern, deep saturated colors, fantasy game resource icon, isolated on pure white background, centered, no shadows, no text, top-down view, 2D illustration, high contrast saturated palette",
  },
  {
    name: "resource-arcane-constellation.png",
    prompt: "Single isolated circular dark navy blue constellation medallion with bold bright violet-purple stars and thick glowing amethyst lines forming an arcane pentagram or magical star-burst constellation pattern, deep saturated colors, fantasy game resource icon, isolated on pure white background, centered, no shadows, no text, top-down view, 2D illustration, high contrast saturated palette",
  },
  // Heraldic crest set — vivid saturated shields with bold animal silhouettes
  {
    name: "resource-gold-crest.png",
    prompt: "Single isolated heraldic banner shield, vivid saturated golden-yellow shield field with bold thick black ink illustration of a rampant golden dragon with spread wings, fantasy game resource icon, isolated on pure white background, centered, no shadows, no text, front-facing, 2D illustration, high contrast saturated palette",
  },
  {
    name: "resource-wood-crest.png",
    prompt: "Single isolated heraldic banner shield, vivid saturated forest green shield field with bold thick black ink illustration of a rampant forest stag with branched antlers, fantasy game resource icon, isolated on pure white background, centered, no shadows, no text, front-facing, 2D illustration, high contrast saturated palette",
  },
  {
    name: "resource-stone-crest.png",
    prompt: "Single isolated heraldic banner shield, vivid saturated stone gray shield field with bold thick black ink illustration of a rampant mountain ram with curled horns, fantasy game resource icon, isolated on pure white background, centered, no shadows, no text, front-facing, 2D illustration, high contrast saturated palette",
  },
  {
    name: "resource-iron-crest.png",
    prompt: "Single isolated heraldic banner shield, vivid saturated rust-red shield field with bold thick black ink illustration of a rampant iron wolf, fantasy game resource icon, isolated on pure white background, centered, no shadows, no text, front-facing, 2D illustration, high contrast saturated palette",
  },
  {
    name: "resource-arcane-crest.png",
    prompt: "Single isolated heraldic banner shield, vivid saturated amethyst purple shield field with bold thick black ink illustration of a rampant arcane phoenix rising from flames, fantasy game resource icon, isolated on pure white background, centered, no shadows, no text, front-facing, 2D illustration, high contrast saturated palette",
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
    if (bright > 235) p[k+3] = 0;             // pure white -> fully transparent
    else if (bright > 200) p[k+3] = Math.round((235 - bright) * 4.6); // soft edge ramp 0..160
    else p[k+3] = 255;                        // saturated color -> full opacity
  }
  ctx.putImageData(data, 0, 0);
  return c.toDataURL("image/png");
};
</script></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 100, height: 100 } });
await page.setContent(HTML);

let seed = 3000;
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
