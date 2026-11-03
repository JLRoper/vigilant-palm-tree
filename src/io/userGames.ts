import type { Game } from "./api";

export type UserGameEntry = {
  id: number;
  name: string;
  lastSeenAt: string;
};

/**
 * One row of a Load list: a game the player can open, plus the cache entry that
 * remembers when they last saw it. `server` is absent when the game is known
 * only from this browser's cache -- it is then shown as missing, never hidden.
 */
export type LoadListEntry = UserGameEntry & { server?: Game };

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

function newestFirst<T extends { lastSeenAt: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.lastSeenAt < b.lastSeenAt ? 1 : -1));
}

/**
 * The Load list, built from the SERVER's games and the cache's memory of them.
 *
 * The cache (`heroesJs.userGames`) is localStorage: it is per browser profile
 * AND per origin, so it is lost by a cleared profile, a private window, or --
 * in dev -- a vite restart on a new port (allocate-ports picks a fresh one).
 * It is a memory of when the player last saw a game, not the list of games that
 * exist. Using it AS the list is what made a lost profile look like an empty
 * account: the player's saves were on the server the whole time, and Load Game
 * showed nothing while a starter game was quietly started in their place.
 *
 * So the server's `GET /api/games` is the source when it can be read:
 *
 *   - every server game is listed (matched to its cache entry by id, else by
 *     NAME -- a cache entry written with an invented id still names the game);
 *   - a cache-only entry is kept and marked missing, so a game the player
 *     remembers vanishing from the server is explained rather than dropped;
 *   - `serverGames === null` means the server could not be read: the cache is
 *     all there is, and the caller must SAY so (a list that might be
 *     incomplete must never render as "no saved games").
 */
export function mergeLoadList(
  serverGames: Game[] | null,
  cache: UserGameEntry[] = readCache().games,
): LoadListEntry[] {
  if (serverGames === null) return newestFirst(cache.map((entry) => ({ ...entry })));

  const unmatched = [...cache];
  const out: LoadListEntry[] = [];
  for (const game of serverGames) {
    let at = unmatched.findIndex((entry) => entry.id === game.id);
    if (at < 0) at = unmatched.findIndex((entry) => entry.name === game.name);
    const remembered = at >= 0 ? unmatched.splice(at, 1)[0] : undefined;
    out.push({
      id: game.id,
      name: game.name,
      lastSeenAt: remembered?.lastSeenAt ?? game.updated_at ?? new Date(0).toISOString(),
      server: game,
    });
  }
  for (const entry of unmatched) out.push({ ...entry });
  return newestFirst(out);
}

/**
 * Rewrite the cache from the server's list, repairing ids as it goes.
 *
 * Called at boot, before anything else looks at the list. This is the step that
 * was missing: an empty (or lost) cache was treated as an empty ACCOUNT, so the
 * client started a starter game instead of restoring the player's own. After
 * this the cache holds the server's real ids, and a profile that lost its
 * storage gets its games back on the next boot instead of losing them silently.
 *
 * Nothing is removed: a cache-only entry may be a game the server has simply
 * not been asked about, and `mergeLoadList` shows it as missing rather than
 * deleting the player's record of it. Returns the restored list.
 */
export function restoreUserGames(serverGames: Game[]): UserGameEntry[] {
  const restored = mergeLoadList(serverGames).map(({ id, name, lastSeenAt }) => ({ id, name, lastSeenAt }));
  writeCache({ version: 1, games: restored });
  return restored;
}
