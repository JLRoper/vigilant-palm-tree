import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

function dilateMask(mask, width, height, passes = 2) {
  const result = new Uint8Array(mask);
  for (let pass = 0; pass < passes; pass++) {
    const prev = new Uint8Array(result);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (prev[i] > 0) continue;
        let hasNeighbor = false;
        if (x > 0 && prev[i - 1] > 0) hasNeighbor = true;
        if (x < width - 1 && prev[i + 1] > 0) hasNeighbor = true;
        if (y > 0 && prev[i - width] > 0) hasNeighbor = true;
        if (y < height - 1 && prev[i + width] > 0) hasNeighbor = true;
        if (hasNeighbor) result[i] = 255;
      }
    }
  }
  return result;
}

async function processSprite(inputPath, outputPath) {
  const input = await readFile(inputPath);
  
  const image = sharp(input);
  const metadata = await image.metadata();
  const srcWidth = metadata.width;
  const srcHeight = metadata.height;
  
  const { data: srcData } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  
  const dstWidth = 64;
  const dstHeight = 64;
  const px = new Uint8ClampedArray(dstWidth * dstHeight * 4);
  const mask = new Uint8Array(dstWidth * dstHeight);
  
  const xRatio = srcWidth / dstWidth;
  const yRatio = srcHeight / dstHeight;
  
  for (let y = 0; y < dstHeight; y++) {
    for (let x = 0; x < dstWidth; x++) {
      const srcX = x * xRatio;
      const srcY = y * yRatio;
      
      const x0 = Math.floor(srcX);
      const y0 = Math.floor(srcY);
      const x1 = Math.min(x0 + 1, srcWidth - 1);
      const y1 = Math.min(y0 + 1, srcHeight - 1);
      
      const dx = srcX - x0;
      const dy = srcY - y0;
      
      let r = 0, g = 0, b = 0, a = 0;
      
      for (let cy = 0; cy <= 1; cy++) {
        for (let cx = 0; cx <= 1; cx++) {
          const si = ((y0 + cy) * srcWidth + (x0 + cx)) * 4;
          const weight = (cx === 0 ? 1 - dx : dx) * (cy === 0 ? 1 - dy : dy);
          r += srcData[si] * weight;
          g += srcData[si + 1] * weight;
          b += srcData[si + 2] * weight;
          a += srcData[si + 3] * weight;
        }
      }
      
      const di = (y * dstWidth + x) * 4;
      px[di] = r;
      px[di + 1] = g;
      px[di + 2] = b;
      px[di + 3] = a;
      
      const brightness = (r + g + b) / 3;
      if (brightness < 245 && a > 50) {
        mask[y * dstWidth + x] = 255;
      }
    }
  }
  
  const dilatedMask = dilateMask(mask, dstWidth, dstHeight, 2);
  
  for (let y = 0; y < dstHeight; y++) {
    for (let x = 0; x < dstWidth; x++) {
      const i = y * dstWidth + x;
      const k = i * 4;
      
      const inOriginal = mask[i] > 0;
      const inDilated = dilatedMask[i] > 0;
      
      if (inDilated && !inOriginal) {
        px[k] = 0;
        px[k + 1] = 0;
        px[k + 2] = 0;
        px[k + 3] = 255;
      }
      
      if (!inOriginal) {
        const bright = (px[k] + px[k + 1] + px[k + 2]) / 3;
        if (bright > 250) {
          px[k + 3] = 0;
        }
      }
    }
  }
  
  const output = await sharp(px, {
    raw: { width: dstWidth, height: dstHeight, channels: 4 }
  }).png().toBuffer();
  
  await writeFile(outputPath, output);
}

async function main() {
  const files = [
    { src: 'C:/Users/Jacob/AppData/Local/Temp/kilo/flux/horse-bubbly-w-raw.png', dst: 'C:/ProjectDevelopment/heroes-js/.kilo/worktrees/hero-movement-iso/src/resources/units/horse-bubbly-w.png' },
    { src: 'C:/Users/Jacob/AppData/Local/Temp/kilo/flux/horse-bubbly-e-raw.png', dst: 'C:/ProjectDevelopment/heroes-js/.kilo/worktrees/hero-movement-iso/src/resources/units/horse-bubbly-e.png' },
    { src: 'C:/Users/Jacob/AppData/Local/Temp/kilo/flux/horse-bubbly-nw-raw2.png', dst: 'C:/ProjectDevelopment/heroes-js/.kilo/worktrees/hero-movement-iso/src/resources/units/horse-bubbly-nw.png' },
    { src: 'C:/Users/Jacob/AppData/Local/Temp/kilo/flux/horse-bubbly-ne-raw2.png', dst: 'C:/ProjectDevelopment/heroes-js/.kilo/worktrees/hero-movement-iso/src/resources/units/horse-bubbly-ne.png' },
    { src: 'C:/Users/Jacob/AppData/Local/Temp/kilo/flux/horse-bubbly-sw-raw.png', dst: 'C:/ProjectDevelopment/heroes-js/.kilo/worktrees/hero-movement-iso/src/resources/units/horse-bubbly-sw.png' },
    { src: 'C:/Users/Jacob/AppData/Local/Temp/kilo/flux/horse-bubbly-se-raw.png', dst: 'C:/ProjectDevelopment/heroes-js/.kilo/worktrees/hero-movement-iso/src/resources/units/horse-bubbly-se.png' },
  ];
  
  for (const { src, dst } of files) {
    console.log(`Processing ${src} -> ${dst}`);
    await processSprite(src, dst);
  }
  
  console.log('Done!');
}

main().catch(console.error);
