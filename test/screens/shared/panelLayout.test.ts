import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPanelGeometry, savePanelGeometry } from "../../../src/screens/shared/panelLayout";

const GEOMETRY_KEY = "heroesJs.panelGeometry.v1";

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null { return this.map.has(key) ? this.map.get(key)! : null; }
  setItem(key: string, value: string): void { this.map.set(key, value); }
  removeItem(key: string): void { this.map.delete(key); }
}

const savedLocalStorage = (globalThis as { localStorage?: unknown }).localStorage;

function restoreGlobals(): void {
  if (savedLocalStorage === undefined) delete (globalThis as { localStorage?: unknown }).localStorage;
  else (globalThis as { localStorage: unknown }).localStorage = savedLocalStorage;
}

test("savePanelGeometry / loadPanelGeometry round-trip through localStorage", () => {
  const storage = new MemoryStorage();
  (globalThis as { localStorage: unknown }).localStorage = storage;
  try {
    assert.equal(loadPanelGeometry("heroInfo"), null, "no entry before the first save");

    savePanelGeometry("heroInfo", { x: 30, y: 120 });
    assert.deepEqual(loadPanelGeometry("heroInfo"), { x: 30, y: 120 });
    const raw = JSON.parse(storage.getItem(GEOMETRY_KEY)!);
    assert.deepEqual(raw.heroInfo, { x: 30, y: 120 }, "the stored JSON must carry the saved position");

    savePanelGeometry("heroInfo", { x: 44, y: 60 });
    savePanelGeometry("buildPalette", { x: 12, y: 200 });
    assert.deepEqual(loadPanelGeometry("heroInfo"), { x: 44, y: 60 }, "the latest save wins");
    assert.deepEqual(loadPanelGeometry("buildPalette"), { x: 12, y: 200 }, "keys persist independently");
    assert.equal(loadPanelGeometry("settlementInfo"), null, "untouched keys stay unset");
  } finally {
    restoreGlobals();
  }
});

test("invalid stored JSON yields null instead of throwing", () => {
  const storage = new MemoryStorage();
  storage.setItem(GEOMETRY_KEY, "{not json");
  (globalThis as { localStorage: unknown }).localStorage = storage;
  try {
    assert.equal(loadPanelGeometry("settlementInfo"), null);
    assert.equal(loadPanelGeometry("heroInfo"), null);
  } finally {
    restoreGlobals();
  }
});

test("entries with non-finite or negative coords are dropped on read", () => {
  const storage = new MemoryStorage();
  storage.setItem(GEOMETRY_KEY, JSON.stringify({
    heroInfo: { x: "left", y: 20 },
    settlementInfo: { x: 10, y: null },
    buildPalette: { x: -5, y: 30 },
  }));
  (globalThis as { localStorage: unknown }).localStorage = storage;
  try {
    assert.equal(loadPanelGeometry("heroInfo"), null, "non-numeric x drops the entry");
    assert.equal(loadPanelGeometry("settlementInfo"), null, "non-numeric y drops the entry");
    assert.equal(loadPanelGeometry("buildPalette"), null, "negative coords drop the entry");
  } finally {
    restoreGlobals();
  }
});

test("a localStorage-less environment makes both calls silent no-ops", () => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
  try {
    assert.doesNotThrow(() => savePanelGeometry("heroInfo", { x: 1, y: 2 }));
    assert.equal(loadPanelGeometry("heroInfo"), null, "nothing can be loaded without storage");

    (globalThis as { localStorage: unknown }).localStorage = new MemoryStorage();
    assert.equal(loadPanelGeometry("heroInfo"), null, "the no-storage save must not have written anywhere");
  } finally {
    restoreGlobals();
  }
});
