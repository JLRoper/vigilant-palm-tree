// Gemini hero-sprite generator via OpenRouter (image-in -> image-out).
//
// Generates a mounted-hero variant's directional sprites (and, with
// --kind banner, its 320x100 roster banner) by repainting an existing hero's
// art, then frames the result exactly like the reference it was given: the
// sprite is keyed to real alpha, trimmed, scaled to the reference's content
// height, and bottom/centre-aligned to the reference's bounding box on the
// game's 512px canvas. That makes a generated variant slot into
// `units/horse/commander-<N>/` with no per-file eyeballing.
//
// The script stores no prompts: every run passes `--prompt`/`--prompt-file`
// plus an explicit `--ref`, so several agents can generate at once without
// editing a shared file.
//
// Usage:
//   node tools/sprites/gemini-hero-sprite.mjs --kind sprite \
//     --id paladin2 --dirs e,se,s,sw,w,nw,ne,n \
//     --ref-dir src/resources/units/horse/commander-4 --ref-prefix paladin \
//     --out-dir src/resources/units/horse/commander-11 \
//     --prompt-file <prompt.txt> [--master-dir design/hero-variants/paladin-2/masters]
//
// Flags:
//   --kind <sprite|banner>  what to generate (default: sprite)
//   --id <id>               variant id used in output file names (required)
//   --dirs <list>           comma list of directions, default n,ne,e,se,s,sw,w,nw
//   --suffix <text>         appended to each output name (e.g. -2 for a run frame)
//   --keep-facing           the reference is already at the target heading: keep it
//                           verbatim instead of re-posing from the nearest cardinal
//   --riderless             the subject has no rider; use mount-only facing wording
//   --subject <noun>        mount noun used by the facing clauses (default: horse),
//                           e.g. --subject dragon for a dragon rider
//   --pose-ref <dir>        heading of the reference image when it is not the
//                           default nearest cardinal (n for diagonals, s for front)
//   --ref <path>            reference PNG (single-direction run, or the banner ref)
//   --ref-dir <dir>         directory holding <ref-prefix>-<dir>.png per direction
//   --ref-prefix <prefix>   file prefix inside --ref-dir (default: the variant id)
//   --out-dir <dir>         sprite output directory (default: the reference's dir)
//   --out <path>            banner output file (default: src/resources/hero-banner-<id>.png)
//   --prompt <text>         the generation prompt inline
//   --prompt-file <path>    read the generation prompt from a UTF-8 text file
//   --model <id>            OpenRouter model (default: google/gemini-3.1-flash-image)
//   --provider-tag <tag>    pin one OpenRouter endpoint tag (default: google-vertex/global)
//   --master-dir <dir>      where the raw model output is kept (default: design/hero-variants/<id>/masters)
//   --size <px>             sprite canvas size (default: 512)
//   --tolerance <n>         background key tolerance in RGB distance (default: 26)
//   --force                 regenerate files that already exist
//   --dry-run               print the plan; no API call, no billing
//   --help                  this text
//
// Post-process notes: the model is asked for a flat light-grey canvas, but a
// blanket colour threshold would eat a white/steel subject, so the key is a
// border flood fill (only background CONNECTED to the canvas edge is removed)
// plus a soft 2px boundary matte. Sprite framing is derived from the reference
// PNG's alpha bounding box, never from the model's own composition.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import sharp from "sharp";

const API = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "google/gemini-3.1-flash-image";
const PROVIDER_TAG = "google-vertex/global";
const ALL_DIRS = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];

function usage() {
  const text = readFileSync(new URL(import.meta.url), "utf8");
  console.log(text.split("\n").slice(0, 40).join("\n"));
}

