// E5 (playthrough round 2b): the palette row's build time was a bare digit
// beside an hourglass glyph -- no label on the row, none in its tooltip, and
// nothing saying that a site under construction is charged its upkeep while it
// produces nothing. Both facts are stated on the row now: the tooltip carries
// the sentence (buildEntryStatus) and the glyph + digit carry the short label,
// so a pointer, a keyboard user and a screen reader read the same thing.
//
// Driven through the real BuildingPlacer with the shared mock-DOM harness.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { buildRowButtons, openPlacer, restoreDom } from "./_cityPlacerHarness";
import type { MockElement, MockNode } from "./_cityPlacerHarness";

afterEach(() => {
  restoreDom();
});

function findAll(root: MockNode, match: (el: MockElement) => boolean): MockElement[] {
  const out: MockElement[] = [];
  const walk = (node: MockNode): void => {
    if ((node as MockElement).tagName && match(node as MockElement)) out.push(node as MockElement);
    for (const child of node.children) walk(child);
  };
  walk(root);
  return out;
}

function rowFor(root: Parameters<typeof buildRowButtons>[0], label: string) {
  const rows = buildRowButtons(root);
  const row = rows.find((b) => b.textContent.endsWith(label));
  if (!row) throw new Error(`palette row "${label}" must exist; saw ${rows.map((b) => b.textContent).join(" | ")}`);
  return row;
}

test("E5: the build-time glyph and its digit are labelled, and the row tooltip states the whole rule", () => {
  const { body } = openPlacer();
  const row = rowFor(body, "Farm Field (2\u00D72)");

  assert.match(
    row.title,
    /Build time: 2 days at 1 builder, up to 2\.00\u00d7 with 4 \u2014 its upkeep is paid while it is under construction, it produces nothing until it is finished, and a site with no builders makes no progress/,
    "the row's tooltip prices the wait, the crew and the stall before the click",
  );

  const glyphs = findAll(row, (el) => el.tagName === "IMG" && (el.alt ?? "").includes("Build time"));
  assert.equal(glyphs.length, 1, "the hourglass glyph is the labelled one, and there is exactly one");
  assert.equal(glyphs[0].alt, "Build time: 2 days");
  assert.equal(glyphs[0].title, "Build time: 2 days", "the same sentence for a pointer");

  const digits = findAll(row, (el) => el.tagName === "SPAN" && el.textContent === "2" && (el.title ?? "").includes("Build time"));
  assert.equal(digits.length, 1, "the bare digit beside it is labelled too");
  assert.equal(digits[0].title, "Build time: 2 days");
});

test("E5: a kind that builds instantly carries no build-time label at all", () => {
  // The town hall is the registry's only 0-day kind, and it is "(built)" in a
  // real city grid -- the row is found on an empty grid, where it is offered.
  const { body } = openPlacer();
  const row = rowFor(body, "Town Hall (2\u00D72)");
  assert.ok(!/Build time:/.test(row.title), `a 0-day kind states no wait: ${row.title}`);
  assert.equal(findAll(row, (el) => (el.title ?? "").includes("Build time")).length, 0);
});
