// An OPEN build palette refreshes its affordability -- no city-view close and
// reopen.
//
// Measured before this fix (round 2 settlers playthrough, Block 6): after End
// Turns refilled a treasury at 0, every palette row still read "Not enough gold
// (need 100, have 0)" at opacity 0.5 and was a silent no-op; it only cleared by
// leaving the city view and re-entering it. The rows are rendered FROM the
// affordability snapshot, so `setAffordability` re-renders the open palette --
// which is what lets cityView's own refresh (on open, and on `turn:ended` /
// `state:committed` while it is open) reach the screen.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { buildListWrap, BROKE, openPlacer, restoreDom, rowFor, RICH } from "./_cityPlacerHarness";

afterEach(() => {
  restoreDom();
});

test("palette: an open palette recovers when the treasury refills, with no re-open", () => {
  const { placer, body } = openPlacer();
  const richTitle = rowFor(body, "House").title;

  placer.setAffordability(BROKE);
  const emptyRow = rowFor(body, "House");
  assert.match(emptyRow.title, /Not enough gold \(need 100, have 0\)/);
  assert.equal(emptyRow.style.opacity, "0.5", "an unaffordable row is dimmed");

  // The treasury refills (End Turn) with the palette still open.
  placer.setAffordability({ gold: RICH.gold, warehouse: { ...RICH.warehouse } });
  const restored = rowFor(body, "House");
  assert.equal(restored.title, richTitle, "the row is back to its affordable title");
  assert.equal(restored.style.opacity, "1", "the row is clickable again without a re-open");
  assert.doesNotMatch(restored.title, /Not enough/);
});

test("palette: the affordability re-render keeps the list where the viewer left it", () => {
  const { placer, body } = openPlacer();
  const before = buildListWrap(body);
  before.scrollTop = 96;

  // A treasury update re-renders the list; the offset is not a scroll reset.
  placer.setAffordability(BROKE);

  const after = buildListWrap(body);
  assert.notEqual(after, before, "the list is rebuilt, not patched");
  assert.equal(after.scrollTop, 96, "the viewer's scroll offset survives the refresh");
});
