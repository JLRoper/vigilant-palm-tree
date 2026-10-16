import { test } from "node:test";
import assert from "node:assert/strict";
import { createModalDismissListeners } from "../../../src/screens/shared/menu";

// The stuck-End-Turn bug: the battle verdict card lives on
// openCenteredModal's full-viewport z-300 wrapper, which intercepts every
// click. When the card could only be closed with its own button, a card that
// happened to be up at the moment the player reached for End Turn made the
// toolbar dead. These pin the OPT-IN dismissal wiring -- default behaviour
// (no backdrop click, no Escape) is unchanged for every other caller.

// A bare listener registry; both surfaces the factory touches are covered.
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

test("default options register nothing -- a decision modal keeps today's behaviour", () => {
  const wrapper = listenerTarget();
  const keys = listenerTarget();
  const handles = createModalDismissListeners({
    close: () => assert.fail("must not close"),
    wrapper: wrapper as unknown as HTMLElement,
    keyTarget: keys as unknown as Window,
  });
  assert.equal(wrapper.count("click"), 0);
  assert.equal(keys.count("keydown"), 0);
  handles.detach();
});

test("a backdrop click closes, but a click inside the panel does not", () => {
  const wrapper = listenerTarget();
  const keys = listenerTarget();
  let closes = 0;
  const handles = createModalDismissListeners({
    close: () => {
      closes += 1;
    },
    wrapper: wrapper as unknown as HTMLElement,
    keyTarget: keys as unknown as Window,
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

test("Escape closes and other keys do nothing", () => {
  const wrapper = listenerTarget();
  const keys = listenerTarget();
  let closes = 0;
  const handles = createModalDismissListeners({
    close: () => {
      closes += 1;
    },
    wrapper: wrapper as unknown as HTMLElement,
    keyTarget: keys as unknown as Window,
    escape: true,
  });

  keys.fire("keydown", { key: "Enter" });
  keys.fire("keydown", { key: "e" });
  assert.equal(closes, 0);

  keys.fire("keydown", { key: "Escape" });
  assert.equal(closes, 1);

  handles.detach();
});

test("both routes can be enabled together and both are torn down by detach", () => {
  const wrapper = listenerTarget();
  const keys = listenerTarget();
  let closes = 0;
  const handles = createModalDismissListeners({
    close: () => {
      closes += 1;
    },
    wrapper: wrapper as unknown as HTMLElement,
    keyTarget: keys as unknown as Window,
    backdropClick: true,
    escape: true,
  });
  assert.equal(wrapper.count("click"), 1);
  assert.equal(keys.count("keydown"), 1);

  handles.detach();
  assert.equal(wrapper.count("click"), 0, "detach leaves no listener behind to close an unrelated modal");
  assert.equal(keys.count("keydown"), 0);

  // The whole point: after the modal is gone, clicks/keys reach the page.
  wrapper.fire("click", { target: wrapper });
  keys.fire("keydown", { key: "Escape" });
  assert.equal(closes, 0);

  handles.detach();
  assert.equal(closes, 0, "detach is idempotent");
});