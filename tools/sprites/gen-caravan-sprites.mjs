// Directional caravan art pipeline: FLUX-2-klein (image-in -> image-out) via
// DeepInfra redraws the existing supply wagon / treasury cart from eight compass
// headings, then one browser pass trims, alpha-cleans and downscales all eight
// masters by a SINGLE shared scale so the sprite never pops size when it turns.
//
// Output: src/resources/caravans/<kind>-<direction>.png (256px, bottom-anchored)
// Masters: design/caravan-directions/masters/<kind>-<direction>.png (1024px)
//
// Usage:
//   $env:DEEPINFRA_API_KEY = "..." ; node tools/sprites/gen-caravan-sprites.mjs [flags]
//
// Flags:
//   --kind supply|treasury|both   which family to work on (default: both)
//   --faces e,se,...              subset of directions (default: all eight)
//   --masters-only                generate masters, skip downscaling
//   --process-only                re-process saved masters, no API calls
//   --dry-run                     print the plan, no API call
//   --help                        show this text

import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const designDir = path.join(repoRoot, "design", "caravan-directions", "masters");
const outDir = path.join(repoRoot, "src", "resources", "caravans");
const API = "https://api.deepinfra.com/v1/inference/black-forest-labs/FLUX-2-klein-4b";
const MODEL = "black-forest-labs/FLUX-2-klein-4b";
const MASTER = 1024;
const OUT = 256;

const DIRECTIONS = ["e", "se", "s", "sw", "w", "nw", "n", "ne"];

const FACING = {
  e: "facing EAST, moving toward the right edge of the image, full side view with the horse to the right of the cart",
  se: "facing SOUTH-EAST, moving toward the bottom-right corner, front three-quarter view with the horse ahead of the cart",
  s: "facing SOUTH, moving toward the viewer, front view showing the horse's head and chest with the cart behind it",
  sw: "facing SOUTH-WEST, moving toward the bottom-left corner, front three-quarter view with the horse ahead of the cart",
  w: "facing WEST, moving toward the left edge of the image, full side view with the horse to the left of the cart",
  nw: "facing NORTH-WEST, moving toward the top-left corner, rear three-quarter view with the horse ahead of the cart, walking away from the viewer",
  n: "facing NORTH, moving away from the viewer, rear view showing the back of the cart with the horse's tail beyond it",
  ne: "facing NORTH-EAST, moving toward the top-right corner, rear three-quarter view with the horse ahead of the cart, walking away from the viewer",
};

const KINDS = {
  supply: {
    ref: path.join(repoRoot, "src", "resources", "caravan-supply.png"),
    subject:
      "a large four-wheeled medieval cargo wagon drawn by one brown draft horse, wooden plank bed loaded with crates, barrels, sacks and rolled timber, a canvas tarp over the front cargo, plain iron-rimmed wooden wheels",
    seed: 4242,
  },
  treasury: {
    ref: path.join(repoRoot, "src", "resources", "caravan-treasury.png"),
    subject:
      "a compact two-wheeled medieval treasure cart drawn by one pale grey horse, an open reinforced strongbox body overflowing with gold coins, a small locked chest and gold bars, brass-banded dark oak planks, a small red banner on a corner post",
    seed: 5151,
  },
};

function promptFor(kind, direction) {
  const k = KINDS[kind];
  return [
    `Redraw the exact same ${k.subject} from the attached reference image, in the same chunky hand-pixeled fantasy game art style, the same warm palette, the same thick dark-brown outlines, the same cargo and the same proportions.`,
    `The vehicle and its horse are ${FACING[direction]}.`,
    "Keep it a single centred sprite in the same 3/4 top-down isometric game perspective, the horse harnessed in front of the cart, all cargo still aboard.",
    "Background: one plain uniform solid light gray (#e8e8e8) everywhere, absolutely no checkerboard, no ground shadow, no floor, no scenery.",
    "Square pixels, no anti-aliasing, no soft gradients, no text, no watermark, nothing cropped at the canvas edges.",
  ].join("\n");
}

function parseArgs(argv) {
  const flags = { kind: "both", faces: DIRECTIONS, mastersOnly: false, processOnly: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") flags.help = true;
    else if (a === "--kind") flags.kind = argv[++i];
    else if (a === "--faces") flags.faces = argv[++i].split(",").map((f) => f.trim()).filter(Boolean);
    else if (a === "--masters-only") flags.mastersOnly = true;
    else if (a === "--process-only") flags.processOnly = true;
    else if (a === "--dry-run") flags.dryRun = true;
    else throw new Error(`Unexpected argument: ${a}`);
  }
  if (!["supply", "treasury", "both"].includes(flags.kind)) throw new Error("--kind must be supply, treasury or both");
  for (const f of flags.faces) {
    if (!DIRECTIONS.includes(f)) throw new Error(`unknown direction ${f}`);
  }
  return flags;
}

async function generateMaster(kind, direction) {
  const apiKey = process.env.DEEPINFRA_API_KEY;
  if (!apiKey) throw new Error("DEEPINFRA_API_KEY is required");
  const refDataUrl = `data:image/png;base64,${readFileSync(KINDS[kind].ref).toString("base64")}`;
  const r = await fetch(API, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: promptFor(kind, direction),
      image: refDataUrl,
      width: MASTER,
      height: MASTER,
      output_format: "png",
      safety_tolerance: 2,
      seed: KINDS[kind].seed,
    }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
  const data = await r.json();
  const img = data.images?.[0] ?? data.data?.[0]?.b64_json;
  if (!img) throw new Error(`No image in response: ${JSON.stringify(data).slice(0, 400)}`);
  return Buffer.from(img.split("base64,").pop(), "base64");
}

