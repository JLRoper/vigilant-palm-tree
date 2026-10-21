import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STACK_MIN_SECTION,
  STACK_SEAM,
  equalWeights,
  findStackClusters,
  layoutStackSections,
  moveStackSeam,
  resizeStackLength,
  resizeStackLengthEvenly,
  resizeStackSplit,
  sectionCaps,
  stackAvailable,
  type StackRect,
} from "../../../src/screens/shared/panelTilingLayout";

const BOUNDS = { minTop: 60, maxBottom: 1000 };

test("only overlapping panels form a stack, sorted top to bottom", () => {
  const rects: StackRect[] = [
    { id: 1, x: 10, y: 400, w: 300, h: 300 },
    { id: 2, x: 60, y: 100, w: 300, h: 400 },
    { id: 3, x: 900, y: 100, w: 200, h: 200 },
  ];
  const clusters = findStackClusters(rects);
  assert.equal(clusters.length, 1);
  assert.deepEqual(clusters[0].map((r) => r.id), [2, 1]);
});

test("panels touching top to bottom stack, side-by-side panels do not", () => {
  const above: StackRect = { id: 1, x: 0, y: 100, w: 200, h: 100 };
  assert.equal(findStackClusters([above, { id: 2, x: 0, y: 200, w: 200, h: 100 }]).length, 1, "edge to edge");
  assert.equal(findStackClusters([above, { id: 2, x: 40, y: 200 + STACK_SEAM, w: 300, h: 100 }]).length, 1, "within a seam, any width");
  assert.equal(findStackClusters([above, { id: 2, x: 0, y: 220, w: 200, h: 100 }]).length, 0, "a real gap");
  assert.equal(findStackClusters([above, { id: 2, x: 200, y: 100, w: 200, h: 100 }]).length, 0, "beside it");
});

test("a lock link keeps panels together even when they no longer touch", () => {
  const rects: StackRect[] = [
    { id: 1, x: 0, y: 100, w: 200, h: 100 },
    { id: 2, x: 500, y: 600, w: 200, h: 100 },
  ];
  assert.equal(findStackClusters(rects, [[1, 2]]).length, 1);
});

test("overlap chains join into one stack", () => {
  const rects: StackRect[] = [
    { id: 1, x: 0, y: 100, w: 200, h: 200 },
    { id: 2, x: 150, y: 250, w: 200, h: 200 },
    { id: 3, x: 300, y: 400, w: 200, h: 200 },
  ];
  assert.deepEqual(findStackClusters(rects)[0].map((r) => r.id), [1, 2, 3]);
});

test("sections split the joint span equally with a seam between each", () => {
  const members: StackRect[] = [
    { id: 1, x: 0, y: 100, w: 200, h: 500 },
    { id: 2, x: 0, y: 300, w: 200, h: 406 },
  ];
  const sections = layoutStackSections(members, equalWeights(2), BOUNDS);
  assert.deepEqual(sections, [
    { id: 1, y: 100, h: 300 },
    { id: 2, y: 100 + 300 + STACK_SEAM, h: 300 },
  ]);
});

test("the span is clamped to the viewport and grown to fit every minimum", () => {
  const tall: StackRect[] = [
    { id: 1, x: 0, y: 500, w: 200, h: 900 },
    { id: 2, x: 0, y: 600, w: 200, h: 900 },
  ];
  const sections = layoutStackSections(tall, equalWeights(2), BOUNDS);
  assert.equal(sections[1].y + sections[1].h, BOUNDS.maxBottom);

  const tiny: StackRect[] = [
    { id: 1, x: 0, y: 950, w: 200, h: 40 },
    { id: 2, x: 0, y: 960, w: 200, h: 30 },
  ];
  const squeezed = layoutStackSections(tiny, equalWeights(2), BOUNDS);
  for (const s of squeezed) assert.ok(s.h >= STACK_MIN_SECTION, `section ${s.id} keeps its minimum`);
  assert.equal(squeezed[1].y + squeezed[1].h, BOUNDS.maxBottom);
});

test("the layout is stable when re-run on the same home rects", () => {
  const members: StackRect[] = [
    { id: 1, x: 0, y: 100, w: 200, h: 700 },
    { id: 2, x: 0, y: 300, w: 200, h: 300 },
  ];
  const first = layoutStackSections(members, equalWeights(2), BOUNDS);
  const second = layoutStackSections(members, equalWeights(2), BOUNDS);
  assert.deepEqual(first, second);
});

