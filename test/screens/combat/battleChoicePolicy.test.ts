import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveBattleChoice } from "../../../src/screens/combat/battleChoicePolicy";

// Pins resolveBattleChoice's modal/spectate/auto-resolve policy — above all
// the regression where "AI attacks the local human" fell into the old `pvp`
// predicate's else-branch and silently auto-resolved instead of offering the
// defender the battle modal.

test("server-driven game: a client owning neither side spectates", () => {
  assert.deepEqual(
    resolveBattleChoice({ localIsAttacker: false, localIsDefender: false, serverDriven: true }),
    { kind: "spectate" },
  );
});

test("server-driven game: local attacker gets the full modal", () => {
  assert.deepEqual(
    resolveBattleChoice({ localIsAttacker: true, localIsDefender: false, serverDriven: true }),
    { kind: "modal", hideFlee: false },
  );
});

test("server-driven game: local defender gets the modal without Flee", () => {
  assert.deepEqual(
    resolveBattleChoice({ localIsAttacker: false, localIsDefender: true, serverDriven: true }),
    { kind: "modal", hideFlee: true },
  );
});

test("browser-driven game: local defender gets the modal without Flee (was silent auto-resolve before)", () => {
  assert.deepEqual(
    resolveBattleChoice({ localIsAttacker: false, localIsDefender: true, serverDriven: false }),
    { kind: "modal", hideFlee: true },
  );
});

test("browser-driven game: neither side local auto-resolves (driving client resolves AI-vs-AI)", () => {
  assert.deepEqual(
    resolveBattleChoice({ localIsAttacker: false, localIsDefender: false, serverDriven: false }),
    { kind: "autoResolve" },
  );
});

test("browser-driven game: local attacker gets the full modal", () => {
  assert.deepEqual(
    resolveBattleChoice({ localIsAttacker: true, localIsDefender: false, serverDriven: false }),
    { kind: "modal", hideFlee: false },
  );
});