const PROCESS_IN_BROWSER = `(() => {
  const { images, cell, bottomPad, sidePad } = window.__caravanProcess;
  return Promise.all(images.map((dataUrl) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w = img.width;
      const h = img.height;
      const src = document.createElement("canvas");
      src.width = w;
      src.height = h;
      const sctx = src.getContext("2d");
      sctx.drawImage(img, 0, 0);
      const imageData = sctx.getImageData(0, 0, w, h);
      const px = imageData.data;
      // Background and any baked-in ground shadow are both flat, low-saturation
      // grays reachable from the border. Flood from the edges only, so pale grey
      // art enclosed by dark outlines (the treasury horse) survives.
      const seen = new Uint8Array(w * h);
      const stack = [];
      for (let x = 0; x < w; x++) { stack.push(x, 0, x, h - 1); }
      for (let y = 0; y < h; y++) { stack.push(0, y, w - 1, y); }
      while (stack.length) {
        const y = stack.pop();
        const x = stack.pop();
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const p = y * w + x;
        if (seen[p]) continue;
        seen[p] = 1;
        const i = p * 4;
        const r = px[i], g = px[i + 1], b = px[i + 2];
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        if (max - min > 16 || max < 100) continue;
        px[i + 3] = 0;
        stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
      }
      sctx.putImageData(imageData, 0, 0);
      let minX = w, minY = h, maxX = -1, maxY = -1;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (px[(y * w + x) * 4 + 3] > 8) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      resolve({ src, minX, minY, maxX, maxY });
    };
    img.onerror = () => reject(new Error("master failed to load"));
    img.src = dataUrl;
  }))).then((cells) => {
    const widest = Math.max(...cells.map((c) => c.maxX - c.minX + 1));
    const tallest = Math.max(...cells.map((c) => c.maxY - c.minY + 1));
    const scale = Math.min((cell - sidePad * 2) / widest, (cell - bottomPad - 2) / tallest, 1);
    const results = cells.map((c) => {
      const out = document.createElement("canvas");
      out.width = cell;
      out.height = cell;
      const octx = out.getContext("2d");
      octx.imageSmoothingEnabled = false;
      const dw = Math.round((c.maxX - c.minX + 1) * scale);
      const dh = Math.round((c.maxY - c.minY + 1) * scale);
      const dx = Math.round((cell - dw) / 2);
      const dy = Math.round(cell - bottomPad - dh);
      octx.drawImage(c.src, c.minX, c.minY, c.maxX - c.minX + 1, c.maxY - c.minY + 1, dx, dy, dw, dh);
      return { dataUrl: out.toDataURL("image/png"), bbox: [c.maxX - c.minX + 1, c.maxY - c.minY + 1] };
    });
    return { scale, results };
  });
})()`;

async function processMasters(kind, faces) {
  const dataUrls = faces.map(
    (f) => `data:image/png;base64,${readFileSync(path.join(designDir, `${kind}-${f}.png`)).toString("base64")}`,
  );
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent("<html><body></body></html>");
    const payload = await page.evaluate(
      ({ expr, images, cell }) => {
        window.__caravanProcess = { images, cell, bottomPad: 4, sidePad: 4 };
        return eval(expr);
      },
      { expr: PROCESS_IN_BROWSER, images: dataUrls, cell: OUT },
    );
    mkdirSync(outDir, { recursive: true });
    payload.results.forEach((result, idx) => {
      const file = path.join(outDir, `${kind}-${faces[idx]}.png`);
      writeFileSync(file, Buffer.from(result.dataUrl.split("base64,")[1], "base64"));
    });
    return { scale: payload.scale, bboxes: payload.results.map((r) => r.bbox) };
  } finally {
    await browser.close();
  }
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(0, 23).join("\n"));
    return;
  }
  const kinds = flags.kind === "both" ? ["supply", "treasury"] : [flags.kind];
  mkdirSync(designDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });

  for (const kind of kinds) {
    if (!flags.processOnly) {
      for (const face of flags.faces) {
        if (flags.dryRun) {
          console.log(`would generate ${kind}-${face} from ${KINDS[kind].ref}: ${promptFor(kind, face).slice(0, 70)}...`);
          continue;
        }
        const master = path.join(designDir, `${kind}-${face}.png`);
        console.log(`Generating ${kind} ${face} ...`);
        const buf = await generateMaster(kind, face);
        writeFileSync(master, buf);
        console.log(`  wrote ${master} (${(buf.length / 1024).toFixed(0)} KB)`);
      }
    }
    if (!flags.mastersOnly) {
      const missing = flags.faces.filter((f) => !existsSync(path.join(designDir, `${kind}-${f}.png`)));
      if (missing.length > 0) throw new Error(`missing masters for ${kind}: ${missing.join(", ")}`);
      const processed = await processMasters(kind, flags.faces);
      console.log(`  processed ${flags.faces.length} ${kind} sprites at shared scale ${processed.scale.toFixed(3)}`);
    }
  }
}

main().catch((err) => {
  console.error(err?.stack ?? err);
  process.exit(1);
});