const argv = process.argv.slice(2);
const flags = {
  kind: "sprite",
  id: null,
  dirs: ALL_DIRS,
  suffix: "",
  keepFacing: false,
  riderless: false,
  subject: "horse",
  poseRef: null,
  ref: null,
  refDir: null,
  refPrefix: null,
  outDir: null,
  out: null,
  prompt: null,
  promptFile: null,
  model: MODEL,
  providerTag: PROVIDER_TAG,
  masterDir: null,
  size: 512,
  tolerance: 26,
  force: false,
  dryRun: false,
};

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--help" || a === "-h") { usage(); process.exit(0); }
  else if (a === "--kind") flags.kind = argv[++i];
  else if (a === "--id") flags.id = argv[++i];
  else if (a === "--dirs") flags.dirs = argv[++i].split(",").map((d) => d.trim()).filter(Boolean);
  else if (a === "--suffix") flags.suffix = argv[++i];
  else if (a === "--keep-facing") flags.keepFacing = true;
  else if (a === "--riderless") flags.riderless = true;
  else if (a === "--subject") flags.subject = argv[++i];
  else if (a === "--pose-ref") flags.poseRef = argv[++i];
  else if (a === "--ref") flags.ref = argv[++i];
  else if (a === "--ref-dir") flags.refDir = argv[++i];
  else if (a === "--ref-prefix") flags.refPrefix = argv[++i];
  else if (a === "--out-dir") flags.outDir = argv[++i];
  else if (a === "--out") flags.out = argv[++i];
  else if (a === "--prompt") flags.prompt = argv[++i];
  else if (a === "--prompt-file") flags.promptFile = argv[++i];
  else if (a === "--model") flags.model = argv[++i];
  else if (a === "--provider-tag") flags.providerTag = argv[++i];
  else if (a === "--master-dir") flags.masterDir = argv[++i];
  else if (a === "--size") flags.size = Number(argv[++i]);
  else if (a === "--tolerance") flags.tolerance = Number(argv[++i]);
  else if (a === "--force") flags.force = true;
  else if (a === "--dry-run") flags.dryRun = true;
  else { console.error(`Unexpected argument: ${a}\n`); usage(); process.exit(1); }
}

if (!flags.id) { console.error("--id is required"); process.exit(1); }
if (flags.prompt && flags.promptFile) { console.error("Use --prompt or --prompt-file, not both"); process.exit(1); }
if (!flags.prompt && !flags.promptFile) { console.error("--prompt or --prompt-file is required (the script stores no prompts)"); process.exit(1); }
const promptTemplate = flags.promptFile
  ? readFileSync(path.resolve(flags.promptFile), "utf8")
  : flags.prompt;

if (flags.kind !== "sprite" && flags.kind !== "banner") {
  console.error(`--kind must be "sprite" or "banner"`);
  process.exit(1);
}
if (flags.kind === "sprite" && !flags.refDir && !flags.ref) {
  console.error("sprite mode needs --ref-dir (per-direction references) or --ref (one reference for every direction)");
  process.exit(1);
}
if (flags.dirs.some((d) => !ALL_DIRS.includes(d))) {
  console.error(`--dirs accepts: ${ALL_DIRS.join(",")}`);
  process.exit(1);
}
if (flags.poseRef && !ALL_DIRS.includes(flags.poseRef)) {
  console.error(`--pose-ref accepts: ${ALL_DIRS.join(",")}`);
  process.exit(1);
}

const masterDir = flags.masterDir
  ? path.resolve(flags.masterDir)
  : path.resolve("design", "hero-variants", flags.id, "masters");
const outDir = flags.outDir
  ? path.resolve(flags.outDir)
  : flags.refDir
    ? path.resolve(flags.refDir)
    : path.resolve("src", "resources", "units", "horse");
const bannerOut = flags.out
  ? path.resolve(flags.out)
  : path.resolve("src", "resources", `hero-banner-${flags.id}.png`);

// Facing instruction per direction. The art is authored in isometric
// presentation, so a diagonal is a three-quarter view of the same figure, not a
// rotated flat sprite.
const FACING = {
  n: "seen from directly behind, the horse and rider heading away from the viewer toward the top of the image (north)",
  ne: "a three-quarter rear-right view, the horse and rider heading toward the top-right corner of the image (northeast), showing the horse's left flank and the rider's back and left shoulder",
  e: "a full right-side profile, the horse and rider heading to the right edge of the image (east)",
  se: "a three-quarter front-right view, the horse and rider heading toward the bottom-right corner of the image (southeast), showing the horse's chest and left flank and the rider's front",
  s: "seen from the front, the horse and rider heading toward the viewer at the bottom of the image (south)",
  sw: "a three-quarter front-left view, the horse and rider heading toward the bottom-left corner of the image (southwest), showing the horse's chest and right flank and the rider's front",
  w: "a full left-side profile, the horse and rider heading to the left edge of the image (west)",
  nw: "a three-quarter rear-left view, the horse and rider heading toward the top-left corner of the image (northwest), showing the horse's right flank and the rider's back and right shoulder",
};

