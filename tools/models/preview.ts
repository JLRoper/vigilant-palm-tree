import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import type { OverlayOptions } from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

interface Manifest {
  id: string;
  frameSize: number;
  directions: string[];
  still: string;
  animations: Array<{ name: string; frames: number; loop: boolean; strip: string }>;
}

function fill(pattern: string, dir: string): string {
  return pattern.replace("{dir}", dir);
}

async function main(): Promise<void> {
  const modelId = process.argv[2] ?? "archer";
  const scale = Number(process.argv[3] ?? 2);
  const dir = path.resolve(ROOT, "src", "resources", "units", modelId);

  const manifest = JSON.parse(
    await readFile(path.join(dir, "manifest.json"), "utf8"),
  ) as Manifest;

  const cell = manifest.frameSize * scale;
  const rows: Array<{ file: string; frames: number }> = [
    ...manifest.directions.map((d) => ({ file: fill(manifest.still, d), frames: 1 })),
  ];

  const stillRow = manifest.directions.length;
  const animRows = manifest.animations.map((a) => ({
    file: fill(a.strip, "se"),
    frames: a.frames,
  }));

  const width = Math.max(
    stillRow * cell,
    ...animRows.map((r) => r.frames * cell),
  );
  const height = cell * (1 + animRows.length);

  const composites: OverlayOptions[] = [];

  for (let i = 0; i < rows.length; i += 1) {
    const buf = await sharp(path.join(dir, rows[i].file))
      .resize(cell, cell, { kernel: "nearest" })
      .toBuffer();
    composites.push({ input: buf, left: i * cell, top: 0 });
  }

  for (let r = 0; r < animRows.length; r += 1) {
    const row = animRows[r];
    const buf = await sharp(path.join(dir, row.file))
      .resize(row.frames * cell, cell, { kernel: "nearest" })
      .toBuffer();
    composites.push({ input: buf, left: 0, top: (r + 1) * cell });
  }

  const previewDir = path.resolve(ROOT, "tools", "models", "previews");
  await mkdir(previewDir, { recursive: true });
  const out = path.join(previewDir, `${modelId}-preview.png`);
  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 38, g: 42, b: 48, alpha: 255 },
    },
  })
    .composite(composites)
    .png()
    .toFile(out);

  console.log(`Wrote ${path.relative(ROOT, out)} (${width}x${height})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
