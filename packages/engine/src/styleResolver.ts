import type { BuildingKind, GenerationStyle } from "@heroes/contracts";
import { BUILDING_SPRITE_KEYS } from "./generated/buildingSpriteKeys";

// Generated from the building-pixel-*.png files on disk (see
// tools/sprites/gen-building-sprite-keys.mjs); re-exported so @heroes/engine
// keeps exposing the name it always has.
export { BUILDING_SPRITE_KEYS };

const BUILDING_SPRITE_KEY_SET = new Set<string>(BUILDING_SPRITE_KEYS);

export function pickStyleForBuilding(
  kind: BuildingKind | string,
  level: number,
  preferred: GenerationStyle | string | undefined,
): GenerationStyle {
  const preferredKey = `${preferred ?? "pixel"}.${kind}.${level}`;
  if (BUILDING_SPRITE_KEY_SET.has(preferredKey)) return (preferred ?? "pixel") as GenerationStyle;

  // Fall-through: the style that actually has art for this kind+level.
  // Deliberately order-independent — `pixel-alt` (the farm-plot alternate) is
  // reachable only through an explicit style carrier, never through this
  // fall-through, so the generated/sorted key list can never promote it to a
  // preferred style. Same conclusion the old first-match-wins scan reached only
  // because pixel.* happened to precede pixel-alt.* in the hand-written array.
  const suffix = `.${kind}.${level}`;
  let altStyle: GenerationStyle | null = null;
  for (const key of BUILDING_SPRITE_KEYS) {
    if (!key.endsWith(suffix)) continue;
    const middle = key.slice(0, key.length - suffix.length);
    if (!middle || middle.includes(".")) continue;
    if (middle !== "pixel-alt") return middle as GenerationStyle;
    altStyle ??= middle as GenerationStyle;
  }
  return altStyle ?? ((preferred ?? "pixel") as GenerationStyle);
}

export function randomFarmFieldStyle(): GenerationStyle {
  return (Math.random() < 0.5 ? "pixel" : "pixel-alt") as GenerationStyle;
}

export function farmFieldStyleAt(seed: string, gx: number, gy: number): GenerationStyle {
  let h = 2166136261;
  const s = `${seed}:${gx},${gy}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 2 === 0 ? "pixel" : "pixel-alt") as GenerationStyle;
}

/**
 * The style a building is persisted with when none was sent: the server's
 * settlement_buildings.style column is NOT NULL until the deferred column
 * drop, so an absent style is resolved here rather than written NULL. Only
 * fires for an absent key -- a persisted value is never rewritten, because
 * several round-trip pins watch those bytes.
 */
export function resolvedPersistedStyle(
  settlementName: string,
  b: { kind: BuildingKind | string; level: number; style?: GenerationStyle; gx: number; gy: number },
): GenerationStyle {
  if (b.kind === "farmField") return farmFieldStyleAt(settlementName, b.gx, b.gy);
  return pickStyleForBuilding(b.kind, b.level, b.style);
}