// Riderless mounts (the two unicorns) get their own wording: the shared
// facing text above says "horse and rider", which would invite a rider.
const RIDERLESS_FACING = {
  n: "seen from directly behind, the unicorn heading away from the viewer toward the top of the image (north)",
  ne: "a three-quarter rear-right view, the unicorn heading toward the top-right corner of the image (northeast), showing its left flank and hindquarters",
  e: "a full right-side profile, the unicorn heading to the right edge of the image (east)",
  se: "a three-quarter front-right view, the unicorn heading toward the bottom-right corner of the image (southeast), showing its chest and left flank",
  s: "seen from the front, the unicorn heading toward the viewer at the bottom of the image (south)",
  sw: "a three-quarter front-left view, the unicorn heading toward the bottom-left corner of the image (southwest), showing its chest and right flank",
  w: "a full left-side profile, the unicorn heading to the left edge of the image (west)",
  nw: "a three-quarter rear-left view, the unicorn heading toward the top-left corner of the image (northwest), showing its right flank and hindquarters",
};

function facingFor(dir) {
  if (flags.riderless) return RIDERLESS_FACING[dir];
  const subject = flags.subject;
  return FACING[dir]
    .replaceAll("the horse and rider", `the ${subject} and rider`)
    .replaceAll("the horse's", `the ${subject}'s`);
}

// Diagonal directions repaint the nearest cardinal (a rear view cannot be
// turned into a front view by prompt alone), cardinal directions repaint
// themselves.
const POSE_REFERENCE = { n: "n", ne: "n", e: "e", se: "s", s: "s", sw: "s", w: "w", nw: "n" };

function dirPrompt(dir) {
  const poseRef = flags.poseRef ?? POSE_REFERENCE[dir];
  const facing = facingFor(dir);
  const poseFacing = facingFor(poseRef);
  const turning = flags.keepFacing || poseRef === dir
    ? `Keep the figure facing exactly as in the reference: ${facing}.`
    : `The reference is a ${poseFacing} view. Repose this same figure as ${facing}, the same character and ${flags.subject} turned to that angle as an isometric game sprite would be — keep the body proportions, gait phase and silhouette of the reference.`;
  return promptTemplate
    .replaceAll("{{DIR}}", dir)
    .replaceAll("{{FACING}}", facing)
    .replaceAll("{{POSE}}", turning)
    .replaceAll("{{HEAD_SIDE}}", dir === "e" || dir === "ne" || dir === "se" ? "RIGHT" : dir === "w" || dir === "nw" || dir === "sw" ? "LEFT" : "CENTRE");
}

function dataUrl(file) {
  return `data:image/png;base64,${readFileSync(file).toString("base64")}`;
}

async function generate(prompt, refFile) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY required");
  const body = {
    model: flags.model,
    modalities: ["image", "text"],
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: dataUrl(refFile) } },
        ],
      },
    ],
  };
  if (flags.providerTag) {
    body.provider = { only: [flags.providerTag], allow_fallbacks: false };
  }
  const res = await fetch(API, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const msg = json.choices?.[0]?.message;
  const img = msg?.images?.[0]?.image_url?.url ?? msg?.images?.[0]?.url;
  if (!img) throw new Error(`No image in response: ${JSON.stringify(json).slice(0, 1200)}`);
  return Buffer.from(img.split("base64,")[1], "base64");
}