test("a short panel takes only the height it needs and the rest goes to the others", () => {
  const members: StackRect[] = [
    { id: 1, x: 0, y: 100, w: 200, h: 800 },
    { id: 2, x: 0, y: 300, w: 200, h: 150 },
    { id: 3, x: 0, y: 400, w: 200, h: 800 },
  ];
  const available = stackAvailable(members, BOUNDS);
  const sections = layoutStackSections(members, equalWeights(3), BOUNDS);
  assert.equal(sections[1].h, 150, "the short panel is capped at its natural height");
  assert.equal(sections[0].h + sections[2].h, available - 150, "the tall panels share the rest");
  assert.ok(Math.abs(sections[0].h - sections[2].h) <= 1, "equally");
});

test("a short bottom panel keeps its content height and the panel above takes the rest", () => {
  const members: StackRect[] = [
    { id: 1, x: 0, y: 100, w: 200, h: 300 },
    { id: 2, x: 0, y: 350, w: 200, h: 100 },
  ];
  const sections = layoutStackSections(members, equalWeights(2), BOUNDS);
  assert.deepEqual(sections, [
    { id: 1, y: 100, h: 350 - 100 - STACK_SEAM },
    { id: 2, y: 350, h: 100 },
  ]);
});

test("moving a seam trades height between its two neighbours only", () => {
  const members: StackRect[] = [
    { id: 1, x: 0, y: 100, w: 200, h: 900 },
    { id: 2, x: 0, y: 200, w: 200, h: 900 },
    { id: 3, x: 0, y: 300, w: 200, h: 900 },
  ];
  const before = layoutStackSections(members, equalWeights(3), BOUNDS);
  const heights = resizeStackSplit(before.map((s) => s.h), sectionCaps(members), 0, 50);
  const after = layoutStackSections(members, heights, BOUNDS);
  assert.ok(Math.abs(after[0].h - (before[0].h + 50)) <= 1, "the section grows");
  assert.ok(Math.abs(after[1].h - (before[1].h - 50)) <= 1, "the one beneath shrinks");
  assert.ok(Math.abs(after[2].h - before[2].h) <= 1, "the rest are untouched");
});

test("a seam drag stops at the neighbour's minimum and at the section's content height", () => {
  assert.deepEqual(resizeStackSplit([300, 300], [900, 900], 0, 10_000), [600 - STACK_MIN_SECTION, STACK_MIN_SECTION]);
  assert.deepEqual(resizeStackSplit([300, 300], [350, 900], 0, 10_000), [350, 250], "no growing past content");
  assert.deepEqual(resizeStackSplit([300, 300], [900, 900], 1, 50), [300, 300], "no seam below the last section");
});

test("a custom length shortens the column and only the bottom section gives up height", () => {
  const members: StackRect[] = [
    { id: 1, x: 0, y: 100, w: 200, h: 900 },
    { id: 2, x: 0, y: 200, w: 200, h: 900 },
  ];
  const before = layoutStackSections(members, equalWeights(2), BOUNDS);
  const { heights, length } = resizeStackLength(before.map((s) => s.h), -150, BOUNDS.maxBottom - 100);
  const after = layoutStackSections(members, heights, BOUNDS, { length });
  assert.equal(after[0].h, before[0].h, "the top section is untouched");
  assert.equal(after[1].h, before[1].h - 150, "the bottom section shrinks");
  assert.equal(after[1].y + after[1].h, before[1].y + before[1].h - 150, "the column ends higher");
});

test("the column length is clamped to the viewport and to the bottom section's minimum", () => {
  const grown = resizeStackLength([300, 300], 10_000, 700);
  assert.equal(grown.length, 700);
  assert.equal(grown.heights[1], 700 - 300 - STACK_SEAM);
  const shrunk = resizeStackLength([300, 300], -10_000, 700);
  assert.equal(shrunk.heights[1], STACK_MIN_SECTION);
});

test("a raised cap lets the bottom section grow past its content when the column is lengthened", () => {
  const members: StackRect[] = [
    { id: 1, x: 0, y: 100, w: 200, h: 300 },
    { id: 2, x: 0, y: 350, w: 200, h: 100 },
  ];
  const before = layoutStackSections(members, equalWeights(2), BOUNDS);
  const { heights, length } = resizeStackLength(before.map((s) => s.h), 200, BOUNDS.maxBottom - 100);
  const caps = sectionCaps(members).map((c, i) => (i === 1 ? Math.max(c, heights[1]) : c));
  const after = layoutStackSections(members, heights, BOUNDS, { length, caps });
  assert.deepEqual(after.map((s) => s.h), [before[0].h, before[1].h + 200]);
});

