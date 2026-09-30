import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePlatoons } from "@heroes/engine";
import {
  formatStacksLabel,
  openAssaultConfirmModal,
  pluralizeUnitName,
} from "../../../src/screens/combat/assaultConfirmModal";

test("formatStacksLabel: per-unit counts across platoons in first-seen order", () => {
  const stacks = normalizePlatoons([
    { entries: [{ unitTypeId: "crossbowman", count: 10 }] },
    { entries: [{ unitTypeId: "griffin", count: 2 }] },
  ]);
  assert.equal(
    formatStacksLabel(stacks, { crossbowman: "Crossbowman", griffin: "Griffin" }),
    "10 Crossbowmen, 2 Griffins",
  );
});

test("formatStacksLabel: aggregates the same unit spread over platoons", () => {
  const stacks = normalizePlatoons([
    { entries: [{ unitTypeId: "swordsman", count: 3 }] },
    { entries: [{ unitTypeId: "swordsman", count: 1 }] },
  ]);
  assert.equal(formatStacksLabel(stacks, { swordsman: "Swordsman" }), "4 Swordsmen");
});

test("formatStacksLabel: singular stays singular, unknown ids fall back to the raw id", () => {
  const stacks = normalizePlatoons([
    { entries: [{ unitTypeId: "griffin", count: 1 }, { unitTypeId: "mystery_unit", count: 2 }] },
  ]);
  assert.equal(formatStacksLabel(stacks, { griffin: "Griffin" }), "1 Griffin, 2 mystery_units");
});

test("formatStacksLabel: empty and zero-only stacks render no troops", () => {
  assert.equal(formatStacksLabel([], {}), "no troops");
  assert.equal(
    formatStacksLabel(normalizePlatoons([{ entries: [{ unitTypeId: "archer", count: 0 }] }]), { archer: "Archer" }),
    "no troops",
  );
});

test("pluralizeUnitName: -man → -men, consonant-y → -ies, default +s, count 1 singular", () => {
  assert.equal(pluralizeUnitName("Swordsman", 2), "Swordsmen");
  assert.equal(pluralizeUnitName("Crossbowman", 4), "Crossbowmen");
  assert.equal(pluralizeUnitName("Cavalry", 4), "Cavalries");
  assert.equal(pluralizeUnitName("Griffin", 2), "Griffins");
  assert.equal(pluralizeUnitName("Black Dragon", 2), "Black Dragons");
  assert.equal(pluralizeUnitName("Griffin", 1), "Griffin");
});

// ---- Minimal DOM mock (same hand-rolled approach as arena.test.ts; the
// assault modal only needs createElement/style/textContent/append/click +
// window keydown listeners) ----------------------------------------------

class MockElement {
  readonly tagName: string;
  readonly children: MockElement[] = [];
  parent: MockElement | null = null;
  style: Record<string, string> = {};
  textContent = "";
  title = "";
  private readonly listeners = new Map<string, Array<() => void>>();

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  appendChild(child: MockElement): MockElement {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  append(...nodes: MockElement[]): void {
    for (const n of nodes) this.appendChild(n);
  }

  addEventListener(event: string, handler: () => void): void {
    const list = this.listeners.get(event) ?? [];
    list.push(handler);
    this.listeners.set(event, list);
  }

  dispatch(event: string): void {
    for (const handler of this.listeners.get(event) ?? []) handler();
  }

  remove(): void {
    if (!this.parent) return;
    const i = this.parent.children.indexOf(this);
    if (i >= 0) this.parent.children.splice(i, 1);
    this.parent = null;
  }
}

class MockWindow {
  innerWidth = 1280;
  innerHeight = 720;
  private readonly listeners = new Map<string, Array<(e: { key: string; preventDefault: () => void }) => void>>();

  addEventListener(event: string, handler: (e: { key: string; preventDefault: () => void }) => void): void {
    const list = this.listeners.get(event) ?? [];
    list.push(handler);
    this.listeners.set(event, list);
  }

  removeEventListener(event: string, handler: (e: { key: string; preventDefault: () => void }) => void): void {
    const list = this.listeners.get(event) ?? [];
    const i = list.indexOf(handler);
    if (i >= 0) list.splice(i, 1);
  }

  dispatchKey(key: string): void {
    const event = { key, preventDefault: () => {} };
    for (const handler of this.listeners.get("keydown") ?? []) handler(event);
  }

