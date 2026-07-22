// FLUX-driven generator for 3 new resource-icon styles.
// Calls black-forest-labs/FLUX-2-klein-4b 15 times (5 resources x 3 styles),
// saves raw 1024x1024 PNGs to a temp dir, then uses Playwright to downscale
// each to 32x32 with white-background -> alpha, writing the final transparent
// PNGs into src/resources/.
//
// Read DEEPINFRA_API_KEY from process.env — never persist it to disk.
//
// Usage:
//   $env:DEEPINFRA_API_KEY = "..." ; node tools/sprites/flux-gen.mjs

import { chromium } from "playwright";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const outDir = path.join(repoRoot, "src", "resources");
const tmpDir = path.join(process.env.TEMP || process.env.TMPDIR || "C:\\Users\\Jacob\\AppData\\Local\\Temp\\kilo", "flux-raw");
mkdirSync(tmpDir, { recursive: true });
mkdirSync(outDir, { recursive: true });

const API = "https://api.deepinfra.com/v1/inference/black-forest-labs/FLUX-2-klein-4b";
const apiKey = process.env.DEEPINFRA_API_KEY;
if (!apiKey) {
  console.error("DEEPINFRA_API_KEY env var is required.");
  process.exit(1);
}

// ─── Prompts ────────────────────────────────────────────────────────────────
//
// Style 3: illustrated-pin — high-fidelity version of the procedural
//   cartography-pin set, hand-painted by FLUX.
// Style 4: constellation — star-map medallions (parked direction from
//   docs/art-style.md "Future directions").
// Style 5: heraldic-crest — banner shields with stylized animals (parked
//   direction from docs/art-style.md "Future directions").
//
// All prompts ask for "isolated on pure white background, no shadows,
// no text, 2D illustration" so the post-process step can knock white to
// transparent cleanly.

const STYLES = {
  "illustrated-pin": {
    prefix: "Single isolated old cartography map pin, circular parchment token with hand-drawn woodcut",
    suffix: ", fantasy game resource icon, isolated on pure white background, centered, no shadows on background, no text, top-down view, 2D illustration",
    files: {
      gold:   "resource-gold-illust.png",
      wood:   "resource-wood-illust.png",
      stone:  "resource-stone-illust.png",
      iron:   "resource-iron-illust.png",
      arcane: "resource-arcane-illust.png",
    },
  },
  constellation: {
    prefix: "Single isolated mystical constellation medallion, circular dark navy star-map token showing the",
    suffix: " constellation pattern with glowing connected stars on midnight blue circular field, fantasy game resource icon, isolated on pure white background, centered, no shadows, no text, top-down view, 2D illustration",
    files: {
      gold:   "resource-gold-constellation.png",
      wood:   "resource-wood-constellation.png",
      stone:  "resource-stone-constellation.png",
      iron:   "resource-iron-constellation.png",
      arcane: "resource-arcane-constellation.png",
    },
  },
  "heraldic-crest": {
    prefix: "Single isolated heraldic crest, banner shield with stylized rampant",
    suffix: " medieval fantasy game resource icon, isolated on pure white background, centered, no shadows, no text, front-facing, 2D illustration",
    files: {
      gold:   "resource-gold-crest.png",
      wood:   "resource-wood-crest.png",
      stone:  "resource-stone-crest.png",
      iron:   "resource-iron-crest.png",
      arcane: "resource-arcane-crest.png",
    },
  },
};

// Per-resource symbolism per style
const SYMBOLS = {
  "illustrated-pin": {
    gold:   "gold sun disc with eight radiating rays",
    wood:   "oak leaf with central vein",
    stone:  "snow-capped mountain peak with two smaller peaks",
    iron:   "crossed war hammers",
    arcane: "arcane star with four points and diamond center",
  },
  constellation: {
    gold:   "Leo sun",
    wood:   "tree-of-life forest",
    stone:  "three mountain peaks",
    iron:   "forge anvil and hammer",
    arcane: "scattered arcane stars with magical connections",
  },
  "heraldic-crest": {
    gold:   "golden dragon with spread wings",
    wood:   "forest stag with branched antlers",
    stone:  "mountain ram with curled horns",
    iron:   "iron gray wolf",
    arcane: "amethyst phoenix rising from flames",
  },
};

