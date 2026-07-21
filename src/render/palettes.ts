import type { ResourceType } from "../map/resourceTiles";

export type GenerationStyle =
  | "classic"
  | "blocky"
  | "crystalline"
  | "organic"
  | "industrial";

export type ResourcePalette = {
  stone: string;
  stoneDk: string;
  stoneHi: string;
  outline: string;
  rune: string;
  glow: string;
};

export const RESOURCE_PAL: Record<ResourceType, ResourcePalette> = {
  gold:   { stone:"#c8a868", stoneDk:"#7a5a30", stoneHi:"#ecd49a", outline:"#1a1208", rune:"#ffd84a", glow:"#fff200" },
  wood:   { stone:"#8aa66c", stoneDk:"#4a5a30", stoneHi:"#b8c898", outline:"#10180a", rune:"#a8e860", glow:"#e8ffb0" },
  stone:  { stone:"#a8a8a0", stoneDk:"#585850", stoneHi:"#d0d0c8", outline:"#101010", rune:"#e8e8e0", glow:"#ffffff" },
  iron:   { stone:"#787886", stoneDk:"#383848", stoneHi:"#a0a0b0", outline:"#0a0a0e", rune:"#e87a5a", glow:"#ffb070" },
  arcane: { stone:"#5a4878", stoneDk:"#2a1838", stoneHi:"#8870a0", outline:"#08040a", rune:"#d098ff", glow:"#f8d8ff" },
};

export interface BuildingPalette {
  wood?: string;
  woodDk?: string;
  woodLt?: string;
  soil?: string;
  soilDk?: string;
  crop?: string;
  cropDk?: string;
  stoneLt?: string;
  stoneMd?: string;
  stoneDk?: string;
  fence?: string;
  furrow?: string;
  roof?: string;
  accent?: string;
}

export const BUILDING_PALETTES: Record<GenerationStyle, BuildingPalette> = {
  organic: {
    wood:    "#8B6914",
    woodLt:  "#A0522D",
    woodDk:  "#5C4A1E",
    soil:    "#5a3d22",
    soilDk:  "#47301a",
    crop:    "#7cb342",
    cropDk:  "#558b2f",
    fence:   "#6d5023",
    furrow:  "#3a2814",
    accent:  "#d9a521",
  },
  classic: {
    stoneLt: "#a89880",
    stoneMd: "#8a7a68",
    stoneDk: "#5a4a38",
    roof:    "#3a2818",
    accent:  "#d4c4a0",
  },
  blocky: {
    stoneLt: "#9090a8",
    stoneMd: "#686888",
    stoneDk: "#404058",
    roof:    "#181828",
    accent:  "#a0a0d0",
  },
  crystalline: {
    stoneLt: "#b0a8d8",
    stoneMd: "#7868a8",
    stoneDk: "#483878",
    roof:    "#2020a0",
    accent:  "#d0c8f8",
  },
  industrial: {
    stoneLt: "#666666",
    stoneMd: "#555555",
    stoneDk: "#3a3a3a",
    roof:    "#222222",
    accent:  "#884400",
  },
};
