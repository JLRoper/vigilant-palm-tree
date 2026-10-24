import type { GameMode, PlayerId } from "@heroes/contracts";
import type { MapSize } from "../map/gameMap";
import { hashString, mulberry32 } from "../rng";

// Settlers start placement (SETTLERS-PLAN.md §2.3, §4 W2).
//
// Phase 0 lands the SEAM only: the RNG stream is real (it is the constraint
// every later phase draws through), the placement rule is a signature-only
// stub that throws. Nothing here may draw from the map's, the castle
// placement's or the settlement-creation stream -- a draw added to any of
// those moves every existing seed's names, horse variants, city spots and
// castle positions, which test/engine/settlersMode.test.ts pins.

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
}

export interface SettlersStart {
  playerId: PlayerId;
  q: number;
  r: number;
  /** The stream this start's draw came from: `settlers:<seed>:<id>`. */
  streamId: string;
}

/**
 * Place one starting wagon per seat. Signature-only in phase 0 (phase 1 fills
 * it in): it throws rather than returning a plausible-looking placement, so a
 * caller that has not been wired to the real rule fails loudly instead of
 * seeding a game on invented starts.
 */
export function placeSettlersStarts(request: SettlersStartRequest): SettlersStart[] {
  void request;
  throw new Error(
    "settlers start placement is not implemented yet (phase 0 is signature-only -- SETTLERS-PLAN.md §5)",
  );
}
