import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SETTINGS,
  arenaMoveMsPerHexBounds,
  cityBackdropOptions,
  clampArenaMoveMsPerHex,
  clampCityBackdrop,
  clampEnemyMoveDurationMs,
  enemyMoveDurationBounds,
  settings,
  subscribeSettings,
  updateSettings,
} from "../../src/state/settings";
import {
  clampToolbarStyle,
  DEFAULT_TOOLBAR_STYLE,
  type ToolbarStyle,
} from "../../src/state/toolbarThemes";

test("toolbar style defaults to modern and unknown values normalize to modern", () => {
  assert.equal(DEFAULT_SETTINGS.toolbarStyle, "modern");
  assert.equal(DEFAULT_TOOLBAR_STYLE, "modern");
  assert.equal(clampToolbarStyle("future-theme"), "modern");
  assert.equal(clampToolbarStyle(null), "modern");
  assert.equal(clampToolbarStyle("classic-blue"), "classic-blue");
});

test("toolbar style updates notify subscribers and persist the normalized value", () => {
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const persisted = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => persisted.get(key) ?? null,
      setItem: (key: string, value: string) => persisted.set(key, value),
    },
  });

  const notified: ToolbarStyle[] = [];
  const unsubscribe = subscribeSettings((next) => notified.push(next.toolbarStyle));
  try {
    updateSettings({ toolbarStyle: "classic-blue" });
    assert.equal(settings().toolbarStyle, "classic-blue");
    assert.equal(JSON.parse(persisted.get("heroesJs.settings") ?? "{}").toolbarStyle, "classic-blue");

    updateSettings({ toolbarStyle: "future-theme" as ToolbarStyle });
    assert.equal(settings().toolbarStyle, "modern");
    assert.deepEqual(notified, ["classic-blue", "modern"]);
    assert.equal(JSON.parse(persisted.get("heroesJs.settings") ?? "{}").toolbarStyle, "modern");
  } finally {
    unsubscribe();
    updateSettings({ toolbarStyle: DEFAULT_TOOLBAR_STYLE });
    if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("arenaMoveMsPerHexBounds exposes the battle-arena walk-pace range (0 = instant)", () => {
  assert.deepEqual(arenaMoveMsPerHexBounds(), { min: 0, max: 500, default: 90 });
});

test("city backdrop defaults to the diorama and only an explicit skybox selects the skybox", () => {
  assert.equal(DEFAULT_SETTINGS.cityBackdrop, "diorama");
  assert.equal(clampCityBackdrop("skybox"), "skybox");
  assert.equal(clampCityBackdrop("diorama"), "diorama");
  assert.equal(clampCityBackdrop("watercolour"), "diorama");
  assert.equal(clampCityBackdrop(null), "diorama");
  assert.deepEqual(cityBackdropOptions(), [
    { value: "diorama", label: "Settlement diorama (biome)" },
    { value: "skybox", label: "Watercolor skybox (static variants)" },
  ]);
});

test("updateSettings round-trips the city backdrop and normalizes unknown values", () => {
  try {
    updateSettings({ cityBackdrop: "skybox" });
    assert.equal(settings().cityBackdrop, "skybox");
    updateSettings({ cityBackdrop: "unknown" as never });
    assert.equal(settings().cityBackdrop, "diorama");
  } finally {
    updateSettings({ cityBackdrop: "diorama" });
  }
});

test("city grid lines default on and only a boolean patch turns them off", () => {
  assert.equal(DEFAULT_SETTINGS.cityGridLines, true);
  try {
    updateSettings({ cityGridLines: false });
    assert.equal(settings().cityGridLines, false);
    updateSettings({ cityGridLines: "no" as never });
    assert.equal(settings().cityGridLines, false, "a non-boolean patch leaves the current value alone");
    updateSettings({ cityGridLines: true });
    assert.equal(settings().cityGridLines, true);
  } finally {
    updateSettings({ cityGridLines: true });
  }
});

test("clampArenaMoveMsPerHex clamps, rounds, and falls back on non-finite input", () => {
  assert.equal(clampArenaMoveMsPerHex(-5), 0);
  assert.equal(clampArenaMoveMsPerHex(0), 0);
  assert.equal(clampArenaMoveMsPerHex(5000), 500);
  assert.equal(clampArenaMoveMsPerHex(90.6), 91);
  assert.equal(clampArenaMoveMsPerHex(Number.NaN), 90);
  assert.equal(clampArenaMoveMsPerHex(Number.POSITIVE_INFINITY), 90);
});

test("updateSettings changes arenaMoveMsPerHex without touching the other speed settings", () => {
  const priorOwn = settings().moveDurationMs;
  const priorEnemy = settings().enemyMoveDurationMs;
  try {
    updateSettings({ arenaMoveMsPerHex: 200 });
    assert.equal(settings().arenaMoveMsPerHex, 200);
    assert.equal(settings().moveDurationMs, priorOwn);
    assert.equal(settings().enemyMoveDurationMs, priorEnemy);
  } finally {
    updateSettings({ arenaMoveMsPerHex: arenaMoveMsPerHexBounds().default });
  }
  assert.equal(settings().arenaMoveMsPerHex, 90);
});

test("updateSettings clamps an out-of-range arenaMoveMsPerHex patch", () => {
  try {
    updateSettings({ arenaMoveMsPerHex: 99999 });
    assert.equal(settings().arenaMoveMsPerHex, 500);
    updateSettings({ arenaMoveMsPerHex: 0 });
    assert.equal(settings().arenaMoveMsPerHex, 0, "0 is a legal value (instant)");
  } finally {
    updateSettings({ arenaMoveMsPerHex: arenaMoveMsPerHexBounds().default });
  }
});

test("enemyMoveDurationBounds exposes the enemy speed range", () => {
  assert.deepEqual(enemyMoveDurationBounds(), { min: 40, max: 1000, default: 220 });
});

test("clampEnemyMoveDurationMs clamps, rounds, and falls back on non-finite input", () => {
  assert.equal(clampEnemyMoveDurationMs(10), 40);
  assert.equal(clampEnemyMoveDurationMs(5000), 1000);
  assert.equal(clampEnemyMoveDurationMs(250.6), 251);
  assert.equal(clampEnemyMoveDurationMs(250.4), 250);
  assert.equal(clampEnemyMoveDurationMs(Number.NaN), 220);
  assert.equal(clampEnemyMoveDurationMs(Number.POSITIVE_INFINITY), 220);
});

test("updateSettings changes enemyMoveDurationMs without touching moveDurationMs", () => {
  const priorOwn = settings().moveDurationMs;
  try {
    updateSettings({ enemyMoveDurationMs: 700 });
    assert.equal(settings().enemyMoveDurationMs, 700);
    assert.equal(settings().moveDurationMs, priorOwn);
  } finally {
    updateSettings({ enemyMoveDurationMs: 220, moveDurationMs: 220 });
  }
  assert.equal(settings().enemyMoveDurationMs, 220);
  assert.equal(settings().moveDurationMs, 220);
});

test("updateSettings clamps an out-of-range enemyMoveDurationMs patch", () => {
  try {
    updateSettings({ enemyMoveDurationMs: 99999 });
    assert.equal(settings().enemyMoveDurationMs, 1000);
  } finally {
    updateSettings({ enemyMoveDurationMs: 220, moveDurationMs: 220 });
  }
});
