import type { BuildingKind, GenerationStyle } from "@heroes/contracts";

export const BUILDING_SPRITE_KEYS: readonly string[] = [
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
  "pixel.woodcutterHut.1",
  "pixel.woodcutterHut.2",
  "pixel.woodcutterHut.3",
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
  "pixel.groveSanctum.2",
  "pixel.groveSanctum.3",
  "pixel.warrenLodge.1",
  "pixel.warrenLodge.2",
  "pixel.warrenLodge.3",
  "pixel.sylvanStables.1",
  "pixel.sylvanStables.2",
  "pixel.sylvanStables.3",
  "pixel.worldrootGrove.1",
  "pixel.worldrootGrove.3",
  "pixel.farmField.1",
  "pixel.farmField.2",
  "pixel.farmField.3",
  "pixel-alt.farmField.1",
  "pixel-alt.farmField.2",
  "pixel-alt.farmField.3",
  "pixel.townHall.1",
  "pixel.townHall.2",
  "pixel.townHall.3",
  "pixel.house.1",
  "pixel.house.2",
  "pixel.house.3",
  "pixel.tower.1",
  "pixel.tower.2",
  "pixel.tower.3",
  "pixel.mageGuild.1",
  "pixel.mageGuild.2",
  "pixel.mageGuild.3",
  "pixel.market.1",
  "pixel.market.2",
  "pixel.market.3",
  "pixel.barracks.1",
  "pixel.barracks.2",
  "pixel.barracks.3",
  "pixel.smithy.1",
  "pixel.smithy.3",
  "pixel.apartment.1",
  "pixel.apartment.2",
  "pixel.apartment.3",
  "pixel.farmhouse.1",
  "pixel.farmhouse.2",
  "pixel.farmhouse.3",
  "pixel.archeryRange.1",
  "pixel.archeryRange.2",
  "pixel.archeryRange.3",
  "pixel.stables.1",
  "pixel.stables.2",
  "pixel.stables.3",
  "pixel.huntingLodge.1",
  "pixel.huntingLodge.2",
  "pixel.huntingLodge.3",
  "pixel.eyrie.1",
  "pixel.eyrie.2",
  "pixel.eyrie.3",
  "pixel.arcaneFont.1",
  "pixel.arcaneFont.2",
  "pixel.arcaneFont.3",
  "pixel.crypt.2",
  "pixel.gunnersRedoubt.2",
  "pixel.worldrootGrove.2",
  "pixel.mine.1",
  "pixel.mine.2",
  "pixel.mine.3",
] as const;

const BUILDING_SPRITE_KEY_SET = new Set<string>(BUILDING_SPRITE_KEYS);

export function pickStyleForBuilding(
  kind: BuildingKind | string,
  level: number,
  preferred: GenerationStyle | string | undefined,
): GenerationStyle {
  const preferredKey = `${preferred ?? "pixel"}.${kind}.${level}`;
  if (BUILDING_SPRITE_KEY_SET.has(preferredKey)) return (preferred ?? "pixel") as GenerationStyle;

  const suffix = `.${kind}.${level}`;
  for (const key of BUILDING_SPRITE_KEYS) {
    if (key.endsWith(suffix)) {
      const middle = key.slice(0, key.length - suffix.length);
      if (middle && !middle.includes(".")) return middle as GenerationStyle;
    }
  }
  return (preferred ?? "pixel") as GenerationStyle;
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
