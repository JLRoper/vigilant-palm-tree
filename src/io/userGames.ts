export type UserGameEntry = {
  id: number;
  name: string;
  lastSeenAt: string;
};

type Cache = {
  version: 1;
  games: UserGameEntry[];
};

const STORAGE_KEY = "heroesJs.userGames";

function readCache(): Cache {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { version: 1, games: [] };
    const parsed = JSON.parse(raw) as Partial<Cache>;
    if (parsed.version !== 1 || !Array.isArray(parsed.games)) {
      return { version: 1, games: [] };
    }
    const games: UserGameEntry[] = [];
    for (const g of parsed.games) {
      if (
        g &&
        typeof g.id === "number" &&
        typeof g.name === "string" &&
        typeof g.lastSeenAt === "string"
      ) {
        games.push({ id: g.id, name: g.name, lastSeenAt: g.lastSeenAt });
      }
    }
    return { version: 1, games };
  } catch {
    return { version: 1, games: [] };
  }
}

function writeCache(cache: Cache): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // storage may be unavailable (private mode, quota); treat as no-op
  }
}

export function listUserGames(): UserGameEntry[] {
  return readCache().games;
}

export function rememberGame(id: number, name: string): void {
  const cache = readCache();
  const idx = cache.games.findIndex((g) => g.id === id);
  const entry: UserGameEntry = { id, name, lastSeenAt: new Date().toISOString() };
  if (idx >= 0) cache.games[idx] = entry;
  else cache.games.push(entry);
  writeCache(cache);
}

export function forgetGame(id: number): void {
  const cache = readCache();
  cache.games = cache.games.filter((g) => g.id !== id);
  writeCache(cache);
}

export function bumpLastSeen(id: number): void {
  const cache = readCache();
  const entry = cache.games.find((g) => g.id === id);
  if (!entry) return;
  entry.lastSeenAt = new Date().toISOString();
  writeCache(cache);
}
