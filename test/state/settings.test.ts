import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SETTINGS,
  arenaMoveMsPerHexBounds,
  cityBackdropOptions,
  clampArenaMoveMsPerHex,
  clampCityBackdrop,
  clampEnemyMoveDurationMs,
  clampGameMode,
  enemyMoveDurationBounds,
  gameModeOptions,
  readStoredSettings,
  settings,
  subscribeSettings,
  updateSettings,
} from "../../src/state/settings";
import { DEFAULT_GAME_MODE, SETTLERS_MODE_DEFAULTS, gameModeSettings } from "@heroes/contracts";
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

// ── New-game default mode (SETTLERS-PLAN.md §1/§4 W4) ──
//
// The store's gameMode key is the mode the New Game form pre-selects. It is a
// PREFERENCE, not any game's mode: a game's own mode lives in games.lobby and
// this key never rewrites it. The schema bump (v2 -> v3) is what makes a store
// written before the key existed follow along exactly once.

const STORE_KEY = "heroesJs.settings";

function installFakeStorage(initial?: Record<string, string>): {
  stored: Map<string, string>;
  restore: () => void;
} {
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const stored = new Map<string, string>(Object.entries(initial ?? {}));
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
    },
  });
  return {
    stored,
    restore: () => {
      if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
      else Reflect.deleteProperty(globalThis, "localStorage");
    },
  };
}

test("the stored new-game mode defaults to classic and unknown values normalize to it", () => {
  assert.equal(DEFAULT_SETTINGS.gameMode, "classic");
  assert.equal(DEFAULT_GAME_MODE, "classic");
  assert.equal(clampGameMode("settlers"), "settlers");
  assert.equal(clampGameMode("classic"), "classic");
  assert.equal(clampGameMode("sandbox"), "classic");
  assert.equal(clampGameMode(null), "classic");
  assert.equal(clampGameMode(7), "classic");
  assert.deepEqual(
    gameModeOptions().map((o) => o.value),
    ["classic", "settlers"],
    "both new-game surfaces offer exactly the two modes",
  );
});

test("updateSettings round-trips the mode and writes the bumped schema version", () => {
  const { stored, restore } = installFakeStorage();
  try {
    updateSettings({ gameMode: "settlers" });
    assert.equal(settings().gameMode, "settlers");
    updateSettings({ gameMode: "not-a-mode" as never });
    assert.equal(settings().gameMode, "classic", "junk falls back to the default mode");
    updateSettings({ gameMode: "settlers" });
    const persisted = JSON.parse(stored.get(STORE_KEY) ?? "{}");
    assert.equal(persisted.gameMode, "settlers");
    assert.equal(persisted.schemaVersion, 3);
  } finally {
    updateSettings({ gameMode: DEFAULT_GAME_MODE });
    restore();
  }
});

test("a store written before the mode key existed follows along exactly once", () => {
  // A v2 store: at v2 the key's meaning did not exist yet, so even a
  // hand-written value is not a choice -- it follows along to the default.
  const migrated = readStoredSettings(
    JSON.stringify({
      schemaVersion: 2,
      resourceStyle: "iso-bubbly",
      toolbarStyle: "modern",
      gameMode: "settlers",
    }),
  );
  assert.equal(
    migrated.gameMode,
    DEFAULT_GAME_MODE,
    "the v2 -> v3 migration lands the default mode",
  );
  assert.equal(migrated.resourceStyle, "iso-bubbly", "the other stored keys are untouched");

  // The same blob at v3 IS a choice: the migration must not run again, which
  // is what "exactly once" means.
  assert.equal(
    readStoredSettings(JSON.stringify({ schemaVersion: 3, gameMode: "settlers" })).gameMode,
    "settlers",
  );

  // And a blob the store itself writes is v3, so a reload keeps the pick.
  const { stored, restore } = installFakeStorage();
  try {
    updateSettings({ gameMode: "settlers" });
    const written = stored.get(STORE_KEY) ?? "";
    assert.equal(JSON.parse(written).schemaVersion, 3);
    assert.equal(readStoredSettings(written).gameMode, "settlers");
  } finally {
    updateSettings({ gameMode: DEFAULT_GAME_MODE });
    restore();
  }
});

test("the mode's settings keys come from the contracts constants, not a second literal", () => {
  assert.equal(gameModeSettings("settlers"), SETTLERS_MODE_DEFAULTS);
  assert.equal(gameModeSettings("classic").wagonConsumedOnFounding, false);
  assert.equal(gameModeSettings(undefined), gameModeSettings("classic"));
  assert.equal(gameModeSettings("sandbox"), gameModeSettings("classic"));
  assert.deepEqual(SETTLERS_MODE_DEFAULTS.wagonSupplies, {
    wood: 200,
    stone: 100,
    iron: 50,
    arcane: 0,
    food: 50,
  });
});
