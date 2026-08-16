import type { BuildingKind, GenerationStyle } from "@heroes/contracts";

export const BUILDING_SPRITE_KEYS: readonly string[] = [
  "classic.apartment.1",
  "classic.archeryRange.1",
  "classic.barracks.1",
  "classic.farmField.1",
  "classic.farmField.1_variant2",
  "classic.farmhouse.1",
  "classic.house.1",
  "classic.house.2",
  "classic.mageGuild.1",
  "classic.market.1",
  "classic.market.1_variant2",
  "classic.market.1_variant3",
  "classic.market.1_variant4",
  "classic.market.1_variant5",
  "classic.market.2",
  "classic.mine.1",
  "classic.smithy.1",
  "classic.smithy.2",
  "classic.tower.1",
  "classic.tower.2",
  "classic.townHall.1",
  "classic.townHall.2",
  "blocky.archeryRange.1",
  "blocky.house.2",
  "pixel.granary.1",
  "pixel.granary.2",
  "pixel.granary.3",
  "pixel.smithy.2",
] as const;

const BUILDING_SPRITE_KEY_SET = new Set<string>(BUILDING_SPRITE_KEYS);

export function hasBuildingSpriteKey(key: string): boolean {
  return BUILDING_SPRITE_KEY_SET.has(key);
}

export function pickStyleForBuilding(
  kind: BuildingKind | string,
  level: number,
  preferred: GenerationStyle | string,
): GenerationStyle {
  const preferredKey = `${preferred}.${kind}.${level}`;
  if (BUILDING_SPRITE_KEY_SET.has(preferredKey)) return preferred as GenerationStyle;

  const suffix = `.${kind}.${level}`;
  for (const key of BUILDING_SPRITE_KEYS) {
    if (key.endsWith(suffix)) {
      const middle = key.slice(0, key.length - suffix.length);
      if (middle && !middle.includes(".")) return middle as GenerationStyle;
    }
  }
  return preferred as GenerationStyle;
}
