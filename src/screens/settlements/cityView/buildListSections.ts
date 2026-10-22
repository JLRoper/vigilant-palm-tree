import type { BuildingKind, FactionId } from "@heroes/contracts";
import { buildingAllowedForFaction, getBuildingEffect, isProducerKind } from "@heroes/engine";

export const BUILDABLE_KINDS: readonly BuildingKind[] = [
  "townHall", "house",
  "goldMine", "woodcutterHut", "stoneMine", "ironMine", "arcaneFont",
  "tower", "archeryRange", "barracks", "smithy", "market", "mageGuild",
  "apartment", "farmField", "farmhouse", "granary", "warehouse", "bank", "treasury",
  "stables", "huntingLodge", "eyrie", "shipyard",
  "blackChapel", "dragonBoneyard", "delversHall", "hearthTemple", "ramPens", "seedlingGrove", "druidCircle",
  "crypt", "ossuary", "wraithBarrows", "spireOfAsh",
  "forgeHall", "gunnersRedoubt", "golemFoundry", "deepAnvil",
  "groveSanctum", "warrenLodge", "sylvanStables", "worldrootGrove",
];

export const BUILD_LIST_SECTION_TITLES = ["Troop Buildings", "Production", "Civilian"] as const;

export interface BuildListSection {
  title: string;
  kinds: BuildingKind[];
}

export function buildListSections(factionId?: FactionId): BuildListSection[] {
  const troop: BuildingKind[] = [];
  const production: BuildingKind[] = [];
  const civilian: BuildingKind[] = [];
  for (const kind of BUILDABLE_KINDS) {
    if (!buildingAllowedForFaction(kind, factionId)) continue;
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
