import { test } from "node:test";
import assert from "node:assert/strict";
import { createDialogDismissListeners } from "../../../src/screens/shared/dialog";

// The stuck-End-Turn bug: the battle verdict card lives on openDialog's
// full-viewport z-300 wrapper, which intercepts every click. When the card
// could only be closed with its own button, a card that happened to be up at
// the moment the player reached for End Turn made the toolbar dead. These pin
// the OPT-IN backdrop wiring, and that detach leaves nothing behind.
//
// Escape is deliberately not covered here: it belongs to panelManager for every
// panel (see test/screens/shared/panelManager.test.ts), not to the wrapper, so
// a dialog gets it without asking.

// A bare listener registry: the one surface the factory touches.
function listenerTarget() {
  const listeners = new Map<string, Set<(ev: unknown) => void>>();
  return {
    listeners,
    addEventListener(type: string, fn: (ev: unknown) => void): void {
      const set = listeners.get(type) ?? new Set();
      set.add(fn);
      listeners.set(type, set);
    },
    removeEventListener(type: string, fn: (ev: unknown) => void): void {
      listeners.get(type)?.delete(fn);
    },
    count(type: string): number {
      return listeners.get(type)?.size ?? 0;
    },
    fire(type: string, ev: unknown): void {
      for (const fn of [...(listeners.get(type) ?? [])]) fn(ev);
    },
  };
}

test("without the backdrop option nothing is registered at all", () => {
  const wrapper = listenerTarget();
  const handles = createDialogDismissListeners({
    close: () => assert.fail("must not close"),
    wrapper: wrapper as unknown as HTMLElement,
  });
  assert.equal(wrapper.count("click"), 0);
  handles.detach();
});

test("a backdrop click closes, but a click inside the dialog does not", () => {
  const wrapper = listenerTarget();
  let closes = 0;
  const handles = createDialogDismissListeners({
    close: () => {
      closes += 1;
    },
    wrapper: wrapper as unknown as HTMLElement,
    backdropClick: true,
  });

  const panel = {};
  wrapper.fire("click", { target: panel });
  assert.equal(closes, 0, "a click that landed on the panel is not a backdrop click");

  wrapper.fire("click", { target: null });
  assert.equal(closes, 0, "a click with no target is not a backdrop click");

  wrapper.fire("click", { target: wrapper });
  assert.equal(closes, 1, "a click that landed on the wrapper itself closes");

  handles.detach();
});

test("detach removes the listener and is idempotent", () => {
  const wrapper = listenerTarget();
  let closes = 0;
  const handles = createDialogDismissListeners({
    close: () => {
      closes += 1;
    },
    wrapper: wrapper as unknown as HTMLElement,
    backdropClick: true,
  });
  assert.equal(wrapper.count("click"), 1);

  handles.detach();
  assert.equal(wrapper.count("click"), 0, "detach leaves no listener behind to close an unrelated dialog");

  // The whole point: after the dialog is gone, clicks reach the page.
  wrapper.fire("click", { target: wrapper });
  assert.equal(closes, 0);

  handles.detach();
  assert.equal(closes, 0, "detach is idempotent");
});
