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

/**
 * Which seat a browser acts as in a game, from the seats the lobby has claimed
 * and the seat this browser already claimed for itself (localStorage, written
 * by the lobby's Host/Join flows). The browser's OWN claim wins -- before this,
 * `GameSessionManager.loadGame` adopted the FIRST claimed seat, so a browser
 * that claimed seat 1 through the Join tab was silently reset to seat 0 on the
 * load that followed: the second human seat could not be held by one browser
 * (playthrough round 2b, F2). With no stored claim (or one nobody holds -- the
 * lobby is the authority) this falls back to the lowest claimed seat, which is
 * what every pre-existing flow produced: `claimed` is a jsonb object, whose
 * key order is Postgres's, not numeric, so "lowest" is the deterministic
 * reading of "first".
 */
export function resolveInitialLocalSeat(
  claimedSeats: readonly number[],
  storedSeat: number | null,
): PlayerId | null {
  if (storedSeat !== null && claimedSeats.includes(storedSeat)) return storedSeat;
  if (claimedSeats.length === 0) return null;
  return Math.min(...claimedSeats);
}