// ─── FLUX call ─────────────────────────────────────────────────────────────

async function generateFlux(prompt, seed) {
  const body = {
    prompt,
    width: 1024,
    height: 1024,
    safety_tolerance: 2,
    output_format: "png",
    seed,
  };
  const resp = await fetch(API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`FLUX HTTP ${resp.status}: ${text}`);
  }
  const data = await resp.json();
  if (data.error) throw new Error(`FLUX error: ${JSON.stringify(data.error)}`);
  if (!data.images || data.images.length === 0) throw new Error("FLUX returned no images");
  const dataUri = data.images[0];
  const idx = dataUri.indexOf("base64,");
  if (idx < 0) throw new Error("FLUX response is not a base64 data URI");
  return Buffer.from(dataUri.substring(idx + 7), "base64");
}

// ─── Downscale via Playwright ───────────────────────────────────────────────
//
// Strategy: open a single HTML page that exposes a 64x64 canvas. For each
// high-res PNG, load it as an Image, drawImage(canvas, image, 0,0,64,64)
// into the 64x64 canvas, then walk the pixel buffer to convert near-white
// pixels to fully transparent (alpha=0). 64x64 keeps the FLUX detail that
// the 1024→32 downscale was crushing.

const DOWNSCALE_HTML = `<!DOCTYPE html><html><body>
<canvas id="c" width="64" height="64" style="image-rendering:pixelated"></canvas>
<script>
window.loadAndDownscale = async (b64) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "data:image/png;base64," + b64; });
  const c = document.getElementById("c");
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.clearRect(0, 0, 64, 64);
  ctx.drawImage(img, 0, 0, 64, 64);
  const data = ctx.getImageData(0, 0, 64, 64);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], g = px[i+1], b = px[i+2];
    const bright = (r + g + b) / 3;
    if (bright > 235) px[i+3] = 0;
    else if (bright > 200) px[i+3] = Math.round((235 - bright) * 4.6);
    else px[i+3] = 255;
  }
  ctx.putImageData(data, 0, 0);
  return c.toDataURL("image/png");
};
</script></body></html>`;

async function downscaleTo64x64(page, raw1024) {
  const b64 = raw1024.toString("base64");
  const dataUrl = await page.evaluate((b) => window.loadAndDownscale(b), b64);
  return Buffer.from(dataUrl.slice("data:image/png;base64,".length), "base64");
}

// ─── Main ──────────────────────────────────────────────────────────────────

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 100, height: 100 } });
await page.setContent(DOWNSCALE_HTML);

const resources = ["gold", "wood", "stone", "iron", "arcane"];
let seed = 1000;

for (const style of Object.keys(STYLES)) {
  const def = STYLES[style];
  for (const res of resources) {
    const prompt = `${def.prefix} ${SYMBOLS[style][res]}${def.suffix}`;
    process.stdout.write(`[${style}/${res}] generating... `);
    let raw;
    try {
      raw = await generateFlux(prompt, seed++);
    } catch (err) {
      console.error(`FAILED: ${err.message}`);
      continue;
    }
    const tmpPath = path.join(tmpDir, `${style}-${res}.png`);
    writeFileSync(tmpPath, raw);
    process.stdout.write(`1024x1024 saved, downscaling... `);
    try {
      const small = await downscaleTo64x64(page, raw);
      const outPath = path.join(outDir, def.files[res]);
      writeFileSync(outPath, small);
      process.stdout.write(`wrote ${outPath} (${small.length} bytes)\n`);
    } catch (err) {
      console.error(`DOWNSCALE FAILED: ${err.message}`);
    }
  }
}

await browser.close();
console.log("done.");
