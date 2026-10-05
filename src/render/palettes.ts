import type { ResourceType } from "../map/resourceTiles";

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
  food:   { stone:"#8a7a4a", stoneDk:"#4a3a20", stoneHi:"#c8b888", outline:"#121008", rune:"#f0c040", glow:"#ffe880" },
};