// Border flood fill: only background CONNECTED to the canvas edge is cleared,
// so enclosed light-grey subject areas (steel, white horse coat) survive.
function keyBackground(png, tolerance) {
  const { width, height, data } = png;
  const corners = [
    [2, 2], [width - 3, 2], [2, height - 3], [width - 3, height - 3],
  ];
  let br = 0, bg = 0, bb = 0;
  for (const [x, y] of corners) {
    const k = (y * width + x) * 4;
    br += data[k]; bg += data[k + 1]; bb += data[k + 2];
  }
  br /= corners.length; bg /= corners.length; bb /= corners.length;

  const dist = (k) => {
    const dr = data[k] - br, dg = data[k + 1] - bg, db = data[k + 2] - bb;
    return Math.sqrt(dr * dr + dg * dg + db * db);
  };

  const tol = tolerance;
  const cleared = new Uint8Array(width * height);
  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const p = y * width + x;
    if (cleared[p]) return;
    const k = p * 4;
    if (data[k + 3] === 0 || dist(k) <= tol) {
      cleared[p] = 1;
      stack.push(p);
    }
  };
  for (let x = 0; x < width; x++) { push(x, 0); push(x, height - 1); }
  for (let y = 0; y < height; y++) { push(0, y); push(width - 1, y); }
  while (stack.length) {
    const p = stack.pop();
    const x = p % width, y = (p / width) | 0;
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }

  // Soft boundary matte: a pixel that borders cleared background and is still
  // close to it is background bleed on the antialiased edge, not subject.
  const soft = new Uint8Array(cleared);
  const band = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (cleared[p]) continue;
      const near =
        (x > 0 && cleared[p - 1]) || (x < width - 1 && cleared[p + 1]) ||
        (y > 0 && cleared[p - width]) || (y < height - 1 && cleared[p + width]);
      if (!near) continue;
      band[p] = 1;
      const k = p * 4;
      const d = dist(k);
      if (d <= tol * 1.8) {
        const a = Math.round(Math.max(0, Math.min(1, (d - tol) / (tol * 0.8))) * 255);
        data[k + 3] = Math.min(data[k + 3], a);
      }
    }
  }
  for (let p = 0; p < cleared.length; p++) {
    if (cleared[p] || (band[p] && data[p * 4 + 3] < 24)) {
      data[p * 4 + 3] = 0;
    }
  }
  return { width, height, data, bg: [br, bg, bb] };
}

function alphaBounds(png, threshold = 8) {
  const { width, height, data } = png;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] <= threshold) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) throw new Error("keyed sprite is fully transparent");
  return { x0, y0, x1, y1, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

function pngFromRaw(raw, width, height) {
  return { width, height, data: raw };
}

async function frameLikeReference(keyed, refFile, size) {
  const ref = PNG.sync.read(readFileSync(refFile));
  const refBounds = alphaBounds(ref);
  const bounds = alphaBounds(keyed);

  const heightScale = refBounds.height / bounds.height;
  let targetH = refBounds.height;
  let targetW = Math.round(bounds.width * heightScale);
  if (targetW > size) {
    const widthScale = size / targetW;
    targetW = size;
    targetH = Math.round(targetH * widthScale);
  }
  return frameScaled(keyed, bounds, size, targetH, targetW, refBounds);
}

async function frameScaled(keyed, bounds, size, targetH, targetW, refBounds) {
  const { width, height, data } = keyed;
  const cropped = Buffer.alloc(bounds.width * bounds.height * 4);
  for (let y = 0; y < bounds.height; y++) {
    const srcStart = ((bounds.y0 + y) * width + bounds.x0) * 4;
    data.copy(cropped, y * bounds.width * 4, srcStart, srcStart + bounds.width * 4);
  }
  const resized = await sharp(cropped, { raw: { width: bounds.width, height: bounds.height, channels: 4 } })
    .resize(targetW, targetH, { fit: "fill", kernel: "lanczos3" })
    .png()
    .toBuffer();

  const refCx = (refBounds.x0 + refBounds.x1) / 2;
  const refBottom = refBounds.y1;
  let left = Math.round(refCx - targetW / 2);
  let top = Math.round(refBottom - targetH);
  if (left < 0) left = 0;
  if (top < 0) top = 0;
  if (left + targetW > size) left = size - targetW;
  if (top + targetH > size) top = size - targetH;

  return sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: resized, left, top }])
    .png()
    .toBuffer();
}

