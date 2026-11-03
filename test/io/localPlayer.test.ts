import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import {
  clearLocalPlayerId,
  getInMemoryLocalPlayerId,
  getLocalClaimHandle,
  getLocalPlayerId,
  setInMemoryLocalPlayerId,
  setLocalClaimHandle,
  setLocalPlayerId,
} from "../../src/players/localPlayer";

// This file used to test `resolveInitialLocalSeat` -- main's partial fix for the
// same finding Copilot raised (the browser's own claim, else the LOWEST claimed
// seat). Seat RESOLUTION now lives in `src/players/localSeat.ts`, because it
// needs the claim map's handle/email as well as the remembered seat and it
// asserts no seat at all when none of them identifies the browser; its cases are
// in `test/state/localSeat.test.ts`. What is left here is this module's own job:
// the two values a browser remembers about a game, and the in-memory seat.

// The module reads `window.localStorage` (in a browser `window` IS `globalThis`,
// so this is the real path, not a shim in front of it), so the stub goes on
// `window` -- test/helpers/mockDom's installDom only defines the bare global.
const store = new Map<string, string>();
const savedWindow = (globalThis as { window?: unknown }).window;

beforeEach(() => {
  store.clear();
  (globalThis as { window: unknown }).window = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, String(value));
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    },
  };
});

test("the seat this browser claimed round-trips through localStorage", () => {
  assert.equal(getLocalPlayerId("g-seat"), null, "nothing is remembered until the lobby writes it");
  setLocalPlayerId("g-seat", 1);
  assert.equal(getLocalPlayerId("g-seat"), 1);
  setLocalPlayerId("g-seat", 3);
  assert.equal(getLocalPlayerId("g-seat"), 3);
  clearLocalPlayerId("g-seat");
  assert.equal(getLocalPlayerId("g-seat"), null);
});

test("a stored seat that is not an integer reads as no seat", () => {
  window.localStorage.setItem("heroes.mp.localPlayerId.g-junk", "not-a-seat");
  assert.equal(getLocalPlayerId("g-junk"), null);
});

test("the handle this browser claimed with round-trips, and an empty one reads as none", () => {
  assert.equal(getLocalClaimHandle("g-handle"), null);
  setLocalClaimHandle("g-handle", "Joiner");
  assert.equal(getLocalClaimHandle("g-handle"), "Joiner");
  window.localStorage.setItem("heroes.mp.claimHandle.g-handle", "");
  assert.equal(getLocalClaimHandle("g-handle"), null, "an empty handle identifies nobody");
});

test("the in-memory seat is per game and is not persisted", () => {
  assert.equal(getInMemoryLocalPlayerId("g-mem"), null);
  setInMemoryLocalPlayerId("g-mem", 2);
  assert.equal(getInMemoryLocalPlayerId("g-mem"), 2);
  assert.equal(getInMemoryLocalPlayerId("g-other"), null);
  assert.equal(store.has("heroes.mp.localPlayerId.g-mem"), false, "the in-memory seat writes no storage key");
});

after(() => {
  if (savedWindow === undefined) delete (globalThis as { window?: unknown }).window;
  else (globalThis as { window: unknown }).window = savedWindow;
});
