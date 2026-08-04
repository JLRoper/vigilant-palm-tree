// Shared shape for static per-faction unit roster data (src/factions/<faction>/*).
// This is design-time roster data, distinct from the server-driven `UnitType`
// in state/units.ts (health/no movement stat) — it adds hp/walkDistance and a
// bundled unit image so each faction's units are fully self-described.
export interface FactionUnit {
  id: string;
  name: string;
  description: string;
  hp: number;
  attack: number;
  defence: number;
  speed: number;
  walkDistance: number;
  image: string;
}
