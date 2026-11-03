// Seat factions for the seats a creator did not assign: an AI seat takes a
// roster faction drawn DETERMINISTICALLY from the game seed, so a single-player
// game can meet the Ashen Court, the Ironmark Holds and the Verdant Wild
// instead of every AI seat being pinned to "human".
//
// The draw is a seeded permutation of the seat-pickable factions, keyed by a
// per-purpose FNV-1a hash of `seat-factions:<seed>` -- the repo's standing
// seeded-draw pattern (map/resourceTiles.ts, settlement/citySpots.ts), never
// Math.random -- and it spends no draw of any shared rng, so it cannot move an
// existing seed's settlement names, horse variants, city spots or castle
// positions. Human seats are never touched: the creator's own pick arrives as
// an explicit entry and wins at its seat.
import type { FactionId } from "@heroes/contracts";
import { FACTION_REGISTRY } from "./factionRegistry";
import { hashString, mulberry32 } from "./rng";

/**
 * Every faction a seat can be given: the registry factions with a shipped
 * roster. The same rule the New Game picker uses
 * (src/screens/shared/factionChoices.ts) -- "neutral" is catalog-only wild
 * creatures that no building offers, so it is never a seat.
 */
export const SEAT_FACTION_IDS: readonly FactionId[] = Object.values(FACTION_REGISTRY)
  .filter((f) => f.id !== "neutral" && f.roster.length > 0)
  .map((f) => f.id);

/**
 * The roster factions this seed's AI seats take, in seat order (the first AI
 * seat first).
 *
 * A seeded Fisher-Yates over SEAT_FACTION_IDS, so the result is deterministic
 * for a given seed AND varied by construction: two AI seats can never draw the
 * same faction, which is what guarantees a default single-player game meets at
 * least one faction other than "human" rather than only on most seeds. A game
 * with more AI seats than there are factions wraps around rather than dropping
 * a seat.
 */
export function aiSeatFactions(seed: number, count: number): FactionId[] {
  const pool: FactionId[] = [...SEAT_FACTION_IDS];
  const rng = mulberry32(hashString(`seat-factions:${seed >>> 0}`));
  const out: FactionId[] = [];
  for (let i = 0; i < Math.max(0, Math.floor(count)); i++) {
    if (pool.length === 0) pool.push(...SEAT_FACTION_IDS);
    const pick = Math.min(pool.length - 1, Math.floor(rng() * pool.length));
    out.push(pool.splice(pick, 1)[0] ?? "human");
  }
  return out;
}
