import { test } from "node:test";
import assert from "node:assert/strict";
import {
  arenaMoveMsPerHexBounds,
  clampArenaMoveMsPerHex,
  clampEnemyMoveDurationMs,
  enemyMoveDurationBounds,
  settings,
  updateSettings,
} from "../../src/state/settings";

test("arenaMoveMsPerHexBounds exposes the battle-arena walk-pace range (0 = instant)", () => {
  assert.deepEqual(arenaMoveMsPerHexBounds(), { min: 0, max: 500, default: 90 });
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
