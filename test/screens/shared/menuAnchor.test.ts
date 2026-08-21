// Regression coverage for issue #140: the hero and settlement info panels
// positioned themselves with `window.innerHeight - <guessed panel height>`.
// The guesses were 239px and 67px short of the panels' real heights, so both
// opened with their lower half below the viewport edge and nothing scrolled.
// anchorMenuToBottom replaces the guess with the measured box.
//
// jsdom is intentionally not added; node:test provides the harness (see
// test/screens/combat/arena.test.ts for the established pattern).

import { test } from "node:test";
import assert from "node:assert/strict";
import { anchorMenuToBottom, clampMenuIntoView, type PopupMenu } from "../../../src/screens/shared/menu";

const VIEWPORT_MARGIN = 24;

// The helpers only touch root.style.position, root.style.maxHeight,
// getBoundingClientRect and the position accessors, so a hand-rolled stand-in
// is enough. The rect honours maxHeight the way a real layout would, so a test
// can tell whether the helper's height cap is doing anything.
function makeMenu(
  width: number,
  naturalHeight: number,
  pos = { x: 0, y: 0 },
  position = "absolute",
) {
  const state = { pos: { ...pos } };
  const style = { position, maxHeight: "" };
  return {
    get pos() { return state.pos; },
    get height() {
      const cap = parseFloat(style.maxHeight);
      return Number.isFinite(cap) ? Math.min(naturalHeight, cap) : naturalHeight;
    },
    root: {
      style,
      getBoundingClientRect(): { width: number; height: number } {
        const cap = parseFloat(style.maxHeight);
        return { width, height: Number.isFinite(cap) ? Math.min(naturalHeight, cap) : naturalHeight };
      },
    },
    getPosition: () => ({ ...state.pos }),
    setPosition: (x: number, y: number) => { state.pos = { x, y }; },
  };
}

function withViewport(width: number, height: number, fn: () => void): void {
  const saved = (globalThis as { window?: unknown }).window;
  (globalThis as { window: unknown }).window = { innerWidth: width, innerHeight: height };
  try {
    fn();
  } finally {
    if (saved === undefined) delete (globalThis as { window?: unknown }).window;
    else (globalThis as { window: unknown }).window = saved;
  }
}

test("anchorMenuToBottom keeps the measured panel fully on screen", () => {
  // The exact numbers from issue #140: a 519px hero panel in a 720px viewport.
  // The old `innerHeight - 280` guess produced top: 440, bottom: 959 — 239px
  // below the viewport edge.
  withViewport(1280, 720, () => {
    const menu = makeMenu(240, 519);
    anchorMenuToBottom(menu as unknown as PopupMenu, 16, 48);
    assert.equal(menu.pos.x, 16);
    assert.equal(menu.pos.y, 720 - 519 - VIEWPORT_MARGIN);
    assert.ok(menu.pos.y + 519 <= 720, "the panel's bottom edge must be inside the viewport");
  });
});

test("anchorMenuToBottom keeps the army-expanded panel on screen", () => {
  // Expanding Army grew the panel to 674px; the old guess left it 394px off
  // screen. 674px does not fit under a 48px toolbar in a 720px viewport, so
  // the helper has to cap the height as well as place the box.
  withViewport(1280, 720, () => {
    const menu = makeMenu(240, 674);
    anchorMenuToBottom(menu as unknown as PopupMenu, 16, 48);
    assert.ok(menu.height < 674, "an over-tall panel must be capped so its body scrolls instead");
    assert.ok(menu.pos.y >= 48, "the panel must stay clear of the toolbar");
    assert.ok(menu.pos.y + menu.height <= 720, "the expanded panel must stay inside the viewport");
  });
});

test("anchorMenuToBottom never pushes the header under the toolbar", () => {
  // A panel taller than the space below the toolbar has to give up its bottom
  // edge, not its header — the header carries the drag handle and the close
  // button, so it is the part that must stay reachable.
  withViewport(1280, 600, () => {
    const menu = makeMenu(240, 580);
    anchorMenuToBottom(menu as unknown as PopupMenu, 16, 48);
    assert.equal(menu.pos.y, 48, "the panel must stop at minTop rather than slide under the toolbar");
    assert.ok(menu.pos.y + menu.height <= 600, "and its bottom edge must still be inside the viewport");
  });
});

test("clampMenuIntoView pulls a dragged panel back after the window shrinks", () => {
  withViewport(1280, 720, () => {
    const menu = makeMenu(240, 519, { x: 900, y: 180 });
    clampMenuIntoView(menu as unknown as PopupMenu, 48);
    assert.deepEqual(menu.pos, { x: 900, y: 180 }, "a panel already in view must not move");
  });
  withViewport(600, 400, () => {
    const menu = makeMenu(240, 300, { x: 900, y: 180 });
    clampMenuIntoView(menu as unknown as PopupMenu, 48);
    assert.deepEqual(menu.pos, { x: 600 - 240, y: 400 - 300 });
  });
});

test("clampMenuIntoView leaves non-absolute menus alone", () => {
  // Docked rail panels sit in normal flow; writing left/top would fight the
  // rail's layout.
  withViewport(1280, 720, () => {
    const menu = makeMenu(240, 519, { x: 900, y: 900 }, "");
    clampMenuIntoView(menu as unknown as PopupMenu, 48);
    assert.deepEqual(menu.pos, { x: 900, y: 900 });
  });
});