async function bannerCrop(buffer, outFile, width, height) {
  await sharp(buffer)
    .resize(width, height, { fit: "cover", position: "centre", kernel: "lanczos3" })
    .png()
    .toFile(outFile);
}

function planSprites() {
  const plan = [];
  for (const dir of flags.dirs) {
    const refFile = flags.ref
      ? path.resolve(flags.ref)
      : path.join(path.resolve(flags.refDir), `${flags.refPrefix ?? flags.id}-${POSE_REFERENCE[dir]}.png`);
    const outFile = path.join(outDir, `${flags.id}-${dir}${flags.suffix}.png`);
    plan.push({ dir, refFile, outFile });
  }
  return plan;
}

if (flags.dryRun) {
  if (flags.kind === "banner") {
    console.log(`would generate banner -> ${bannerOut}`);
    console.log(`  model: ${flags.model} (${flags.providerTag})`);
    console.log(`  reference: ${flags.ref ? path.resolve(flags.ref) : "<none>"}`);
    console.log(`  prompt: ${promptTemplate.length} chars`);
  } else {
    for (const job of planSprites()) {
      console.log(`would generate ${job.dir}: ${job.refFile} -> ${job.outFile}`);
    }
    console.log(`  model: ${flags.model} (${flags.providerTag})`);
    console.log(`  masters: ${masterDir}`);
    console.log(`  prompt: ${promptTemplate.length} chars, starts "${promptTemplate.slice(0, 60).replace(/\n/g, " ")}..."`);
  }
  process.exit(0);
}

if (flags.kind === "banner") {
  const refFile = flags.ref ? path.resolve(flags.ref) : null;
  console.log(`Generating banner for ${flags.id} ...`);
  const raw = await generate(promptTemplate, refFile);
  const masterFile = path.join(masterDir, `${flags.id}-banner-master.png`);
  mkdirSync(path.dirname(masterFile), { recursive: true });
  writeFileSync(masterFile, raw);
  console.log(`  master: ${masterFile} (${(raw.length / 1024).toFixed(0)} KB)`);
  mkdirSync(path.dirname(bannerOut), { recursive: true });
  await bannerCrop(raw, bannerOut, 320, 100);
  const meta = await sharp(bannerOut).metadata();
  console.log(`  wrote ${bannerOut} (${meta.width}x${meta.height})`);
  process.exit(0);
}

mkdirSync(masterDir, { recursive: true });
mkdirSync(outDir, { recursive: true });

let failures = 0;
for (const job of planSprites()) {
  if (existsSync(job.outFile) && !flags.force) {
    console.log(`[skip] ${path.basename(job.outFile)} exists (use --force to regenerate)`);
    continue;
  }
  if (!existsSync(job.refFile)) {
    console.error(`[fail] ${job.dir}: reference ${job.refFile} missing`);
    failures++;
    continue;
  }
  process.stdout.write(`[${job.dir}] generating ... `);
  try {
    const raw = await generate(dirPrompt(job.dir), job.refFile);
    const masterFile = path.join(masterDir, `${flags.id}-${job.dir}${flags.suffix}-master.png`);
    writeFileSync(masterFile, raw);
    const decoded = PNG.sync.read(raw);
    const keyed = keyBackground(pngFromRaw(decoded.data, decoded.width, decoded.height), flags.tolerance);
    const framed = await frameLikeReference(keyed, job.refFile, flags.size);
    writeFileSync(job.outFile, framed);
    const bounds = alphaBounds(PNG.sync.read(framed));
    console.log(
      `wrote ${path.basename(job.outFile)} (${(framed.length / 1024).toFixed(0)} KB, ` +
      `${bounds.width}x${bounds.height} at ${bounds.x0},${bounds.y0})`,
    );
  } catch (err) {
    failures++;
    console.log(`FAILED: ${err.message}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} sprite(s) failed.`);
  process.exit(1);
}
console.log("done.");
