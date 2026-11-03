import type { GameLobbyState } from "../io/api";

// Which seat does THIS browser hold? The games row's `lobby.claimed` map says
// which seats are claimed and by whom (src/io/api.ts:38: `{ handle, email?,
// claimedAt }`), but it is keyed by seat index -- it cannot say which entry is
// ours. The load path used to take its FIRST entry
// (`Object.keys(claimed).find((k) => claimed[k])`), so with seats 0 and 1 both
// claimed a browser holding seat 1 took seat 0: the one resolved value feeds
// BOTH the local player id and the load camera, so it also centred on seat 0's
// wagon.
//
// The browser's own seat is resolved from what the browser knows about itself,
// in this order:
//
//   1. remembered -- the seat it claimed for this game (localStorage, written
//      by the multiplayer lobby when the claim is made).
//   2. handle     -- the handle it claimed with, matched against the claims.
//   3. email      -- the signed-in email the server bound the claim to
//      (server/routes.ts derives it from the request's auth, never the client).
//
// A remembered seat is trusted only while the server still has that seat
// claimed: a stale entry (a re-created game, a wiped lobby) must not assert a
// seat the server does not back, so it falls through to the identity legs.
//
// The honest fallback, when none of the three identifies the browser, is NO
// seat at all (`source: "unknown"`, `seat: null`): a browser holding a seat and
// a spectator holding none are indistinguishable from the claim map alone, and
// falling back to the first (or only) claimed seat is the bug merely narrowed.
// Callers must then assert nothing -- the local player id stays unset and the
// camera centres the map rather than another seat's wagon. What this cannot
// distinguish, stated plainly: an anonymous joiner on a browser with no
// remembered seat, and two seats claimed under one handle.
//
// A game with no claims at all is seat 0 (`source: "sole-seat"`): it has no
// seat assignments to match, and seat 0 is the only seat it can have -- every
// classic/solo game, and a lobby nobody has claimed yet (the host claims seat 0
// as it creates one). That is a rule, not a guess, and it keeps the classic
// load path unchanged.

export type ClaimedSeat = NonNullable<GameLobbyState["claimed"]>[string];
export type ClaimedSeatMap = NonNullable<GameLobbyState["claimed"]>;

export type LocalSeatSource = "remembered" | "handle" | "email" | "sole-seat" | "unknown";

export interface LocalSeatIdentity {
  /** The seat this browser claimed for this game, as it remembers it. */
  rememberedSeat?: number | null;
  /** The handle this browser claimed with. */
  handle?: string | null;
  /** The signed-in email (server-derived auth identity). */
  email?: string | null;
}

export interface ResolvedLocalSeat {
  seat: number | null;
  /** How the seat was resolved -- surfaced so a fallback cannot hide. */
  source: LocalSeatSource;
}

function normalize(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

/** The claimed seats, ascending. Non-index keys and falsy entries are not seats. */
function claimedSeatIndices(claimed: ClaimedSeatMap | undefined): number[] {
  const seats: number[] = [];
  for (const key of Object.keys(claimed ?? {})) {
    if (!/^\d+$/.test(key)) continue;
    if (!claimed?.[key]) continue;
    seats.push(Number(key));
  }
  return seats.sort((a, b) => a - b);
}

export function resolveLocalSeat(
  claimed: ClaimedSeatMap | undefined,
  identity: LocalSeatIdentity = {},
): ResolvedLocalSeat {
  const seats = claimedSeatIndices(claimed);
  if (seats.length === 0) return { seat: 0, source: "sole-seat" };

  const remembered = identity.rememberedSeat ?? null;
  if (remembered !== null && Number.isInteger(remembered) && seats.includes(remembered)) {
    return { seat: remembered, source: "remembered" };
  }

  const handle = normalize(identity.handle);
  if (handle !== null) {
    const matches = seats.filter((seat) => normalize(claimed?.[String(seat)]?.handle) === handle);
    if (matches.length === 1) return { seat: matches[0], source: "handle" };
  }

  const email = normalize(identity.email);
  if (email !== null) {
    const matches = seats.filter((seat) => normalize(claimed?.[String(seat)]?.email) === email);
    if (matches.length === 1) return { seat: matches[0], source: "email" };
  }

  return { seat: null, source: "unknown" };
}
