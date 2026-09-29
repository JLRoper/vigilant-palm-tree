import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldShowResultCard } from "../../src/screens/combat/resultCardPolicy";

test("shouldShowResultCard: AI-vs-AI battles are suppressed (D4 silent policy)", () => {
  assert.equal(shouldShowResultCard(0, 1, 2), false);
  assert.equal(shouldShowResultCard(0, 2, 1), false);
});

test("shouldShowResultCard: an AI attack on the local human's hero still shows the card", () => {
  assert.equal(shouldShowResultCard(0, 1, 0), true);
  assert.equal(shouldShowResultCard(2, 0, 2), true);
});

test("shouldShowResultCard: the local human attacking keeps the existing card flow", () => {
  assert.equal(shouldShowResultCard(0, 0, 1), true);
});

test("shouldShowResultCard: a fight between two remote seats (AI or human) shows no local card", () => {
  assert.equal(shouldShowResultCard(0, 1, 3), false);
  assert.equal(shouldShowResultCard(0, 1, 2), false);
});

test("shouldShowResultCard: an unknown local seat shows no card", () => {
  assert.equal(shouldShowResultCard(null, 0, 1), false);
});
