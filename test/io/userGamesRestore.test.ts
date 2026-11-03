import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  listUserGames,
  rememberGame,
  mergeLoadList,
  restoreUserGames,
  type UserGameEntry,
} from "../../src/io/userGames";
import type { Game } from "../../src/io/api";

// The Load list's source of truth.
//
// Both findings from the load-path cards are the same bug seen from two ends:
// `heroesJs.userGames` is localStorage, so it is per browser profile AND per
// origin, and the client used it AS the list of games that exist. A profile that
// lost its storage then looked like an account with no games -- so Load Game
// showed nothing (the player's own save, absent, with nothing said) and boot
// started a `starter-*` game in its place.
//
// These tests pin the corrected contract on the pure part: the SERVER's games
// are the list, the cache only remembers when each was last seen, and a list
// that could not be read is never presented as an empty account.

const store = new Map<string, string>();
const savedLocalStorage = (globalThis as { localStorage?: unknown }).localStorage;

beforeEach(() => {
  store.clear();
  // userGames reads the bare global `localStorage` (in a browser that IS the
  // real one); the test needs a stub before any function touches it.
  (globalThis as { localStorage: unknown }).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
});

function game(id: number, name: string, updatedAt = "2026-01-01T00:00:00.000Z"): Game {
  return { id, name, updated_at: updatedAt } as Game;
}

test("a game the server holds is listed even when this browser remembers nothing", () => {
  assert.deepEqual(listUserGames(), [], "a fresh profile starts with an empty cache");

  const list = mergeLoadList([game(7, "my-settlers-own")]);

  assert.equal(list.length, 1, "the server's game must be listed");
  assert.equal(list[0].name, "my-settlers-own");
  assert.equal(list[0].server?.id, 7, "and it must be openable, not shown as missing");
});

test("a cache entry with an invented id still matches its game by name", () => {
  // The old landing list wrote `Date.now() & 0xffff` as an id, which can never
  // equal a server id -- that is what rendered the player's own game "(missing)".
  const invented: UserGameEntry = { id: 41337, name: "my-settlers-own", lastSeenAt: "2026-02-02T00:00:00.000Z" };
  const list = mergeLoadList([game(7, "my-settlers-own")], [invented]);

  assert.equal(list.length, 1, "one game, not a real row plus a phantom");
  assert.equal(list[0].id, 7, "the server's id wins");
  assert.equal(list[0].lastSeenAt, invented.lastSeenAt, "but the browser's memory of it is kept");
  assert.ok(list[0].server, "and the row is openable");
});

test("a game the player remembers but the server no longer has is shown, not dropped", () => {
  const list = mergeLoadList([], [{ id: 3, name: "gone", lastSeenAt: "2026-03-03T00:00:00.000Z" }]);

  assert.equal(list.length, 1);
  assert.equal(list[0].name, "gone");
  assert.equal(list[0].server, undefined, "the row renders as missing rather than vanishing");
});

test("an UNREADABLE list is not an empty account: it falls back to what is remembered", () => {
  rememberGame(4, "my-settlers-own");

  const list = mergeLoadList(null, listUserGames());

  assert.equal(list.length, 1, "the cache still lists what the player had");
  assert.equal(list[0].server, undefined, "and nothing claims to be openable");
});

test("restoring rewrites the cache with the server's real ids", () => {
  rememberGame(41337, "my-settlers-own"); // the invented-id shape

  const restored = restoreUserGames([game(7, "my-settlers-own")]);

  assert.deepEqual(
    listUserGames().map((g) => ({ id: g.id, name: g.name })),
    [{ id: 7, name: "my-settlers-own" }],
    "the cache now holds the id the server will recognise",
  );
  assert.equal(restored.length, 1);
});

test("restoring adopts a game this browser never saw, so the list is the server's", () => {
  assert.deepEqual(listUserGames(), []);

  restoreUserGames([game(11, "made-elsewhere", "2026-04-04T00:00:00.000Z")]);

  const cache = listUserGames();
  assert.equal(cache.length, 1);
  assert.equal(cache[0].id, 11);
  assert.equal(cache[0].lastSeenAt, "2026-04-04T00:00:00.000Z", "an unseen game is dated by the server");
});

test("restoring keeps a remembered game the server did not return", () => {
  rememberGame(9, "still-remembered");

  restoreUserGames([game(7, "my-settlers-own")]);

  const names = listUserGames().map((g) => g.name).sort();
  assert.deepEqual(names, ["my-settlers-own", "still-remembered"], "Forget is the player's tool, not the boot's");
});

test("an empty server list deletes nothing on the player's behalf", () => {
  rememberGame(9, "forgotten-by-everyone");

  restoreUserGames([]);

  const cache = listUserGames();
  assert.deepEqual(cache.map((g) => g.name), ["forgotten-by-everyone"], "Forget is the only thing that removes a row");

  const list = mergeLoadList([]);
  assert.equal(list.length, 1);
  assert.equal(list[0].server, undefined, "and it is shown as missing, not silently listed as playable");
});

test.after(() => {
  if (savedLocalStorage === undefined) {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  } else {
    (globalThis as { localStorage: unknown }).localStorage = savedLocalStorage;
  }
});
