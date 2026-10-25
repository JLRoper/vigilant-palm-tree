import type { GameMode, PlayerId } from "@heroes/contracts";
import { coveredWagonIdFor, gameModeSettings, hexDistance } from "@heroes/contracts";
import type { GameMap, MapSize } from "../map/gameMap";
import { CURRENT_MAP_GEN_VERSION, getOrCreateGameMap } from "../map/gameMap";
import { EDGE_BUFFER } from "../map/castlePlacement";
import { isPassable } from "../map/terrain";
import { hashString, mulberry32 } from "../rng";

// Settlers start placement (SETTLERS-PLAN.md §2.3, §4 W2).
//
// The RNG stream is the constraint every draw here goes through: nothing in
// this file touches the map's, the castle placement's or the
// settlement-creation stream, because a draw added to any of those moves every
// existing seed's names, horse variants, city spots and castle positions,
// which test/engine/settlersMode.test.ts pins.
//
// A start is a COVERED WAGON hex, not a castle hex: in settlers mode the seats
// begin in the wilderness with a wagon, so this pass runs independently of
// map/castlePlacement.ts (whose output the mode only keeps for the neutrals).

/** The stream-key prefix; the whole key is `<prefix>:<seed>:<id>`. */
export const SETTLERS_STREAM_PREFIX = "settlers";

/**
 * The one key a settlers draw is seeded from. Exported so a caller (a test, a
 * log line, the client's debug panel) can reproduce a draw from its parts
 * instead of re-spelling the format.
 */
export function settlersStreamKey(seed: number, id: string): string {
  return `${SETTLERS_STREAM_PREFIX}:${seed}:${id}`;
}

/**
 * A settlers entity's OWN RNG stream:
 * `mulberry32(hashString("settlers:<seed>:<id>"))`.
 *
 * Per-entity and reproducible rather than one shared sequential cursor -- the
 * same discipline settlement/districtSeed.ts uses for startup districts, and
 * the reason a new settlers draw can never re-roll an existing map. The seed
 * is the game's map seed; `id` is the entity the draw belongs to (a seat, a
 * wagon, a start index), so two entities never share a stream and one entity
 * replays identically forever.
 */
export function settlersStreamRng(seed: number, id: string): () => number {
  return mulberry32(hashString(settlersStreamKey(seed, id)));
}

export interface SettlersStartRequest {
  /** The game's map seed -- NOT the castle seed, NOT a fresh random. */
  seed: number;
  size: MapSize;
  playerCount: number;
  humanSeatCount: number;
  /** The game's mode; the rule reads its keys via `gameModeSettings(mode)`. */
  mode: GameMode;
  /** Settlement/wagon hexes already on the board, so a start never lands on one. */
  occupied?: readonly { q: number; r: number }[];
  /**
   * The caller's already-built map (init.ts's seed pass holds it), so the
   * placements land on the terrain the game will actually be played on --
   * including a game created or reloaded at a stored MapGenVersion older than
   * CURRENT_MAP_GEN_VERSION. Absent, the request's seed/size rebuild the
   * current-version map instead (the cache makes that cheap).
   */
  map?: GameMap;
}

export interface SettlersStart {
  playerId: PlayerId;
  q: number;
  r: number;
  /** The stream this start's draw came from: `settlers:<seed>:<id>`. */
  streamId: string;
}

// A wagon starts inside the map's frame, exactly as a castle does (the same
// EDGE_BUFFER castlePlacement.ts filters its candidates with): a start two
// hexes from the border has nowhere to expand into.
const START_EDGE_BUFFER = EDGE_BUFFER;

/**
 * Every hex a wagon may start on, in a fixed row-major order: passable, not a
 * river tile, not a resource deposit -- the same candidate filter
 * castlePlacement.ts applies, for the same reasons (the terrain has to hold a
 * settlement later, and a wagon parked on a river tile is a wagon on water).
 */
function startCandidates(map: GameMap): { q: number; r: number }[] {
  const out: { q: number; r: number }[] = [];
  for (let r = START_EDGE_BUFFER; r < map.height - START_EDGE_BUFFER; r++) {
    for (let q = START_EDGE_BUFFER; q < map.width - START_EDGE_BUFFER; q++) {
      const tile = map.get(q, r);
      if (!tile || !isPassable(tile)) continue;
      if (map.riverAt(q, r)) continue;
      if (map.resourceTileAt(q, r)) continue;
      out.push({ q, r });
    }
  }
  return out;
}

/**
 * Place one starting wagon per seat. Deterministic: each seat's draw comes
 * from its OWN stream (`settlers:<mapSeed>:p<seat>-wagon`), and that stream is
 * consumed exactly once -- a single draw picks the offset into the candidate
 * list, from which the scan walks forward (with wraparound) to the first legal
 * hex. So a seat's start is reproducible from `(seed, seat)` alone, no matter
 * how many seats were placed before it, and re-running the pass for one more
 * seat never moves the seats already placed.
 *
 * A hex is legal when it is at least `minFoundingDistance` (the mode's own
 * spacing rule, so a start can always found where it stands) from every
 * already-placed start AND from every settlement already on the board --
 * the wilderness neutrals included, which is design answer 2's rule applied to
 * placement rather than only to founding.
 *
 * Throws when a seat cannot be placed at all, rather than returning a shorter
 * list or a plausible-looking duplicate: a game seeded without one wagon per
 * seat is not a settlers game.
 */
export function placeSettlersStarts(request: SettlersStartRequest): SettlersStart[] {
  const seats = Math.max(0, Math.floor(request.playerCount));
  const map =
    request.map ??
    getOrCreateGameMap(request.seed, request.size, CURRENT_MAP_GEN_VERSION);
  if (seats === 0) return [];

  // The mode's OWN spacing rule, read at the same boundary the founding rule
  // reads it at (found.ts skips the check when the constant is <= 0), so
  // flipping `minFoundingDistance` to 0 really does flip the start spacing to
  // zero here instead of being clamped back to 1 (W7 review, L2).
  const minDistance = Math.max(0, gameModeSettings(request.mode).minFoundingDistance);
  const blocked = request.occupied ?? [];
  const candidates = startCandidates(map);
  if (candidates.length === 0) {
    throw new Error(
      `settlers start placement: the ${map.width}x${map.height} map has no legal starting hex`,
    );
  }

  const placed: SettlersStart[] = [];
  for (let seat = 0; seat < seats; seat++) {
    const id = coveredWagonIdFor(seat);
    const rng = settlersStreamRng(request.seed, id);
    // Exactly one draw per seat: the scan offset. Keeping the stream's
    // consumption fixed makes a start a function of (seed, seat) alone.
    const offset = Math.floor(rng() * candidates.length);
    let chosen: { q: number; r: number } | undefined;
    for (let step = 0; step < candidates.length; step++) {
      const candidate = candidates[(offset + step) % candidates.length];
      const tooCloseToStart = placed.some(
        (s) => hexDistance({ q: s.q, r: s.r }, candidate) < minDistance,
      );
      if (tooCloseToStart) continue;
      const tooCloseToSettlement = blocked.some(
        (s) => hexDistance({ q: s.q, r: s.r }, candidate) < minDistance,
      );
      if (tooCloseToSettlement) continue;
      chosen = candidate;
      break;
    }
    if (!chosen) {
      throw new Error(
        `settlers start placement: no legal starting hex for seat ${seat} ` +
          `(${placed.length} placed, min spacing ${minDistance})`,
      );
    }
    placed.push({
      playerId: seat,
      q: chosen.q,
      r: chosen.r,
      streamId: settlersStreamKey(request.seed, id),
    });
  }
  return placed;
}
