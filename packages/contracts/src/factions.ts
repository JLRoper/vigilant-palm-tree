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

// The per-faction economy table (the roster-faction identity's only gameplay
// field). Every entry is a PERCENTAGE modifier, applied by ONE seam
// (`economy/factionEconomy.ts`) to the output of the buildings the key names:
// `goldPct` scales what the 18 shared buildings pay in gold, and each resource
// key scales that resource's yield. Absent/0 is exactly neutral -- the
// multiplier the seam produces is exactly 1, so a faction with no entry, a
// legacy seat with no factionId, and every pre-existing test all pay the
// numbers they paid before. The percentages are never applied to building
// costs, build times, unit upkeep or combat statistics.
export interface FactionEconomyModifier {
  goldPct?: number;
  foodPct?: number;
  woodPct?: number;
  stonePct?: number;
  ironPct?: number;
  arcanePct?: number;
}

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
  /**
   * The faction's economy modifier. Optional by design: the "human" baseline
   * and "neutral" deliberately carry no entry at all, which is what makes
   * "absent = neutral" the type-level default rather than a table of zeros.
   */
  economy?: FactionEconomyModifier;
}