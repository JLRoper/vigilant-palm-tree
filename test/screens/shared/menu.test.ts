// Regression coverage for issue #141: openCenteredModal owns a full-screen
// backdrop that only its own onClose removed, and PopupMenu.setOnClose
// overwrote that slot -- so every caller using setOnClose (the battle result
// card, the multiplayer lobby) left an invisible click-eating scrim welded
// over the game. jsdom is intentionally not added; node:test provides the
// harness (see test/screens/combat/arena.test.ts for the established pattern).

import { test } from "node:test";
import assert from "node:assert/strict";
import type { BattleResult } from "@heroes/engine";
import { openCenteredModal } from "../../../src/screens/shared/menu";
import { openConfirmDialog } from "../../../src/screens/shared/confirmDialog";
import { showBattleResultCard } from "../../../src/screens/combat/battleResultCard";

class MockElement {
  readonly tagName: string;
  readonly style: Record<string, string> = {};
  readonly children: MockElement[] = [];
  parentElement: MockElement | null = null;
  textContent = "";
  title = "";
  private readonly listeners = new Map<string, Array<(...args: unknown[]) => unknown>>();

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  appendChild(child: MockElement): MockElement {
    child.parentElement?.removeChild(child);
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  insertBefore(child: MockElement, ref: MockElement | null): MockElement {
    const i = ref === null ? -1 : this.children.indexOf(ref);
    child.parentElement = this;
    if (i < 0) this.children.push(child);
    else this.children.splice(i, 0, child);
    return child;
  }

  removeChild(child: MockElement): void {
    const i = this.children.indexOf(child);
    if (i >= 0) this.children.splice(i, 1);
    child.parentElement = null;
  }

  replaceChildren(...next: MockElement[]): void {
    for (const c of this.children.splice(0)) c.parentElement = null;
    for (const c of next) this.appendChild(c);
  }

  remove(): void {
    this.parentElement?.removeChild(this);
  }

  addEventListener(event: string, handler: (...args: unknown[]) => unknown): void {
    const list = this.listeners.get(event) ?? [];
    list.push(handler);
    this.listeners.set(event, list);
  }

  dispatch(event: string, arg: unknown = { stopPropagation() {} }): void {
    for (const h of [...(this.listeners.get(event) ?? [])]) h(arg);
  }

  findByText(text: string): MockElement | null {
    if (this.textContent === text) return this;
    for (const c of this.children) {
      const hit = c.findByText(text);
      if (hit) return hit;
    }
    return null;
  }
}

const savedDocument = (globalThis as { document?: unknown }).document;
const savedWindow = (globalThis as { window?: unknown }).window;

interface Dom {
  body: MockElement;
  windowListeners: Map<string, number>;
}

function installDom(): Dom {
  const body = new MockElement("body");
  const windowListeners = new Map<string, number>();
  (globalThis as { document: unknown }).document = {
    createElement: (tag: string) => new MockElement(tag),
    body,
  };
  (globalThis as { window: unknown }).window = {
    innerWidth: 1280,
    innerHeight: 720,
    addEventListener(event: string): void {
      windowListeners.set(event, (windowListeners.get(event) ?? 0) + 1);
    },
    removeEventListener(event: string): void {
      windowListeners.set(event, (windowListeners.get(event) ?? 0) - 1);
    },
  };
  return { body, windowListeners };
}

function restoreDom(): void {
  if (savedDocument === undefined) delete (globalThis as { document?: unknown }).document;
  else (globalThis as { document: unknown }).document = savedDocument;
  if (savedWindow === undefined) delete (globalThis as { window?: unknown }).window;
  else (globalThis as { window: unknown }).window = savedWindow;
}

function makeBattleResult(): BattleResult {
  return {
    winner: "attacker",
    rounds: 3,
    attackerResults: [],
    defenderResults: [],
  } as unknown as BattleResult;
}

test("openCenteredModal removes its backdrop even after setOnClose replaces the close callback", () => {
  const dom = installDom();
  try {
    const modal = openCenteredModal(document.body as unknown as HTMLElement, "Test", 320);
    assert.equal(dom.body.children.length, 1, "backdrop should be attached while the modal is open");

    let replacementCalls = 0;
    modal.setOnClose(() => { replacementCalls += 1; });
    modal.close();

    assert.equal(replacementCalls, 1, "the caller's own onClose must still run");
    assert.equal(dom.body.children.length, 0, "backdrop must be detached on close");
    assert.equal(dom.windowListeners.get("resize") ?? 0, 0, "resize listener must be released");
  } finally {
    restoreDom();
  }
});

test("repeated modal open/close cycles leave no backdrops stacked on the body", () => {
  const dom = installDom();
  try {
    for (let i = 0; i < 3; i++) {
      const modal = openCenteredModal(document.body as unknown as HTMLElement, `Test ${i}`, 320);
      modal.setOnClose(() => {});
      modal.close();
    }
    assert.equal(dom.body.children.length, 0, "no scrim may accumulate across open/close cycles");
    assert.equal(dom.windowListeners.get("resize") ?? 0, 0, "no resize listener may accumulate");
  } finally {
    restoreDom();
  }
});

test("addCloseHandler teardown runs once and before the caller's onClose", () => {
  const dom = installDom();
  try {
    const order: string[] = [];
    const modal = openCenteredModal(document.body as unknown as HTMLElement, "Test", 320);
    modal.addCloseHandler(() => order.push("handler"));
    modal.setOnClose(() => order.push("onClose"));

    modal.close();
    modal.close();

    assert.deepEqual(order, ["handler", "onClose", "onClose"], "close handlers must not re-run");
    assert.equal(dom.body.children.length, 0);
  } finally {
    restoreDom();
  }
});

test("Carry On on the battle result card tears the card down and reports back once", () => {
  const dom = installDom();
  try {
    let carryOnCalls = 0;
    showBattleResultCard({
      result: makeBattleResult(),
      attackerLabel: "Attacker",
      defenderLabel: "Defender",
      onCarryOn: () => { carryOnCalls += 1; },
    });

    const carryOn = dom.body.findByText("Carry On");
    assert.ok(carryOn, "the card should render a Carry On button");
    carryOn.dispatch("click");

    assert.equal(carryOnCalls, 1, "onCarryOn must fire exactly once");
    assert.equal(dom.body.children.length, 0, "the card and its backdrop must both be detached");
  } finally {
    restoreDom();
  }
});

test("confirm dialog backdrop survives a caller replacing onClose", () => {
  const dom = installDom();
  try {
    const menu = openConfirmDialog({
      title: "Retreat",
      message: "Retreat from this battle?",
      onConfirm: () => {},
    });
    menu.setOnClose(() => {});
    menu.close();
    assert.equal(dom.body.children.length, 0, "backdrop must be detached on close");
  } finally {
    restoreDom();
  }
});
