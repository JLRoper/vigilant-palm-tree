export const BUILDING_STYLE_REGISTRY = [
  { id: "classic",     label: "Classic Fantasy" },
  { id: "blocky",      label: "Blocky Pixel" },
  { id: "crystalline", label: "Crystalline Elven" },
  { id: "organic",     label: "Organic Wooden" },
  { id: "industrial",  label: "Industrial Dwarven" },
] as const;

export type BuildingStyleId = (typeof BUILDING_STYLE_REGISTRY)[number]["id"];

export const STYLE_IDS = BUILDING_STYLE_REGISTRY.map((s) => s.id);
