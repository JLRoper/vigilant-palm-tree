import type { BuildingKind, GenerationStyle } from "@heroes/contracts";

export const BUILDING_SPRITE_KEYS: readonly string[] = [
  "classic.apartment.1",
  "classic.archeryRange.1",
  "classic.barracks.1",
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
  "pixel.bank.1",
  "pixel.bank.2",
  "pixel.bank.3",
  "pixel.treasury.1",
  "pixel.treasury.2",
  "pixel.treasury.3",
  "pixel.warehouse.1",
  "pixel.warehouse.2",
  "pixel.warehouse.3",
  "pixel.goldMine.1",
  "pixel.goldMine.2",
  "pixel.goldMine.3",
  "pixel.stoneMine.1",
  "pixel.stoneMine.2",
  "pixel.stoneMine.3",
  "pixel.ironMine.1",
  "pixel.ironMine.2",
  "pixel.ironMine.3",
  "pixel.crypt.1",
  "pixel.crypt.3",
  "pixel.ossuary.1",
  "pixel.ossuary.2",
  "pixel.ossuary.3",
  "pixel.wraithBarrows.1",
  "pixel.wraithBarrows.2",
  "pixel.wraithBarrows.3",
  "pixel.spireOfAsh.1",
  "pixel.spireOfAsh.2",
  "pixel.spireOfAsh.3",
  "pixel.underConstruction.1",
  "pixel.underConstruction.2",
  "pixel.underConstruction.3",
  "pixel.woodcutterHut.1",
  "pixel.woodcutterHut.2",
  "pixel.woodcutterHut.3",
  "pixel.smithy.2",
  "pixel.forgeHall.1",
  "pixel.forgeHall.2",
  "pixel.forgeHall.3",
  "pixel.gunnersRedoubt.1",
  "pixel.gunnersRedoubt.3",
  "pixel.golemFoundry.1",
  "pixel.golemFoundry.2",
  "pixel.golemFoundry.3",
  "pixel.deepAnvil.1",
  "pixel.deepAnvil.2",
  "pixel.deepAnvil.3",
  "pixel.groveSanctum.1",
  "pixel.warrenLodge.1",
  "pixel.sylvanStables.1",
  "pixel.worldrootGrove.1",
  "pixel.farmField.1",
  "pixel.farmField.2",
  "pixel.farmField.3",
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
