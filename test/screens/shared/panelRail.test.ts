// Regression coverage for issue #131: setMinimapReserve wrote a CSS custom
// property on <html> unconditionally, called every rAF tick via
// UIManager.setMapDimensions -> fullFrame(); and savePanelPosition wrote to
// localStorage synchronously on every mousemove while dragging a floating
// panel. jsdom is intentionally not added; node:test provides the harness
// (see test/screens/combat/arena.test.ts for the established pattern).

import { test } from "node:test";
import assert from "node:assert/strict";
import { setMinimapReserve, savePanelPosition } from "../../../src/screens/shared/panelRail";

const AUTH_TOKEN_KEY = "heroesJs.authToken";
const AUTH_EMAIL_KEY = "heroesJs.authEmail";
const LAYOUT_KEY = "heroesjs.panelLayout.v1";

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null { return this.map.has(key) ? this.map.get(key)! : null; }
  setItem(key: string, value: string): void { this.map.set(key, value); }
  removeItem(key: string): void { this.map.delete(key); }
}

const savedDocument = (globalThis as { document?: unknown }).document;
const savedWindow = (globalThis as { window?: unknown }).window;
const savedLocalStorage = (globalThis as { localStorage?: unknown }).localStorage;

function restoreGlobals(): void {
  if (savedDocument === undefined) delete (globalThis as { document?: unknown }).document;
  else (globalThis as { document: unknown }).document = savedDocument;
  if (savedWindow === undefined) delete (globalThis as { window?: unknown }).window;
  else (globalThis as { window: unknown }).window = savedWindow;
  if (savedLocalStorage === undefined) delete (globalThis as { localStorage?: unknown }).localStorage;
  else (globalThis as { localStorage: unknown }).localStorage = savedLocalStorage;
}

test("setMinimapReserve only writes the CSS property when the value actually changes", () => {
  const calls: Array<[string, string]> = [];
  (globalThis as { document: unknown }).document = {
    documentElement: {
      style: {
        setProperty: (name: string, value: string) => { calls.push([name, value]); },
      },
    },
    getElementById: () => null,
  };
  try {
    setMinimapReserve(100);
    setMinimapReserve(100);
    setMinimapReserve(100);
    assert.equal(calls.length, 1, "repeated calls with the same value must not re-write the style");
    assert.deepEqual(calls[0], ["--minimap-reserve", "100px"]);

    setMinimapReserve(150);
    assert.equal(calls.length, 2, "a genuinely new value must still write through");
    assert.deepEqual(calls[1], ["--minimap-reserve", "150px"]);
  } finally {
    restoreGlobals();
  }
});

test("savePanelPosition debounces localStorage writes and flushes on mouseup", async () => {
  const storage = new MemoryStorage();
  storage.setItem(AUTH_TOKEN_KEY, "test-token");
  storage.setItem(AUTH_EMAIL_KEY, "test@example.com");
  storage.setItem(LAYOUT_KEY, JSON.stringify({ heroes: { mode: "floating", x: 0, y: 0 } }));
  (globalThis as { localStorage: unknown }).localStorage = storage;

  const mouseupHandlers: Array<() => void> = [];
  (globalThis as { window: unknown }).window = {
    addEventListener: (type: string, cb: () => void) => {
      if (type === "mouseup") mouseupHandlers.push(cb);
    },
  };
  (globalThis as { document: unknown }).document = {
    documentElement: { style: { setProperty: () => {} } },
    getElementById: () => null,
  };

  const originalSetItem = storage.setItem.bind(storage);
  let writeCount = 0;
  storage.setItem = (key: string, value: string) => { writeCount++; originalSetItem(key, value); };

  try {
    savePanelPosition("heroes", { x: 1, y: 1 });
    savePanelPosition("heroes", { x: 2, y: 2 });
    savePanelPosition("heroes", { x: 3, y: 3 });

    assert.equal(writeCount, 0, "rapid moves must not synchronously write to localStorage");
    const stillOld = JSON.parse(storage.getItem(LAYOUT_KEY)!);
    assert.deepEqual(stillOld.heroes, { mode: "floating", x: 0, y: 0 });

    assert.equal(mouseupHandlers.length, 1, "exactly one mouseup flush listener should be bound");
    mouseupHandlers[0]();

    assert.equal(writeCount, 1, "drag-end must flush the pending write exactly once");
    const flushed = JSON.parse(storage.getItem(LAYOUT_KEY)!);
    assert.deepEqual(flushed.heroes, { mode: "floating", x: 3, y: 3 });
  } finally {
    restoreGlobals();
  }
});
