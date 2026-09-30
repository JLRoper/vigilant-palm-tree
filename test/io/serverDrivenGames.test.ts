import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  clearServerDriven,
  isServerDriven,
  registerServerDriven,
  shouldDriveAi,
  syncServerDrivenFromGame,
} from "../../src/io/serverDrivenGames";

const USED = ["pg-a", "pg-b", "pg-flagged", "pg-plain", "pg-rollback"];

beforeEach(() => {
  for (const name of USED) clearServerDriven(name);
});

test("unknown games default to browser-driven (registry default false)", () => {
  assert.equal(isServerDriven("never-registered"), false);
  assert.equal(isServerDriven(null), false);
  assert.equal(isServerDriven(undefined), false);
});

test("register/clear flips a game's entry", () => {
  assert.equal(isServerDriven("pg-a"), false);
  registerServerDriven("pg-a");
  assert.equal(isServerDriven("pg-a"), true);
  clearServerDriven("pg-a");
  assert.equal(isServerDriven("pg-a"), false);
});

test("clearing an unknown game is a no-op", () => {
  clearServerDriven("pg-b");
  assert.equal(isServerDriven("pg-b"), false);
});

test("syncServerDrivenFromGame registers a flagged game row", () => {
  syncServerDrivenFromGame({ name: "pg-flagged", lobby: { aiDriver: "server" } });
  assert.equal(isServerDriven("pg-flagged"), true);
});

test("syncServerDrivenFromGame clears a game whose fresh response lost the flag (server rollback)", () => {
  registerServerDriven("pg-rollback");
  syncServerDrivenFromGame({ name: "pg-rollback", lobby: { claimed: {} } });
  assert.equal(isServerDriven("pg-rollback"), false, "the flipped-off flag clears the registration");
});

test("syncServerDrivenFromGame handles a row with no lobby at all", () => {
  registerServerDriven("pg-a");
  syncServerDrivenFromGame({ name: "pg-a" });
  assert.equal(isServerDriven("pg-a"), false);
});

test("game switch clears the previous game and registers the new one", () => {
  registerServerDriven("pg-a");
  clearServerDriven("pg-a");
  syncServerDrivenFromGame({ name: "pg-b", lobby: { aiDriver: "server" } });
  assert.equal(isServerDriven("pg-a"), false, "the switched-away game's entry is gone");
  assert.equal(isServerDriven("pg-b"), true, "the newly loaded game's flag is registered");
});

test("shouldDriveAi is the effective primary-actor answer: seat 0 AND not server-driven", () => {
  registerServerDriven("pg-flagged");
  assert.equal(shouldDriveAi("pg-plain", 0), true, "seat 0 on an unflagged game drives");
  assert.equal(shouldDriveAi("pg-flagged", 0), false, "seat 0 on a flagged game spectates");
  assert.equal(shouldDriveAi("pg-flagged", 1), false);
  assert.equal(shouldDriveAi("pg-plain", 2), false, "a non-primary seat never drives");
});

test("shouldDriveAi keeps the legacy null-seat default (solo games are primary)", () => {
  registerServerDriven("pg-flagged");
  assert.equal(shouldDriveAi(null, null), true);
  assert.equal(shouldDriveAi(undefined, null), true);
  assert.equal(shouldDriveAi("pg-plain", null), true);
  assert.equal(shouldDriveAi("pg-flagged", null), false, "the flag wins even with an unknown seat");
});
