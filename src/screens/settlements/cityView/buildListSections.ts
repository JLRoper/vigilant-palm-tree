import type { BuildingKind } from "@heroes/contracts";
import { getBuildingEffect, isProducerKind } from "@heroes/engine";

export const BUILDABLE_KINDS: readonly BuildingKind[] = [
  "townHall", "house",
  "goldMine", "woodcutterHut", "stoneMine", "ironMine", "arcaneFont",
  "tower", "archeryRange", "barracks", "smithy", "market", "mageGuild",
  "apartment", "farmField", "farmhouse", "granary", "warehouse", "bank", "treasury",
  "stables", "huntingLodge", "eyrie",
  "crypt", "ossuary", "wraithBarrows", "spireOfAsh",
  "forgeHall", "gunnersRedoubt", "golemFoundry", "deepAnvil",
];

export const BUILD_LIST_SECTION_TITLES = ["Troop Buildings", "Production", "Civilian"] as const;

export interface BuildListSection {
  title: string;
  kinds: BuildingKind[];
}

export function buildListSections(): BuildListSection[] {
  const troop: BuildingKind[] = [];
  const production: BuildingKind[] = [];
  const civilian: BuildingKind[] = [];
  for (const kind of BUILDABLE_KINDS) {
    if (getBuildingEffect(kind).recruits.length > 0) troop.push(kind);
    else if (isProducerKind(kind)) production.push(kind);
    else civilian.push(kind);
  }
  return [
    { title: BUILD_LIST_SECTION_TITLES[0], kinds: troop },
    { title: BUILD_LIST_SECTION_TITLES[1], kinds: production },
    { title: BUILD_LIST_SECTION_TITLES[2], kinds: civilian },
  ];
}
