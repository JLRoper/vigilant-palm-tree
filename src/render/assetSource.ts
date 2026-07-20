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
      img.src = url;
      this.cache.set(key, img);
      this.ready.set(key, false);
      img.onload = () => this.ready.set(key, true);
    }
  }

  resolve(key: string): { drawable: HTMLImageElement; ready: boolean } | undefined {
    const drawable = this.cache.get(key);
    if (!drawable) return undefined;
    return { drawable, ready: this.ready.get(key) === true };
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
