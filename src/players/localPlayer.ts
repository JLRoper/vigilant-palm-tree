import type { PlayerId } from "@heroes/contracts";

const STORAGE_PREFIX = "heroes.mp.localPlayerId.";

export function getLocalPlayerId(gameName: string): PlayerId | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + gameName);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isInteger(n) ? n : null;
  } catch {
    return null;
  }
}

export function setLocalPlayerId(gameName: string, id: PlayerId): void {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + gameName, String(id));
  } catch {
    // localStorage may be disabled; the in-memory caller still holds the id.
  }
}

export function clearLocalPlayerId(gameName: string): void {
  try {
    window.localStorage.removeItem(STORAGE_PREFIX + gameName);
  } catch {
    // ignore
  }
}

let inMemory: Map<string, PlayerId> = new Map();

export function getInMemoryLocalPlayerId(gameName: string): PlayerId | null {
  return inMemory.get(gameName) ?? null;
}

export function setInMemoryLocalPlayerId(gameName: string, id: PlayerId): void {
  inMemory.set(gameName, id);
}

// The handle this browser claimed a seat with. The seat itself is remembered
// above; the handle is what lets the load path recognise its own claim when the
// remembered seat is gone (src/players/localSeat.ts).
const HANDLE_PREFIX = "heroes.mp.claimHandle.";

export function getLocalClaimHandle(gameName: string): string | null {
  try {
    const raw = window.localStorage.getItem(HANDLE_PREFIX + gameName);
    return raw === null || raw.length === 0 ? null : raw;
  } catch {
    return null;
  }
}

export function setLocalClaimHandle(gameName: string, handle: string): void {
  try {
    window.localStorage.setItem(HANDLE_PREFIX + gameName, handle);
  } catch {
    // localStorage may be disabled; the claim still stands server-side.
  }
}

/**
 * Record, locally, that THIS browser holds `seat` in `gameName` -- the three
 * things `resolveLocalSeat` matches a claim against (src/players/localSeat.ts).
 *
 * EVERY path that claims a seat server-side must call this, or the reload path
 * has nothing to identify the browser with and answers "no seat": the claim map
 * says a seat is taken, never by whom. That is exactly what broke when the
 * self-claiming paths (the "New Game" form and the auto-created starter, both
 * seat 0, src/managers/GameSessionManager.ts) claimed without remembering --
 * a reload then centred the map instead of the seat's own stronghold, so a
 * district hex beside the castle fell off screen and never re-opened
 * (test:districts, districts.e2e.ts:372). The multiplayer lobby's Host/Join
 * tabs are the other callers.
 */
export function rememberSelfClaim(gameName: string, seat: PlayerId, handle: string): void {
  setLocalPlayerId(gameName, seat);
  setLocalClaimHandle(gameName, handle);
  setInMemoryLocalPlayerId(gameName, seat);
}
