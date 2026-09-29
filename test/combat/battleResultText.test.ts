import { test } from "node:test";
import assert from "node:assert/strict";
import {
  battleToastMessage,
  battleVerdictCardLine,
  battleVerdictToastPhrase,
  settlementNameAt,
} from "../../src/screens/combat/battleResultText";
import { makeSettlement } from "../charter/_helpers";

test("card line: defeated renders slain, stood and absent verdicts render nothing", () => {
  assert.equal(battleVerdictCardLine("Hero h0", "defeated"), "Hero h0 was slain.");
  assert.equal(battleVerdictCardLine("Hero h0", "stood"), null);
  assert.equal(battleVerdictCardLine("Hero h0", undefined), null);
});

test("card line: retreat and surrender name the settlement when known, tersely when not", () => {
  assert.equal(
    battleVerdictCardLine("Hero h1", "retreated", "Haven"),
    "Hero h1 retreated to Haven.",
  );
  assert.equal(battleVerdictCardLine("Hero h1", "retreated"), "Hero h1 retreated.");
  assert.equal(
    battleVerdictCardLine("Hero h1", "surrendered", "Haven"),
    "Hero h1 surrendered to Haven.",
  );
  assert.equal(battleVerdictCardLine("Hero h1", "surrendered"), "Hero h1 surrendered.");
});

test("toast phrase: per-side verdicts with and without owner and settlement names", () => {
  assert.equal(battleVerdictToastPhrase({ verdict: "defeated", ownerName: "AI 2" }), "AI 2's hero slain");
  assert.equal(battleVerdictToastPhrase({ verdict: "defeated" }), "hero slain");
  assert.equal(
    battleVerdictToastPhrase({ verdict: "retreated", ownerName: "AI 2", settlementName: "Haven" }),
    "AI 2's hero retreated to Haven",
  );
  assert.equal(battleVerdictToastPhrase({ verdict: "retreated", ownerName: "AI 2" }), "AI 2's hero retreated");
  assert.equal(
    battleVerdictToastPhrase({ verdict: "surrendered", ownerName: "AI 2", settlementName: "Haven" }),
    "AI 2's hero surrendered to Haven",
  );
  assert.equal(battleVerdictToastPhrase({ verdict: "surrendered" }), "hero surrendered");
  assert.equal(battleVerdictToastPhrase({ verdict: "stood", ownerName: "AI 2" }), null);
  assert.equal(battleVerdictToastPhrase({}), null);
});

test("toast message: winner case appends the loser's verdict after an em dash", () => {
  assert.equal(
    battleToastMessage({
      attackerLabel: "AI 1's Warlord",
      defenderLabel: "AI 2's Warlord",
      winner: "attacker",
      defender: { verdict: "defeated", ownerName: "AI 2" },
    }),
    "AI 1's Warlord defeated AI 2's Warlord — AI 2's hero slain.",
  );
  assert.equal(
    battleToastMessage({
      attackerLabel: "AI 1's Warlord",
      defenderLabel: "AI 2's Warlord",
      winner: "attacker",
      defender: { verdict: "retreated", ownerName: "AI 2" },
    }),
    "AI 1's Warlord defeated AI 2's Warlord — AI 2's hero retreated.",
  );
  assert.equal(
    battleToastMessage({
      attackerLabel: "AI 1's Warlord",
      defenderLabel: "AI 2's Warlord",
      winner: "attacker",
      defender: { verdict: "surrendered", ownerName: "AI 2", settlementName: "Haven" },
    }),
    "AI 1's Warlord defeated AI 2's Warlord — AI 2's hero surrendered to Haven.",
  );
});

test("toast message: no verdicts keeps the legacy wording; stalemate keeps 'both sides fell'", () => {
  assert.equal(
    battleToastMessage({
      attackerLabel: "AI 1's Warlord",
      defenderLabel: "AI 2's Warlord",
      winner: "attacker",
    }),
    "AI 1's Warlord defeated AI 2's Warlord.",
  );
  assert.equal(
    battleToastMessage({
      attackerLabel: "A",
      defenderLabel: "B",
      winner: "draw",
      attacker: { verdict: "stood", ownerName: "A" },
      defender: { verdict: "stood", ownerName: "B" },
    }),
    "A vs B: both sides fell.",
  );
  assert.equal(
    battleToastMessage({
      attackerLabel: "A",
      defenderLabel: "B",
      winner: "draw",
      attacker: { verdict: "defeated", ownerName: "A" },
      defender: { verdict: "defeated", ownerName: "B" },
    }),
    "A vs B: both sides fell — A's hero slain; B's hero slain.",
  );
});

test("toast message: defender win flips the winner/loser order", () => {
  assert.equal(
    battleToastMessage({
      attackerLabel: "AI 1's Warlord",
      defenderLabel: "AI 2's Warlord",
      winner: "defender",
      attacker: { verdict: "defeated", ownerName: "AI 1" },
    }),
    "AI 2's Warlord defeated AI 1's Warlord — AI 1's hero slain.",
  );
});

test("settlementNameAt resolves the settlement on a hero's relocation hex", () => {
  const settlements = {
    s0: makeSettlement("s0", 0, 2, 2),
    s1: makeSettlement("s1", 1, 18, 4),
  };
  assert.equal(settlementNameAt(settlements, 18, 4), "s1");
  assert.equal(settlementNameAt(settlements, 2, 2), "s0");
  assert.equal(settlementNameAt(settlements, 9, 9), undefined);
});
