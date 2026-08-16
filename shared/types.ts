export type Axial = { q: number; r: number };

export function axialRound(qf: number, rf: number): Axial {
  const sf = -qf - rf;
  let q = Math.round(qf);
  let r = Math.round(rf);
  const s = Math.round(sf);
  const dq = Math.abs(q - qf);
  const dr = Math.abs(r - rf);
  const ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return { q, r };
}

export function hexDistance(a: Axial, b: Axial): number {
  return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
}

// The six axial neighbour offsets, in edge order — mirrors src/core/hex.ts's
// copy (kept separate so shared/ never imports from src/, per
// dependency-cruiser.cjs's no-shared-from-src-or-server rule).
export const HEX_DIRECTIONS: readonly Axial[] = [
  { q: 1, r: 0 },
  { q: 0, r: 1 },
  { q: -1, r: 1 },
  { q: -1, r: 0 },
  { q: 0, r: -1 },
  { q: 1, r: -1 },
];

export type ResourceType = "gold" | "wood" | "stone" | "iron" | "arcane" | "food";

export type PlayerId = number;
export type Faction = "player" | "ai";
export type HeroId = string;
export type SettlementId = string;
export type CharterId = string;

export type CastleLevel = 1 | 2 | 3;
export type CastleVariant = 0 | 1;

export type BuildingKind =
  | "townHall"
  | "house"
  | "tower"
  | "mageGuild"
  | "mine"
  | "market"
  | "barracks"
  | "smithy"
  | "apartment"
  | "farmField"
  | "farmhouse"
  | "archeryRange"
  | "granary";

export type GenerationStyle = "classic" | "blocky" | "crystalline" | "organic" | "industrial";

export interface BuildingDef {
  gx: number;
  gy: number;
  kind: BuildingKind;
  level: number;
  style: GenerationStyle;
  w?: number;
  h?: number;
}
