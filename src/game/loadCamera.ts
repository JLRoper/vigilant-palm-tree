import {
  coveredWagonIdFor,
  seatHeroIdFor,
  type GameState,
  type HeroId,
  type HeroState,
  type SettlementState,
} from "@heroes/contracts";

/**
 * Where a freshly loaded game's camera lands (F6 of playthrough round 2b).
 *
 * The load path used to centre on `getHero(playerHeroId())` -- literally the id
 * `p0-hero` -- with a `?? { q: 6, r: 5 }` fallback. That is the classic mode's
 * castle-less spawn constant, and `p0-hero` does not exist in a settlers game:
 * an unfounded seat's entity is its covered wagon, `p<seat>-wagon`, so the
 * fallback fired, the map opened centred on a hex the seat has never seen
 * (measured: `__gameDebug.screenFor(6, 5)` at exactly the viewport centre, the
 * seat's own wagon at `screenFor(4, 21)` off the bottom of a 1000px viewport)
 * and the player had to pan to find their own wagon.
 *
 * So the camera keys off what the LOADED GAME actually has, in this order:
 *
 *   1. `wagon`       -- the seat's covered wagon (`p<seat>-wagon`), the only
 *                       entity an unfounded seat owns; it is also what reveals
 *                       that seat's first fog, so centring on it guarantees at
 *                       least one visible tile.
 *   2. `seat-hero`   -- `p<seat>-hero`: a classic game's commander, and the id
 *                       a founding wagon CONVERTS to (contracts'
 *                       `coveredWagonHeroIdFor`), so a founded settlers seat
 *                       resolves here. This is the step the classic load path
 *                       already took, unchanged.
 *   3. `seat-hero`   -- any other hero the seat owns (a recruited `h<n>`),
 *                       chosen in sorted-id order so the camera is
 *                       deterministic. This is the second net: it catches a
 *                       seat whose units follow neither id convention.
 *   4. `settlement`  -- a settlement the seat owns, for a seat whose units are
 *                       gone (its starting area).
 *   5. `map-centre`  -- the map's own centre, the same place
 *                       `AdventureView.centerOnMap()` puts the camera. This is
 *                       the documented fallback for a game that genuinely has
 *                       nothing to centre on (no unit, no settlement), and it
 *                       is deliberately NOT the classic spawn constant: that
 *                       constant is a claim about a classic game's castle
 *                       placement, which a mode without castles does not make.
 */
export type LoadCameraSource = "wagon" | "seat-hero" | "settlement" | "map-centre";

export interface LoadCameraCenter {
  q: number;
  r: number;
  /** What the camera keyed off — surfaced so a fallback cannot hide. */
  source: LoadCameraSource;
}

export interface LoadCameraMapSize {
  width: number;
  height: number;
}

function ownsHero(hero: HeroState | undefined, seat: number): boolean {
  return hero !== undefined && hero.ownerId === seat;
}

function firstOwnedHero(heroes: Record<HeroId, HeroState>, seat: number): HeroState | undefined {
  for (const id of Object.keys(heroes).sort()) {
    if (ownsHero(heroes[id], seat)) return heroes[id];
  }
  return undefined;
}

function firstOwnedSettlement(
  settlements: Record<string, SettlementState>,
  seat: number,
): SettlementState | undefined {
  for (const id of Object.keys(settlements).sort()) {
    const settlement = settlements[id];
    if (settlement && settlement.ownerId === seat) return settlement;
  }
  return undefined;
}

export function resolveLoadCameraCenter(
  state: Pick<GameState, "heroes" | "settlements">,
  seat: number,
  map: LoadCameraMapSize,
): LoadCameraCenter {
  if (Number.isInteger(seat) && seat >= 0) {
    const wagon = state.heroes[coveredWagonIdFor(seat)];
    if (wagon) return { q: wagon.q, r: wagon.r, source: "wagon" };

    const commander = state.heroes[seatHeroIdFor(seat)];
    if (commander) return { q: commander.q, r: commander.r, source: "seat-hero" };
  }

  const ownHero = firstOwnedHero(state.heroes, seat);
  if (ownHero) return { q: ownHero.q, r: ownHero.r, source: "seat-hero" };

  const ownSettlement = firstOwnedSettlement(state.settlements, seat);
  if (ownSettlement) return { q: ownSettlement.q, r: ownSettlement.r, source: "settlement" };

  // Nothing of this seat's is on the board: centre the map (the same formula
  // AdventureView.centerOnMap uses) rather than a mode-specific spawn guess.
  return { q: (map.width - 1) / 2, r: (map.height - 1) / 2, source: "map-centre" };
}
