export type Terrain = "grass" | "dirt" | "water" | "forest";

export const TERRAIN_COLORS: Record<Terrain, { fill: string; stroke: string }> = {
  grass: { fill: "#3a6b3a", stroke: "#2a4a2a" },
  dirt: { fill: "#8a6b3a", stroke: "#5a4a2a" },
  water: { fill: "#2a5a8a", stroke: "#1a3a5a" },
  forest: { fill: "#1f4a2a", stroke: "#0f2a1a" },
};

export const TERRAIN_COST: Record<Terrain, number> = {
  grass: 1,
  dirt: 1.2,
  forest: 1.6,
  water: Infinity,
};
