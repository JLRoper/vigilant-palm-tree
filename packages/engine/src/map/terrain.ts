export type Terrain = "grass" | "dirt" | "water" | "forest" | "desert" | "mountain" | "swamp" | "snow";

export const TERRAIN_COLORS: Record<Terrain, { fill: string; stroke: string }> = {
  grass: { fill: "#3a6b3a", stroke: "#2a4a2a" },
  dirt: { fill: "#8a6b3a", stroke: "#5a4a2a" },
  water: { fill: "#2a5a8a", stroke: "#1a3a5a" },
  forest: { fill: "#1f4a2a", stroke: "#0f2a1a" },
  desert: { fill: "#d4b56e", stroke: "#a08850" },
  mountain: { fill: "#6e6e7a", stroke: "#3a3a44" },
  swamp: { fill: "#4a5540", stroke: "#2a3320" },
  snow: { fill: "#c9d6e4", stroke: "#8fa6bd" },
};

export const TERRAIN_COST: Record<Terrain, number> = {
  grass: 1,
  dirt: 1,
  forest: 1.2,
  water: Infinity,
  desert: 1.4,
  mountain: Infinity,
  swamp: 2,
  snow: 2,
};

export function isPassable(terrain: Terrain): boolean {
  return TERRAIN_COST[terrain] !== Infinity;
}
