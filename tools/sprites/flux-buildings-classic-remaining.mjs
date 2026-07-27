// FLUX isometric building sprite generator - remaining classic buildings.
// Generates the 8 missing classic-style buildings not yet covered.
//
// Usage:
//   $env:DEEPINFRA_API_KEY = "..." ; node tools/sprites/flux-buildings-classic-remaining.mjs

import { chromium } from "playwright";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, "..", "..", "src", "resources");
const API = "https://api.deepinfra.com/v1/inference/black-forest-labs/FLUX-2-klein-4b";
const apiKey = process.env.DEEPINFRA_API_KEY;
if (!apiKey) { console.error("DEEPINFRA_API_KEY required"); process.exit(1); }

const JOBS = [
  {
    name: "building-classic-mageGuild-1.png",
    prompt: "Single isolated pixel art isometric fantasy mage guild building with grey stone walls and dark blue roof, tall pointed spire with glowing crystal orb at top, arched stained-glass windows in blue and purple, runic symbols above grand wooden door, viewed from 3/4 angle, dark saturated colors, fills the entire canvas, pixel art, black outlines"
  },
  {
    name: "building-classic-mine-1.png",
    prompt: "Single isolated pixel art isometric fantasy mine entrance built into rocky hillside, dark tunnel opening framed by heavy wooden support beams, minecart on rails outside filled with glittering ore chunks, lantern hanging from beam, grey stone and brown earth tones, viewed from 3/4 angle, dark saturated colors, fills the entire canvas, pixel art, black outlines"
  },
  {
    name: "building-classic-market-1.png",
    prompt: "Single isolated pixel art isometric fantasy marketplace with two striped red-and-yellow fabric market stalls, wooden countertops with barrels and crates of goods displayed, hanging scale above counter, cobblestone base with small stone well, viewed from 3/4 angle, dark saturated colors, fills the entire canvas, pixel art, black outlines"
  },
  {
    name: "building-classic-barracks-1.png",
    prompt: "Single isolated pixel art isometric fantasy barracks building, long rectangular military hall with dark timber-framed walls and slate roof, small training yard with wooden training dummies, weapon rack with swords and shields on outer wall, blue banner hanging above main entrance, arrow-slit windows, viewed from 3/4 angle, dark saturated colors, fills the entire canvas, pixel art, black outlines"
  },
  {
    name: "building-classic-smithy-1.png",
    prompt: "Single isolated pixel art isometric fantasy blacksmith smithy workshop, stone-walled forge with large brick chimney billowing grey smoke, glowing orange furnace and anvil visible inside, sword blades and armor pieces hanging from rafters, water barrel outside, dark iron and warm orange glow, viewed from 3/4 angle, dark saturated colors, fills the entire canvas, pixel art, black outlines"
  },
  {
    name: "building-classic-apartment-1.png",
    prompt: "Single isolated pixel art isometric fantasy apartment building, tall narrow three-story urban dwelling with dark timber-framed cream plaster walls, steep pitched red roof with dormer windows, small balconies with iron railings, ground-floor shopfront doorway, viewed from 3/4 angle, dark saturated colors, fills the entire canvas, pixel art, black outlines"
  },
  {
    name: "building-classic-farmField-1.png",
    prompt: "Single isolated pixel art isometric fantasy farm field, rectangular cultivated plot with neat parallel rows of green crops, simple wooden fence bordering two sides, small scarecrow with floppy hat in corner, rich brown soil visible between rows, low stone boundary wall, viewed from 3/4 angle, dark saturated colors, fills the entire canvas, pixel art, black outlines"
  },
  {
    name: "building-classic-farmhouse-1.png",
    prompt: "Single isolated pixel art isometric fantasy farmhouse, small rustic single-story rural home with thatched straw roof, whitewashed stone walls, attached small animal stable with wooden fence, hay bales stacked against wall, chimney with gentle smoke, water trough near stable, viewed from 3/4 angle, dark saturated colors, fills the entire canvas, pixel art, black outlines"
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

  for (let k = 0; k < px.length; k += 4) {
    const r = px[k], g = px[k+1], b = px[k+2];
    const bright = (r + g + b) / 3;
    if (bright > 235) px[k+3] = 0;
    else if (bright > 200) px[k+3] = Math.round((235 - bright) * 4.6);
  }

  ctx.putImageData(data, 0, 0);
  return c.toDataURL("image/png");
};
<\/script></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(HTML);

let seed = 9400;
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
