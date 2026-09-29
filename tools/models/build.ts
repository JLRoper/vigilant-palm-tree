import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

import { buildFrame } from "./pose";
import type { Face } from "./pose";
import { computeFit, createTarget, renderFaces } from "./render";
import type { Fit } from "./render";
import { DIRECTIONS, YAW_BY_DIRECTION } from "./types";
import type { Animation, ModelDef } from "./types";
import { archerModel } from "./units/archer";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const MODELS: Record<string, ModelDef> = {
  archer: archerModel,
};

const FIT_ANIMATIONS = new Set(["idle", "draw"]);

interface Options {
  model: string;
  size: number;
  supersample: number;
  padding: number;
  outDir: string;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    model: "archer",
    size: 128,
    supersample: 4,
    padding: 6,
    outDir: "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--model" && next) {
      opts.model = next;
      i += 1;
    } else if (arg === "--size" && next) {
      opts.size = Number(next);
      i += 1;
    } else if (arg === "--ss" && next) {
      opts.supersample = Number(next);
      i += 1;
    } else if (arg === "--padding" && next) {
      opts.padding = Number(next);
      i += 1;
    } else if (arg === "--out" && next) {
      opts.outDir = next;
      i += 1;
    }
  }

  if (!opts.outDir) {
    opts.outDir = path.join("src", "resources", "units", opts.model);
  }
  return opts;
}

async function writePng(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  outWidth: number,
  outHeight: number,
  file: string,
): Promise<void> {
  await sharp(Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength), {
    raw: { width, height, channels: 4 },
  })
    .resize(outWidth, outHeight, { kernel: "lanczos3", fit: "fill" })
    .png({ compressionLevel: 9 })
    .toFile(file);
}

function framesOf(model: ModelDef, anim: Animation | null, yaw: number): Face[][] {
  const count = anim ? anim.frames : 1;
  const out: Face[][] = [];
  for (let i = 0; i < count; i += 1) {
    out.push(buildFrame(model, anim, i, yaw));
  }
  return out;
}

function collectFitBatches(model: ModelDef): Face[][] {
  const batches: Face[][] = [];
  for (const dir of DIRECTIONS) {
    const yaw = YAW_BY_DIRECTION[dir];
    batches.push(buildFrame(model, null, 0, yaw));
    for (const anim of model.animations) {
      if (!FIT_ANIMATIONS.has(anim.name)) continue;
      batches.push(...framesOf(model, anim, yaw));
    }
  }
  return batches;
}

async function renderStrip(
  model: ModelDef,
  anim: Animation | null,
  yaw: number,
  fit: Fit,
  opts: Options,
  file: string,
): Promise<void> {
  const frames = framesOf(model, anim, yaw);
  const cell = opts.size * opts.supersample;
  const target = createTarget(cell * frames.length, cell);

  frames.forEach((faces, i) => {
    renderFaces(target, faces, fit, i * cell, cell);
  });

  await writePng(
    target.pixels,
    target.width,
    target.height,
    opts.size * frames.length,
    opts.size,
    file,
  );
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const model = MODELS[opts.model];
  if (!model) {
    throw new Error(`Unknown model "${opts.model}". Known: ${Object.keys(MODELS).join(", ")}`);
  }

  const outDir = path.resolve(ROOT, opts.outDir);
  const stillDir = path.join(outDir, "still");
  const animDir = path.join(outDir, "anim");
  await mkdir(stillDir, { recursive: true });
  await mkdir(animDir, { recursive: true });

  const cell = opts.size * opts.supersample;
  const fit = computeFit(collectFitBatches(model), cell, opts.padding * opts.supersample);

  let written = 0;

  for (const dir of DIRECTIONS) {
    const yaw = YAW_BY_DIRECTION[dir];
    const file = path.join(stillDir, `${model.id}-${dir}.png`);
    await renderStrip(model, null, yaw, fit, opts, file);
    written += 1;
  }

  for (const anim of model.animations) {
    for (const dir of DIRECTIONS) {
      const yaw = YAW_BY_DIRECTION[dir];
      const file = path.join(animDir, `${model.id}-${anim.name}-${dir}.png`);
      await renderStrip(model, anim, yaw, fit, opts, file);
      written += 1;
    }
  }

  const manifest = {
    id: model.id,
    frameSize: opts.size,
    directions: DIRECTIONS,
    still: `still/${model.id}-{dir}.png`,
    animations: model.animations.map((a) => ({
      name: a.name,
      frames: a.frames,
      loop: a.loop,
      strip: `anim/${model.id}-${a.name}-{dir}.png`,
    })),
  };

  await writeFile(
    path.join(outDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  console.log(`Wrote ${written} sprite files + manifest.json to ${path.relative(ROOT, outDir)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
