import sharp from "sharp";
import { resolve, basename } from "path";

const SKYBOX_PATH = resolve("src/resources/skybox/cityView-background.png");

const LAYER_BANDS: Record<number, Array<{ yStart: number; yEnd: number }>> = {
  2: [
    { yStart: 0.00, yEnd: 0.55 },
    { yStart: 0.45, yEnd: 1.00 },
  ],
  3: [
    { yStart: 0.00, yEnd: 0.40 },
    { yStart: 0.30, yEnd: 0.70 },
    { yStart: 0.60, yEnd: 1.00 },
  ],
  4: [
    { yStart: 0.00, yEnd: 0.35 },
    { yStart: 0.25, yEnd: 0.60 },
    { yStart: 0.50, yEnd: 0.80 },
    { yStart: 0.70, yEnd: 1.00 },
  ],
};

const FADE_PCT = 0.18;

async function main() {
  const meta = await sharp(SKYBOX_PATH).metadata();
  const w = meta.width!;
  const h = meta.height!;
  const buffer = await sharp(SKYBOX_PATH).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
  const pixels = buffer.data;

  const dir = resolve("src/resources/skybox");
  const base = basename(SKYBOX_PATH, ".png");

  for (const layerCount of [2, 3, 4]) {
    const bands = LAYER_BANDS[layerCount];

    for (let i = 0; i < layerCount; i++) {
      const band = bands[i];
      const y0 = Math.floor(band.yStart * h);
      const y1 = Math.floor(band.yEnd * h);
      const bandH = y1 - y0;
      const fadePx = Math.max(1, Math.floor(bandH * FADE_PCT));

      const out = Buffer.alloc(w * h * 4, 0);

      for (let py = 0; py < bandH; py++) {
        let alphaMul = 1;
        if (py < fadePx) {
          alphaMul = py / fadePx;
        } else if (py > bandH - fadePx) {
          alphaMul = (bandH - py) / fadePx;
        }
        const srcRow = (y0 + py) * w * 4;
        const dstRow = (y0 + py) * w * 4;
        for (let px = 0; px < w; px++) {
          const src = srcRow + px * 4;
          const dst = dstRow + px * 4;
          out[dst] = pixels[src];
          out[dst + 1] = pixels[src + 1];
          out[dst + 2] = pixels[src + 2];
          out[dst + 3] = Math.round(pixels[src + 3] * alphaMul);
        }
      }

      const outPath = resolve(dir, `${base}-layer${i + 1}.png`);
      await sharp(out, { raw: { width: w, height: h, channels: 4 } })
        .png()
        .toFile(outPath);
      console.log(`  ${outPath}`);
    }
  }

  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
