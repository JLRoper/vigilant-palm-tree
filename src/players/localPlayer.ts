import type { PlayerId } from "../state/gameState";

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
