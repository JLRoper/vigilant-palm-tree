// Skybox asset module. Boundary contract lives in src/render/docs/technical-spec.md
// and src/render/scene/paint2d/README.md.

import skyboxBaseUrl from "./resources/skybox/cityView-background.png?url";
import skyboxVariant2Url from "./resources/skybox/cityView-background-variant2.png?url";
import skyboxVariant3Url from "./resources/skybox/cityView-background-variant3.png?url";
import skyboxVariant4Url from "./resources/skybox/cityView-background-variant4.png?url";

import type { SkyboxProvider } from "./scene/paint2d/deps";

const LAYER_BANDS: Record<number, Array<{ yStart: number; yEnd: number }>> = {
  2: [
    { yStart: 0.0, yEnd: 0.55 },
    { yStart: 0.45, yEnd: 1.0 },
  ],
  3: [
    { yStart: 0.0, yEnd: 0.4 },
    { yStart: 0.3, yEnd: 0.7 },
    { yStart: 0.6, yEnd: 1.0 },
  ],
  4: [
    { yStart: 0.0, yEnd: 0.35 },
    { yStart: 0.25, yEnd: 0.6 },
    { yStart: 0.5, yEnd: 0.8 },
    { yStart: 0.7, yEnd: 1.0 },
  ],
};

const PARALLAX_SPEEDS: Record<number, number[]> = {
  2: [0.1, 1.0],
  3: [0.1, 0.4, 1.0],
  4: [0.1, 0.3, 0.6, 1.0],
};

const SKYBOX_URLS: Record<number, string> = {
  1: skyboxBaseUrl,
  2: skyboxVariant2Url,
  3: skyboxVariant3Url,
  4: skyboxVariant4Url,
};

function skyboxPath(variant: number): string {
  return SKYBOX_URLS[variant] ?? skyboxBaseUrl;
}

function splitIntoLayers(img: HTMLImageElement, layerCount: number): HTMLCanvasElement[] {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const bands = LAYER_BANDS[layerCount] ?? LAYER_BANDS[4];
  const layers: HTMLCanvasElement[] = [];
  const fadePct = 0.18;

  for (let i = 0; i < layerCount; i++) {
    const band = bands[i];
    const y0 = Math.floor(band.yStart * h);
    const y1 = Math.floor(band.yEnd * h);
    const bandH = y1 - y0;
    const fadePx = Math.max(1, Math.floor(bandH * fadePct));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;

    const sliceCanvas = document.createElement("canvas");
    sliceCanvas.width = w;
    sliceCanvas.height = bandH;
    const sctx = sliceCanvas.getContext("2d")!;
    sctx.drawImage(img, 0, y0, w, bandH, 0, 0, w, bandH);

    const imageData = sctx.getImageData(0, 0, w, bandH);
    const data = imageData.data;
    for (let py = 0; py < bandH; py++) {
      let alphaMul = 1;
      if (py < fadePx) {
        alphaMul = py / fadePx;
      } else if (py > bandH - fadePx) {
        alphaMul = (bandH - py) / fadePx;
      }
      if (alphaMul >= 1) continue;
      const rowStart = py * w * 4;
      for (let px = 0; px < w; px++) {
        const idx = rowStart + px * 4;
        data[idx + 3] = Math.round(data[idx + 3] * alphaMul);
      }
    }
    sctx.putImageData(imageData, 0, 0);

    ctx.drawImage(sliceCanvas, 0, y0);
    layers.push(canvas);
  }

  return layers;
}

/**
 * Build a fresh `SkyboxProvider` matching the `paint2d/deps.ts` interface.
 *
 * Each provider owns its own cache state (the live `cityRenderer.ts` uses
 * module-scope `let`s — once the seam is wired, callers should hold one
 * provider per active city-view session rather than sharing the live
 * module-scope state across multiple views).
 *
 * Loading is async: `ensureLoaded(variant)` kicks off the underlying
 * `HTMLImageElement` load and returns immediately. `getImage`/`getLayers`
 * return `null` until the load completes, then return the cached drawable.
 * The painter's `paintCitySkybox` already handles the `null` case (falls
 * back to a solid background fill — see `BATTLE_BG` in `paint2d/colors.ts`).
 */
export function createSkyboxProvider(): SkyboxProvider {
  const cache = new Map<number, HTMLImageElement>();
  const loaded = new Set<number>();
  const pending = new Set<number>();
  const layerCanvasCache = new Map<string, HTMLCanvasElement[]>();
  const layerSplitPending = new Set<string>();

  function ensureLoaded(variant: number): void {
    if (cache.has(variant)) return;
    if (pending.has(variant)) return;
    pending.add(variant);
    const img = new Image();
    img.onload = () => {
      cache.set(variant, img);
      loaded.add(variant);
      pending.delete(variant);
    };
    img.onerror = () => {
      pending.delete(variant);
      if (variant > 1) ensureLoaded(1);
    };
    img.src = skyboxPath(variant);
  }

  function getImage(variant: number): HTMLImageElement | null {
    return cache.get(variant) ?? null;
  }

  function getLayers(variant: number, layerCount: number): HTMLCanvasElement[] | null {
    const img = cache.get(variant);
    if (!img || !loaded.has(variant)) return null;

    const key = `${variant}:${layerCount}`;
    const cached = layerCanvasCache.get(key);
    if (cached) return cached;
    if (layerSplitPending.has(key)) return null;

    layerSplitPending.add(key);
    try {
      const layers = splitIntoLayers(img, layerCount);
      layerCanvasCache.set(key, layers);
      layerSplitPending.delete(key);
      return layers;
    } catch {
      layerSplitPending.delete(key);
      return null;
    }
  }

  return { ensureLoaded, getImage, getLayers };
}

export const SKYBOX_DEFAULTS = {
  LAYER_BANDS,
  PARALLAX_SPEEDS,
  SKYBOX_URLS,
  CITY_BG_FALLBACK: "#1a1620",
} as const;