test("stretching the column spreads the change equally across every section", () => {
  const shrunk = resizeStackLengthEvenly([300, 200, 250], -90, 2000);
  assert.deepEqual(shrunk.heights, [270, 170, 220]);
  assert.equal(shrunk.length, 660 + 2 * STACK_SEAM);
  const grown = resizeStackLengthEvenly([300, 200, 250], 60, 2000);
  assert.deepEqual(grown.heights, [320, 220, 270]);
});

test("a section at its minimum stops shrinking and the others take the rest", () => {
  const { heights } = resizeStackLengthEvenly([300, 90, 300], -60, 2000);
  assert.equal(heights[1], STACK_MIN_SECTION);
  assert.equal(heights[0] + heights[2], 600 - 50);
  const floor = resizeStackLengthEvenly([300, 300], -10_000, 2000);
  assert.deepEqual(floor.heights, [STACK_MIN_SECTION, STACK_MIN_SECTION]);
  const ceiling = resizeStackLengthEvenly([300, 300], 10_000, 700);
  assert.equal(ceiling.length, 700);
});

test("a seam still moves when a cap is below a section's current height", () => {
  assert.deepEqual(resizeStackSplit([397, 136], [150, 200], 0, -40), [357, 176], "shrink the upper");
  assert.deepEqual(resizeStackSplit([397, 136], [150, 200], 0, 40), [397, 136], "no growing further past content");
});

const SEAMS = (n: number): number => (n - 1) * STACK_SEAM;

test("dragging a seam up stretches the lower panel to its content, then carries it up", () => {
  const r = moveStackSeam([332, 150], [900, 201], [false, false], 0, -80, 0);
  assert.deepEqual(r.heights, [252, 201], "the lower panel stops at its content height");
  assert.equal(r.length, 252 + 201 + SEAMS(2), "the column ends higher, leaving space beneath");
});

test("a height-locked lower panel keeps its height and the next unlocked panel takes the change", () => {
  const r = moveStackSeam([300, 200, 200], [900, 900, 900], [false, true, false], 0, -50, 0);
  assert.deepEqual(r.heights, [250, 200, 250]);
  assert.equal(r.length, 700 + SEAMS(3), "the column length is unchanged");
});

test("a height-locked lower panel with nothing unlocked beneath is carried with the seam", () => {
  const up = moveStackSeam([300, 200], [900, 900], [false, true], 0, -50, 0);
  assert.deepEqual(up.heights, [250, 200]);
  assert.equal(up.length, 450 + SEAMS(2));
  const down = moveStackSeam([300, 200], [900, 900], [false, true], 0, 40, 100);
  assert.deepEqual(down.heights, [340, 200]);
  assert.equal(down.length, 540 + SEAMS(2), "pushed down within the room left on screen");
  const blocked = moveStackSeam([300, 200], [900, 900], [false, true], 0, 40, 10);
  assert.deepEqual(blocked.heights, [310, 200], "no further than the bottom of the screen");
});

test("a seam cannot move when every panel above it is height-locked", () => {
  const r = moveStackSeam([300, 200], [900, 900], [true, false], 0, -50, 100);
  assert.deepEqual(r.heights, [300, 200]);
  assert.deepEqual(moveStackSeam([300, 200], [900, 900], [true, false], 0, 50, 100).heights, [300, 200]);
});

test("height-locked sections keep their height in the default layout and the equal stretch", () => {
  const members: StackRect[] = [
    { id: 1, x: 0, y: 100, w: 200, h: 900 },
    { id: 2, x: 0, y: 200, w: 200, h: 900 },
    { id: 3, x: 0, y: 300, w: 200, h: 900 },
  ];
  const sections = layoutStackSections(members, equalWeights(3), BOUNDS, { fixed: [null, 150, null] });
  assert.equal(sections[1].h, 150);
  assert.ok(Math.abs(sections[0].h - sections[2].h) <= 1);
  const stretched = resizeStackLengthEvenly([300, 150, 300], -60, 2000, [false, true, false]);
  assert.deepEqual(stretched.heights, [270, 150, 270]);
});
