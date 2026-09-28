// Gemini building sprite generator via OpenRouter (image-in → image-out).
// Sends a style reference PNG + prompt to google/gemini-2.5-flash-image and
// saves the result into src/resources/buildings/, then auto-runs
// strip-checkerboard.mjs on it (fake checkerboard → real alpha).
// It stores NO prompts — the caller passes --name plus --prompt or
// --prompt-file every time, so concurrent agents never edit this file.
//
// Usage:
//   $env:OPENROUTER_API_KEY = "..." ; node .kilo/skills/building-sprite-gen/scripts/gemini-buildings.mjs --name <file> (--prompt <text> | --prompt-file <path>) [flags]
//
// Example:
//   ... gemini-buildings.mjs --name building-pixel-stoneQuarry-1.png --prompt "Isometric pixel art game asset ..."
//
// Flags:
//   --name <file>        output file name, e.g. building-pixel-stoneQuarry-1.png (required)
//   --prompt <text>      the generation prompt as a single quoted string
//   --prompt-file <path> read the prompt from a UTF-8 text file instead
//   --ref <path>         style-reference PNG (default: src/resources/buildings/building-pixel-granary-1.png)
//   --model <id>         OpenRouter model id (default: google/gemini-2.5-flash-image)
//   --no-strip           skip the automatic strip-checkerboard.mjs post-pass
//   --dry-run            print what would run (name, model, out path, reference) and exit — no API call, no billing
//   --help               show this text

import { writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, "..", "..", "..", "..", "src", "resources", "buildings");
const stripScript = path.join(__dirname, "strip-checkerboard.mjs");
const API = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash-image";
const apiKey = process.env.OPENROUTER_API_KEY;

function usage() { console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(0, 22).join("\n")); }

const argv = process.argv.slice(2);
const flags = { prompt: null, promptFile: null, name: null, ref: null, model: MODEL, strip: true, dryRun: false };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--help" || a === "-h") { usage(); process.exit(0); }
  else if (a === "--prompt") flags.prompt = argv[++i];
  else if (a === "--prompt-file") flags.promptFile = argv[++i];
  else if (a === "--name") flags.name = argv[++i];
  else if (a === "--ref") flags.ref = argv[++i];
  else if (a === "--model") flags.model = argv[++i];
  else if (a === "--no-strip") flags.strip = false;
  else if (a === "--dry-run") flags.dryRun = true;
  else { console.error(`Unexpected argument: ${a}\n`); usage(); process.exit(1); }
}

if (!flags.name) { console.error("--name is required"); process.exit(1); }
if (flags.prompt && flags.promptFile) { console.error("Use --prompt or --prompt-file, not both"); process.exit(1); }
if (!flags.prompt && !flags.promptFile) { console.error("--prompt or --prompt-file is required (the script stores no prompts)"); process.exit(1); }
const prompt = flags.promptFile ? readFileSync(path.resolve(flags.promptFile), "utf8") : flags.prompt;

if (!/^building-pixel-[a-zA-Z]+-\d+\.png$/.test(flags.name)) {
  console.warn(`Warning: "${flags.name}" does not match the convention building-pixel-<camelCaseName>-<level>.png`);
}

const refPath = flags.ref ? path.resolve(flags.ref) : path.join(outDir, "building-pixel-granary-1.png");
const refDataUrl = `data:image/png;base64,${readFileSync(refPath).toString("base64")}`;

if (flags.dryRun) {
  console.log(`would generate ${flags.name} -> ${path.join(outDir, flags.name)}`);
  console.log(`  model: ${flags.model}`);
  console.log(`  reference: ${refPath}`);
  console.log(`  prompt: ${prompt.length} chars, starts "${prompt.slice(0, 60).replace(/\n/g, " ")}..."`);
  process.exit(0);
}

if (!apiKey) { console.error("OPENROUTER_API_KEY required"); process.exit(1); }

async function gen(prompt) {
  const r = await fetch(API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: flags.model,
      modalities: ["image", "text"],
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: refDataUrl } },
          ],
        },
      ],
    }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
  const d = await r.json();
  const msg = d.choices?.[0]?.message;
  const img = msg?.images?.[0]?.image_url?.url ?? msg?.images?.[0]?.url;
  if (!img) {
    console.error("No image in response:", JSON.stringify(d).slice(0, 2000));
    process.exit(1);
  }
  return Buffer.from(img.split("base64,")[1], "base64");
}

function strip(file) {
  const r = spawnSync(process.execPath, [stripScript, file], { stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`  auto-strip failed; run manually: node ${stripScript} ${file}`);
  }
}

console.log(`Generating ${flags.name} ...`);
const buf = await gen(prompt);
const out = path.join(outDir, flags.name);
writeFileSync(out, buf);
console.log(`  wrote ${out} (${(buf.length / 1024).toFixed(0)} KB)`);
if (flags.strip) strip(out);
