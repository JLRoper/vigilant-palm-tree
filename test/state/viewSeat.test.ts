import { test } from "node:test";
import assert from "node:assert/strict";
import { Hero } from "../../src/entities/hero";
import { setViewSeat, viewSeat } from "../../src/state/viewSeat";
import {
  enemyMoveDurationBounds,
  settings,
  settingsBounds,
  updateSettings,
} from "../../src/state/settings";

const OWN_MS = 200;
const ENEMY_MS = 900;

function resetSettings(): void {
  updateSettings({
    moveDurationMs: settingsBounds().default,
    enemyMoveDurationMs: enemyMoveDurationBounds().default,
  });
  setViewSeat(null);
}

function heroAt(ownerId: number): Hero {
  return new Hero("h1", "H", 0, 0, "player", ownerId);
}

test("viewSeat defaults to seat 0", () => {
  setViewSeat(null);
  assert.equal(viewSeat(), 0);
});

test("with the default view seat, own heroes tween at moveDurationMs and foreign heroes at enemyMoveDurationMs", () => {
  resetSettings();
  updateSettings({ moveDurationMs: OWN_MS, enemyMoveDurationMs: ENEMY_MS });
  setViewSeat(null);

  assert.equal(heroAt(0).moveDurationMs, OWN_MS);
  assert.equal(heroAt(1).moveDurationMs, ENEMY_MS);

  resetSettings();
});

test("setViewSeat flips which hero uses which duration", () => {
  resetSettings();
  updateSettings({ moveDurationMs: OWN_MS, enemyMoveDurationMs: ENEMY_MS });
  setViewSeat(1);

  assert.equal(viewSeat(), 1);
  assert.equal(heroAt(1).moveDurationMs, OWN_MS);
  assert.equal(heroAt(0).moveDurationMs, ENEMY_MS);

  resetSettings();
});

test("setViewSeat(null) resets the view seat to 0", () => {
  resetSettings();
  updateSettings({ moveDurationMs: OWN_MS, enemyMoveDurationMs: ENEMY_MS });
  setViewSeat(2);
  setViewSeat(null);

  assert.equal(viewSeat(), 0);
  assert.equal(heroAt(0).moveDurationMs, OWN_MS);
  assert.equal(heroAt(2).moveDurationMs, ENEMY_MS);

  resetSettings();
  assert.equal(settings().moveDurationMs, settingsBounds().default, "module state must not leak past the test");
  assert.equal(settings().enemyMoveDurationMs, enemyMoveDurationBounds().default);
});