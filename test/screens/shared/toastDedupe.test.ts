import { test } from "node:test";
import assert from "node:assert/strict";
import { isDuplicateToast, type ToastRecord } from "../../../src/screens/shared/toast";

function record(message: string, kind: ToastRecord["kind"], timestamp: number): ToastRecord {
  return { message, kind, timestamp };
}

test("dedupe: null history never dedupes", () => {
  assert.equal(isDuplicateToast(null, "It's not your turn", "info", 1000), false);
});

test("dedupe: same message+kind inside the window dedupes", () => {
  const last = record("It's not your turn", "info", 1000);
  assert.equal(isDuplicateToast(last, "It's not your turn", "info", 1000 + 1499), true);
  assert.equal(isDuplicateToast(last, "It's not your turn", "info", 1000), true);
});

test("dedupe: same message+kind at or beyond the window boundary does not dedupe", () => {
  const last = record("It's not your turn", "info", 1000);
  assert.equal(isDuplicateToast(last, "It's not your turn", "info", 1000 + 1500), false);
  assert.equal(isDuplicateToast(last, "It's not your turn", "info", 1000 + 5000), false);
});

test("dedupe: a different message does not dedupe", () => {
  const last = record("No path there", "info", 1000);
  assert.equal(isDuplicateToast(last, "It's not your turn", "info", 1050), false);
});

test("dedupe: a different kind does not dedupe even for the same message", () => {
  const last = record("Move rejected", "info", 1000);
  assert.equal(isDuplicateToast(last, "Move rejected", "error", 1050), false);
});

test("dedupe: a custom window is honored (boundary exclusive, same as the default)", () => {
  const last = record("Select a hero first", "info", 0);
  assert.equal(isDuplicateToast(last, "Select a hero first", "info", 2999, 3000), true);
  assert.equal(isDuplicateToast(last, "Select a hero first", "info", 3000, 3000), false);
});
