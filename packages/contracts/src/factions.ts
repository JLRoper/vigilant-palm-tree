// Roster factions — the game-design meaning of "faction", deliberately named
// FactionId because Faction is already taken twice: the seat faction
// "player"|"ai" (ids.ts) drives turn order and the server AI driver, and the
// render faction "player"|"enemy" (src/entities/hero.ts) picks sprite art.
// This union is the unit-roster / banner identity: which faction's catalog a
// unit belongs to (unit_types.faction_id) and which faction a seat plays
// (Player.factionId).
//
// Mirrors HorseVariantId in ids.ts as an independent literal union (not
// derived from any registry) so contracts stays a zero-dependency leaf. The
// registry itself (labels, mottos, palettes, rosters) is catalog data that
// lives in @heroes/engine's factionRegistry.ts.
export type FactionId = "human" | "ashen" | "ironmark" | "verdant" | "neutral";

// The shape each FACTION_REGISTRY entry carries. `palette` feeds the
// faction-picker UI and any future per-faction theming; `roster` lists unit
// ids and is the single source the parity test checks the DB column against.
// "neutral" is the fail-safe bucket for wild creatures (today the four
// monsters): recruitable by nobody, not a seat choice.
export interface FactionDef {
  id: FactionId;
  label: string;
  motto: string;
  description: string;
  palette: { primary: string; secondary: string; accent: string };
  roster: readonly string[];
}