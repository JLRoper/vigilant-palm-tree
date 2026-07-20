import {
  ALL_DESCRIPTORS,
  SpriteDescriptor,
  SpriteKey,
} from "./assetDescriptors";
import {
  CompositeSpriteSource,
  ImageSpriteSource,
  ProceduralDrawer,
  ProceduralSpriteSource,
  SpriteSource,
} from "./assetSource";

export type { Drawable, ProceduralDrawer, SpriteSource } from "./assetSource";

export interface ResolvedSprite {
  drawable: HTMLImageElement | HTMLCanvasElement;
  descriptor: SpriteDescriptor;
  ready: boolean;
}

export class SpriteProvider {
  private readonly descriptorMap: Record<string, SpriteDescriptor>;

  constructor(
    private readonly source: SpriteSource,
    descriptors: readonly SpriteDescriptor[] = ALL_DESCRIPTORS
  ) {
    this.descriptorMap = {};
    for (const d of descriptors) this.descriptorMap[d.key] = d;
  }

  preload(): void {
    this.source.preload();
  }

  resolve(key: SpriteKey): ResolvedSprite | undefined {
    const descriptor = this.descriptorMap[key];
    if (!descriptor) return undefined;
    const r = this.source.resolve(key);
    if (!r) return undefined;
    return { drawable: r.drawable, descriptor, ready: r.ready };
  }
}

export function createDefaultProvider(
  proceduralDrawers: Record<string, ProceduralDrawer> = {}
): SpriteProvider {
  const imageUrls: Record<string, string> = {};
  const proceduralNaturalSizes: Record<string, number> = {};
  const proceduralKeys = new Set(Object.keys(proceduralDrawers));
  for (const d of ALL_DESCRIPTORS) {
    if (d.url === null) {
      proceduralNaturalSizes[d.key] = d.naturalSize ?? 32;
    } else if (!proceduralKeys.has(d.key)) {
      imageUrls[d.key] = d.url;
    }
  }

  const imageSource = new ImageSpriteSource(imageUrls);
  const proceduralSource = new ProceduralSpriteSource(
    proceduralDrawers,
    proceduralNaturalSizes
  );
  const composite = new CompositeSpriteSource([imageSource, proceduralSource]);
  return new SpriteProvider(composite);
}
