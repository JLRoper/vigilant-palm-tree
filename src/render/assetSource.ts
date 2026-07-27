export type Drawable = HTMLImageElement | HTMLCanvasElement;

export interface SpriteSource {
  preload(): void;
  resolve(key: string): { drawable: Drawable; ready: boolean } | undefined;
}

export class ImageSpriteSource implements SpriteSource {
  private cache = new Map<string, HTMLImageElement>();
  private ready = new Map<string, boolean>();

  constructor(private urlForKey: Record<string, string>) {}

  preload(): void {
    for (const [key, url] of Object.entries(this.urlForKey)) {
      if (this.cache.has(key)) continue;
      const img = new Image();
      this.cache.set(key, img);
      this.ready.set(key, false);
      img.onload = () => this.ready.set(key, true);
      img.onerror = () => this.ready.set(key, false);
      img.src = url;
    }
  }

  resolve(key: string): { drawable: HTMLImageElement; ready: boolean } | undefined {
    const drawable = this.cache.get(key);
    if (!drawable) return undefined;
    return { drawable, ready: this.ready.get(key) === true };
  }
}

export class OnDemandSpriteSource implements SpriteSource {
  private cache = new Map<string, HTMLImageElement>();
  private loading = new Set<string>();

  constructor(private urlMap: Record<string, string>) {}

  preload(): void {}

  resolve(key: string): { drawable: HTMLImageElement; ready: boolean } | undefined {
    if (this.cache.has(key)) return { drawable: this.cache.get(key)!, ready: true };
    const url = this.urlMap[key];
    if (!url) return undefined;
    if (this.loading.has(key)) return undefined;
    const img = new Image();
    img.src = url;
    this.cache.set(key, img);
    this.loading.add(key);
    img.onload = () => {
      this.loading.delete(key);
    };
    return { drawable: img, ready: false };
  }
}

export type ProceduralDrawer = (ctx: CanvasRenderingContext2D, size: number) => void;

export class ProceduralSpriteSource implements SpriteSource {
  private cache = new Map<string, HTMLCanvasElement>();

  constructor(
    private drawers: Record<string, ProceduralDrawer>,
    private naturalSizeForKey: Record<string, number>,
    private renderScale = 4
  ) {}

  preload(): void {
    for (const [key, draw] of Object.entries(this.drawers)) {
      if (this.cache.has(key)) continue;
      const size = this.naturalSizeForKey[key] ?? 32;
      const canvas = document.createElement("canvas");
      canvas.width = size * this.renderScale;
      canvas.height = size * this.renderScale;
      const ctx = canvas.getContext("2d")!;
      ctx.imageSmoothingEnabled = false;
      ctx.scale(this.renderScale, this.renderScale);
      draw(ctx, size);
      this.cache.set(key, canvas);
    }
  }

  resolve(key: string): { drawable: HTMLCanvasElement; ready: boolean } | undefined {
    const drawable = this.cache.get(key);
    if (!drawable) return undefined;
    return { drawable, ready: true };
  }
}

export class CompositeSpriteSource implements SpriteSource {
  constructor(private sources: SpriteSource[]) {}

  preload(): void {
    for (const s of this.sources) s.preload();
  }

  resolve(key: string): { drawable: Drawable; ready: boolean } | undefined {
    for (const s of this.sources) {
      const r = s.resolve(key);
      if (r) return r;
    }
    return undefined;
  }
}

export class VariantAwareSource implements SpriteSource {
  constructor(
    private inner: SpriteSource,
    private getVariant: () => number,
  ) {}

  preload(): void {
    this.inner.preload();
  }

  resolve(key: string): { drawable: Drawable; ready: boolean } | undefined {
    const variant = this.getVariant();
    if (variant > 1) {
      const variantKey = `${key}_variant${variant}`;
      const r = this.inner.resolve(variantKey);
      if (r) return r;
    }
    return this.inner.resolve(key);
  }
}

export class ApiSpriteSource implements SpriteSource {
  private cache = new Map<string, HTMLImageElement>();
  private loading = new Set<string>();
  private baseUrl: string;

  constructor(baseUrl = "/api/assets") {
    this.baseUrl = baseUrl;
  }

  preload(): void {}

  resolve(key: string): { drawable: HTMLImageElement; ready: boolean } | undefined {
    if (this.cache.has(key)) return { drawable: this.cache.get(key)!, ready: true };
    if (this.loading.has(key)) return undefined;
    const url = `${this.baseUrl}/${encodeURIComponent(key)}`;
    const img = new Image();
    this.cache.set(key, img);
    this.loading.add(key);
    img.onload = () => {
      this.loading.delete(key);
    };
    img.onerror = () => {
      this.loading.delete(key);
      this.cache.delete(key);
    };
    img.src = url;
    return { drawable: img, ready: false };
  }

  clear(): void {
    for (const img of this.cache.values()) {
      img.src = "";
    }
    this.cache.clear();
    this.loading.clear();
  }
}
