import { test } from "node:test";
import assert from "node:assert/strict";
import { plainLabel, stampPlainLabel } from "../../../src/screens/shared/plainLabel";

// Ledger #21: every toolbar/palette control wears an emoji prefix, so an exact
// `textContent.trim() === "Build"` never matches and a driver falls back to a
// fuzzy `hasText` that also matches unrelated rows. Each control now ALSO
// carries its plain name on `data-label`, which an exact selector can match.

test("ledger #21: plainLabel strips the icon prefix, not the words", () => {
  assert.equal(plainLabel("⛺ Found Settlement"), "Found Settlement");
  assert.equal(plainLabel("⚒ Charter Settlement"), "Charter Settlement");
  assert.equal(plainLabel("⚒ Build"), "Build");
  assert.equal(plainLabel("✖ Close"), "Close");
  assert.equal(plainLabel("✓ Confirm"), "Confirm");
  assert.equal(plainLabel("✕ Cancel"), "Cancel");
  assert.equal(plainLabel("▶ End Turn"), "End Turn");
  assert.equal(plainLabel("🚚 Logistics"), "Logistics");
  assert.equal(plainLabel("← Back"), "Back");
  assert.equal(plainLabel("+  New Game"), "New Game");
  assert.equal(plainLabel("⌨ Shortcuts"), "Shortcuts");
  // A label with no icon is already its own plain name.
  assert.equal(plainLabel("Destroy"), "Destroy");
  // …and an internal symbol is not a prefix: only the leading run is stripped.
  assert.equal(plainLabel("Path 4.6/7"), "Path 4.6/7");
});

test("ledger #21: an icon-only control is given its plain name explicitly, and never an empty hook", () => {
  const attrs = new Map<string, string>();
  const el = {
    setAttribute(name: string, value: string) {
      attrs.set(name, value);
    },
  } as unknown as Element;

  // The gear button's whole text IS the icon: without an explicit name the hook
  // would be empty, and an empty hook matches every icon-only control.
  stampPlainLabel(el, "⚙");
  assert.equal(attrs.has("data-label"), false, "an empty plain name is not stamped");

  stampPlainLabel(el, "⚙", "Menu");
  assert.equal(attrs.get("data-label"), "Menu", "the stated name wins");

  attrs.clear();
  stampPlainLabel(el, "⚒ Build");
  assert.equal(attrs.get("data-label"), "Build");
});
