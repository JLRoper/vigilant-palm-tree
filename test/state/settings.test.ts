import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clampEnemyMoveDurationMs,
  enemyMoveDurationBounds,
  settings,
  updateSettings,
} from "../../src/state/settings";

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
