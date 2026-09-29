export const PLAYER_COLORS: readonly string[] = [
  "#d62828",
  "#1d7dd1",
  "#2a9d8f",
  "#f77f00",
  "#e9c46a",
  "#8338ec",
  "#ff006e",
  "#06a77d",
  "#118ab2",
  "#f5f5f5",
];

export const MAX_PLAYERS = PLAYER_COLORS.length;

export const PLAYER_FACTION_COLOR: string = "#cccccc";

export function colorForOwner(ownerId: number | null): string {
  if (ownerId === null || ownerId === undefined) return PLAYER_FACTION_COLOR;
  if (ownerId < 0 || ownerId >= PLAYER_COLORS.length) return PLAYER_FACTION_COLOR;
  return PLAYER_COLORS[ownerId];
}