  keydownListenerCount(): number {
    return (this.listeners.get("keydown") ?? []).length;
  }
}

const savedDocument = (globalThis as { document?: unknown }).document;
const savedWindow = (globalThis as { window?: unknown }).window;
let mockWin: MockWindow = new MockWindow();

function installDom(): void {
  mockWin = new MockWindow();
  (globalThis as { document: unknown }).document = {
    createElement(tag: string): MockElement {
      return new MockElement(tag);
    },
    body: new MockElement("body"),
  };
  (globalThis as { window: unknown }).window = mockWin;
}

function restoreDom(): void {
  if (savedDocument === undefined) delete (globalThis as { document?: unknown }).document;
  else (globalThis as { document?: unknown }).document = savedDocument;
  if (savedWindow === undefined) delete (globalThis as { window?: unknown }).window;
  else (globalThis as { window?: unknown }).window = savedWindow;
}

function docBody(): MockElement {
  return (globalThis as { document: { body: MockElement } }).document.body;
}

function findElements(root: MockElement, tagName: string, textContent?: string): MockElement[] {
  const found: MockElement[] = [];
  const walk = (node: MockElement): void => {
    if (node.tagName === tagName && (textContent === undefined || node.textContent === textContent)) {
      found.push(node);
    }
    for (const child of node.children) walk(child);
  };
  walk(root);
  return found;
}

test("openAssaultConfirmModal builds title, summary lines, and the three buttons", () => {
  installDom();
  try {
    openAssaultConfirmModal({
      settlementName: "Haven",
      attackerSummary: "10 Crossbowmen",
      garrisonSummary: "4 Swordsmen",
      onAssault: () => {},
      onAutoResolve: () => {},
      onCancel: () => {},
    });
    assert.equal(findElements(docBody(), "DIV", "Assault on Haven").length, 1, "title carries the settlement name");
    assert.equal(findElements(docBody(), "DIV", "You: 10 Crossbowmen").length, 1, "attacker summary line");
    assert.equal(findElements(docBody(), "DIV", "Garrison: 4 Swordsmen").length, 1, "garrison summary line");
    assert.equal(findElements(docBody(), "BUTTON", "Assault").length, 1, "Assault button");
    assert.equal(findElements(docBody(), "BUTTON", "Auto-resolve").length, 1, "Auto-resolve button");
    assert.equal(findElements(docBody(), "BUTTON", "Cancel").length, 1, "Cancel button");
  } finally {
    restoreDom();
  }
});

test("Assault fires onAssault exactly once, detaches the modal, and drops the Esc listener", () => {
  installDom();
  try {
    const counts = { assaults: 0, autos: 0, cancels: 0 };
    openAssaultConfirmModal({
      settlementName: "Haven",
      attackerSummary: "10 Crossbowmen",
      garrisonSummary: "4 Swordsmen",
      onAssault: () => {
        counts.assaults += 1;
      },
      onAutoResolve: () => {
        counts.autos += 1;
      },
      onCancel: () => {
        counts.cancels += 1;
      },
    });
    assert.equal(mockWin.keydownListenerCount(), 1, "the Esc listener is armed while open");
    const assaultBtn = findElements(docBody(), "BUTTON", "Assault")[0];
    assaultBtn.dispatch("click");
    assaultBtn.dispatch("click");
    assert.equal(counts.assaults, 1, "the closed flag makes a second click a no-op");
    assert.equal(counts.autos, 0);
    assert.equal(counts.cancels, 0);
    assert.equal(docBody().children.length, 0, "the modal is detached after the choice");
    assert.equal(mockWin.keydownListenerCount(), 0, "the Esc listener is removed after the choice");
  } finally {
    restoreDom();
  }
});

test("Auto-resolve fires onAutoResolve and nothing else", () => {
  installDom();
  try {
    const counts = { assaults: 0, autos: 0, cancels: 0 };
    openAssaultConfirmModal({
      settlementName: "Haven",
      attackerSummary: "10 Crossbowmen",
      garrisonSummary: "4 Swordsmen",
      onAssault: () => {
        counts.assaults += 1;
      },
      onAutoResolve: () => {
        counts.autos += 1;
      },
      onCancel: () => {
        counts.cancels += 1;
      },
    });
    findElements(docBody(), "BUTTON", "Auto-resolve")[0].dispatch("click");
    assert.equal(counts.autos, 1);
    assert.equal(counts.assaults, 0);
    assert.equal(counts.cancels, 0);
    assert.equal(docBody().children.length, 0);
  } finally {
    restoreDom();
  }
});

test("Escape fires onCancel; other keys do nothing", () => {
  installDom();
  try {
    const counts = { assaults: 0, autos: 0, cancels: 0 };
    openAssaultConfirmModal({
      settlementName: "Haven",
      attackerSummary: "10 Crossbowmen",
      garrisonSummary: "4 Swordsmen",
      onAssault: () => {
        counts.assaults += 1;
      },
      onAutoResolve: () => {
        counts.autos += 1;
      },
      onCancel: () => {
        counts.cancels += 1;
      },
    });
    mockWin.dispatchKey("Enter");
    assert.equal(counts.cancels, 0, "non-Escape keys are ignored");
    mockWin.dispatchKey("Escape");
    assert.equal(counts.cancels, 1, "Esc = Cancel");
    assert.equal(counts.assaults, 0);
    assert.equal(counts.autos, 0);
    assert.equal(docBody().children.length, 0);
    mockWin.dispatchKey("Escape");
    assert.equal(counts.cancels, 1, "Esc after close fires nothing");
  } finally {
    restoreDom();
  }
});

test("Cancel button fires onCancel without resolving either other choice", () => {
  installDom();
  try {
    const counts = { assaults: 0, autos: 0, cancels: 0 };
    openAssaultConfirmModal({
      settlementName: "Haven",
      attackerSummary: "10 Crossbowmen",
      garrisonSummary: "4 Swordsmen",
      onAssault: () => {
        counts.assaults += 1;
      },
      onAutoResolve: () => {
        counts.autos += 1;
      },
      onCancel: () => {
        counts.cancels += 1;
      },
    });
    findElements(docBody(), "BUTTON", "Cancel")[0].dispatch("click");
    assert.equal(counts.cancels, 1);
    assert.equal(counts.assaults, 0);
    assert.equal(counts.autos, 0);
  } finally {
    restoreDom();
  }
});
