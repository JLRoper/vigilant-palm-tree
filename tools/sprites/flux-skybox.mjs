// FLUX-driven skybox generator for city view backgrounds.
// Generates 3 watercolor-style skyboxes (mountains / plains / riverlands)
// as variants 2-4 alongside the existing base skybox (variant 1).
//
// Reads DEEPINFRA_API_KEY from process.env — never persist it to disk.
//
// Usage:
//   $env:DEEPINFRA_API_KEY = "..." ; node tools/sprites/flux-skybox.mjs
//
// After generation, split layers via:
//   npx tsx scripts/split-skybox-layers.ts

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const outDir = path.join(repoRoot, "src", "resources", "skybox");
mkdirSync(outDir, { recursive: true });

const API = "https://api.deepinfra.com/v1/inference/black-forest-labs/FLUX-2-klein-4b";
const apiKey = process.env.DEEPINFRA_API_KEY;
if (!apiKey) {
  console.error("DEEPINFRA_API_KEY env var is required.");
  process.exit(1);
}

const W = 1024;
const H = 576;

const VARIANTS = {
  mountains: {
    variant: 2,
    prompt: "Wide landscape digital watercolor painting of misty blue mountain peaks at sunrise, layered ridges fading into the distance with atmospheric perspective, soft washes of indigo and slate, delicate brushstrokes with visible paper texture, no buildings or figures, calm serene mood, painterly wet-on-wet technique, white sky gradient at top",
  },
  plains: {
    variant: 3,
    prompt: "Wide landscape digital watercolor painting of rolling green plains and golden fields under soft afternoon light, gentle hills with scattered wildflowers, distant treeline on horizon, visible brushstrokes and watercolor blooms, pastel greens and warm ochre pigments, no buildings or figures, tranquil pastoral scene, painterly wet-on-wet technique",
  },
  riverlands: {
    variant: 4,
    prompt: "Wide landscape digital watercolor painting of winding rivers cutting through fertile green valleys, silver-blue waterways meandering across the scene, marshlands and small lakes dotting the lowlands, soft atmospheric haze, teal and sage green washes, visible granulation and brush bleeding effects, no buildings or figures, serene and lush, painterly technique",
  },
};

async function generateFlux(prompt, seed) {
  const body = {
    prompt,
    width: W,
    height: H,
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

let seed = 4200;

for (const [label, def] of Object.entries(VARIANTS)) {
  const outPath = path.join(outDir, `cityView-background-variant${def.variant}.png`);
  process.stdout.write(`[skybox/${label}] generating (${W}x${H})... `);
  try {
    const raw = await generateFlux(def.prompt, seed++);
    writeFileSync(outPath, raw);
    process.stdout.write(`wrote ${outPath} (${raw.length} bytes)\n`);
  } catch (err) {
    console.error(`FAILED: ${err.message}`);
  }
}

console.log("done.");
