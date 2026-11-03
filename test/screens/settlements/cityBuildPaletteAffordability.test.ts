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
  assert.match(emptyRow.title, /Not enough gold \(need 300, have 0\)/);
  assert.equal(emptyRow.style.opacity, "0.5", "an unaffordable row is dimmed");

  // The treasury refills (End Turn) with the palette still open.
  placer.setAffordability({ gold: RICH.gold, warehouse: { ...RICH.warehouse } });
  const restored = rowFor(body, "House");
  assert.equal(restored.title, richTitle, "the row is back to its affordable title");
  assert.equal(restored.style.opacity, "1", "the row is clickable again without a re-open");
  assert.doesNotMatch(restored.title, /Not enough/);
});

test("palette: an unaffordable row is DISABLED, not merely dimmed", () => {
  // Playthrough finding 17: every unaffordable row was dimmed and inert
  // (`renderBuildList` sets opacity 0.5 + the title, and the click handler
  // returns early) but stayed a focusable, ENABLED button
  // (`button.disabled === false`) -- so a keyboard or AT user is told the row
  // is actionable and then nothing happens.
  const { placer, body } = openPlacer();
  assert.equal(rowFor(body, "House").disabled, false, "an affordable row is enabled");

  placer.setAffordability(BROKE);
  assert.equal(rowFor(body, "House").disabled, true, "an unaffordable row is disabled while it says why");

  // The same row is enabled again by the reading that covers it -- the disabled
  // flag rides the snapshot, exactly as the dimming and the title do.
  placer.setAffordability({ gold: RICH.gold, warehouse: { ...RICH.warehouse } });
  assert.equal(rowFor(body, "House").disabled, false, "and enabled again once the treasury covers it");
});

test("palette: a structural refusal is disabled too, not only a treasury one", () => {
  // The flag is the entry status's `disabled`, not "unaffordable": a second
  // town hall is refused for a reason no treasury can change.
  const { body } = openPlacer([{ gx: 0, gy: 0, kind: "townHall", level: 1, w: 2, h: 2 }]);
  const row = rowFor(body, "Town Hall");
  assert.match(row.title, /already exists/, "the row still explains the rule");
  assert.equal(row.disabled, true, "and the rule is stated by the control's own state, not only by its colour");
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
