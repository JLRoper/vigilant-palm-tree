import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import type { ToolbarState, ToolbarCallbacks } from "../../../src/screens/shared/toolbar";
import { APP_VERSION, BUILD_COMMIT, BUILD_TIME, formatBuildTime } from "../../../src/core/version";

// The toolbar's import chain reaches src/render/assetDescriptors.ts (via
// newGameModal -> factionChoices), which is Vite-?url-coupled. The same
// hook pair test/engine/districts.test.ts uses makes it loadable under
// bare node:test: ?url PNG specifiers become data: URL defaults and
// import.meta.glob gets a stub. Toolbar is therefore imported dynamically
// after the hooks register, not via a top-level static import.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith(".png?url")) {
      return {
        url: `data:text/javascript,export default ${JSON.stringify(specifier)};`,
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    const res = nextLoad(url, context);
    if (url.endsWith("/src/render/assetDescriptors.ts") && typeof res.source === "string") {
      const globStub =
        'import.meta.glob ??= (p) => p.includes("building-pixel-") ? Object.fromEntries(Object.values(BUILDING_SPRITE_FILES).map((f) => ["../resources/buildings/" + f, { default: f }])) : {};\n';
      return { ...res, source: globStub + res.source };
    }
    return res;
  },
});

const { Toolbar } = await import("../../../src/screens/shared/toolbar");

// Minimal DOM mock to exercise toolbar in a headless node:test environment.
function makeMockStyle(): Record<string, string> {
  const map = new Map<string, string>();
  return new Proxy({} as Record<string, string>, {
    get(_t, prop) {
      if (typeof prop === "string") return map.get(prop) ?? "";
      return undefined;
    },
    set(_t, prop, value) {
      if (typeof prop === "string") map.set(prop, String(value));
      return true;
    },
  });
}

class MockElement {
  readonly tagName: string;
  readonly children: MockElement[] = [];
  readonly style = makeMockStyle();
  parent: MockElement | null = null;
  textContent = "";
  title = "";
  type = "";
  value = "";
  checked = false;
  disabled = false;
  dataset: Record<string, string> = {};
  private readonly attributes = new Map<string, string>();
  private readonly listeners = new Map<string, Array<(ev?: { stopPropagation(): void }) => void>>();

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  appendChild(child: MockElement): MockElement {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  append(...children: MockElement[]): void {
    for (const c of children) this.appendChild(c);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    if (name.startsWith("data-")) {
      const camel = name.slice(5).replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());
      this.dataset[camel] = value;
    }
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  addEventListener(event: string, fn: (ev?: { stopPropagation(): void }) => void): void {
    const list = this.listeners.get(event) ?? [];
    list.push(fn);
    this.listeners.set(event, list);
  }

  dispatchEvent(event: string): void {
    for (const fn of this.listeners.get(event) ?? []) fn({ stopPropagation() {} });
  }

  querySelector(selector: string): MockElement | null {
    if (selector.startsWith("[") && selector.endsWith("]")) {
      const inner = selector.slice(1, -1);
      const [attr, rawVal] = inner.split("=");
      const val = rawVal ? rawVal.replace(/^["']|["']$/g, "") : undefined;
      const match = (el: MockElement): MockElement | null => {
        const attrVal = el.getAttribute(attr);
        if (attrVal !== null && (val === undefined || attrVal === val)) {
          return el;
        }
        for (const c of el.children) {
          const found = match(c);
          if (found) return found;
        }
        return null;
      };
      return match(this);
    }
    return null;
  }
}

function findButton(root: MockElement, label: string): MockElement | null {
  if (root.tagName === "BUTTON" && root.textContent === label) return root;
  for (const child of root.children) {
    const match = findButton(child, label);
    if (match) return match;
  }
  return null;
}

/** Every rendered toast (role=alert), in document order. */
function toasts(root: MockElement): MockElement[] {
  const out: MockElement[] = [];
  const walk = (el: MockElement): void => {
    if (el.getAttribute("role") === "alert") out.push(el);
    for (const child of el.children) walk(child);
  };
  walk(root);
  return out;
}

const savedDocument = (globalThis as { document?: unknown }).document;
const savedWindow = (globalThis as { window?: unknown }).window;
const savedDivClass = (globalThis as { HTMLDivElement?: unknown }).HTMLDivElement;

function installDom(): { root: MockElement } {
  const root = new MockElement("body");
  (globalThis as { document: unknown }).document = {
    createElement(tag: string): MockElement {
      return new MockElement(tag);
    },
    body: root,
    // showToast's container lookup: the mock has no id index, so every toast
    // opens its own container -- which is what the assertions below walk.
    getElementById: () => null,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  (globalThis as { window: unknown }).window = {
    innerWidth: 1280,
    innerHeight: 720,
    addEventListener: () => {},
    removeEventListener: () => {},
    // showToast schedules its auto-dismiss.
    setTimeout: () => 0,
    clearTimeout: () => {},
  };
  // showToast's container guard is `existing instanceof HTMLDivElement`; a bare
  // node:test global has no DOM classes at all, so the `instanceof` itself
  // throws. Nothing in this file is a real div.
  (globalThis as { HTMLDivElement?: unknown }).HTMLDivElement = class {};
  return { root };
}

function restoreDom(): void {
  if (savedDocument === undefined) delete (globalThis as { document?: unknown }).document;
  else (globalThis as { document: unknown }).document = savedDocument;
  if (savedWindow === undefined) delete (globalThis as { window?: unknown }).window;
  else (globalThis as { window: unknown }).window = savedWindow;
  if (savedDivClass === undefined) delete (globalThis as { HTMLDivElement?: unknown }).HTMLDivElement;
  else (globalThis as { HTMLDivElement?: unknown }).HTMLDivElement = savedDivClass;
}

const state: ToolbarState = {
  backendOk: () => true,
  hasActiveGame: () => true,
  canEndTurnNow: () => true,
  getCalendar: () => null,
  getSaveStatus: () => "saved",
  getLastSavedAt: () => null,
  getZoom: () => 1,
};

const callbacks: ToolbarCallbacks = {
  onNew: () => {},
  onLoad: async () => {},
  onSave: () => {},
  onEndTurn: async () => {},
};

beforeEach(() => {
  installDom();
});

afterEach(() => {
  restoreDom();
});

test("gear dropdown renders version and build info", () => {
  const parent = new MockElement("div");
  new Toolbar({ parent: parent as unknown as HTMLElement, state, callbacks });

  const buildInfo = parent.querySelector('[data-testid="toolbar-build-info"]');
  assert.ok(buildInfo, "toolbar-build-info container must exist");
  assert.equal(buildInfo.children.length, 2, "buildInfo should have versionLine and builtLine");
  assert.equal(buildInfo.children[0].textContent, `v${APP_VERSION} (${BUILD_COMMIT})`);
  assert.equal(buildInfo.children[1].textContent, `Built: ${formatBuildTime(BUILD_TIME)}`);
  assert.equal(buildInfo.children[1].title, `Built: ${BUILD_TIME}`);

  const dropdown = buildInfo.parent;
  assert.ok(dropdown, "buildInfo must have a parent (gear dropdown)");
  assert.equal(dropdown.style.display, "none", "dropdown starts closed before any gear click");
});

test("gear click toggles the dropdown open/closed", () => {
  const parent = new MockElement("div");
  new Toolbar({ parent: parent as unknown as HTMLElement, state, callbacks });

  const gear = findButton(parent, "⚙");
  assert.ok(gear, "gear button must exist");
  const dropdown = parent.querySelector('[data-testid="toolbar-build-info"]')?.parent;
  assert.ok(dropdown, "gear dropdown must exist");

  gear.dispatchEvent("click");
  assert.equal(dropdown.style.display, "flex", "first gear click opens the dropdown");
  gear.dispatchEvent("click");
  assert.equal(dropdown.style.display, "none", "second gear click closes the dropdown");
});

// ── Ledger #13: a dropped End Turn press must say why it was dropped ────────
//
// Measured in the ledger's playthrough: `day` went 4 -> 13 across 17 clicks,
// because a press during the in-flight turn was swallowed by a disabled button
// (which fires no event at all) and the repeat press was swallowed too. These
// two runs pin both halves of the new contract.

test("ledger #13: a press while a turn is in flight answers instead of vanishing", () => {
  const { root } = installDom();
  const parent = new MockElement("div");
  let ended = 0;
  const tb = new Toolbar({
    parent: parent as unknown as HTMLElement,
    state,
    callbacks: { ...callbacks, onEndTurn: async () => { ended += 1; } },
  });
  const btn = findButton(parent, "▶ End Turn");
  assert.ok(btn, "the End Turn button must exist");
  assert.equal(btn.disabled, false, "a loaded game leaves the button pressable");

  // An in-flight turn is exactly what runAsync does around the request.
  tb.setBusy(true);
  assert.equal(btn.disabled, false, "busy must not disable it -- a disabled control swallows the press entirely");
  assert.equal(btn.title, "Still ending the previous turn — one moment");

  btn.dispatchEvent("click");
  const seen = toasts(root);
  assert.equal(seen.length, 1, "the dropped press produced exactly one notice");
  assert.equal(seen[0].textContent, "Still ending the previous turn — one moment");
  assert.equal(ended, 0, "…and it did not start a second turn");
});

test("ledger #13: a press that is not the seat's turn answers too", () => {
  const { root } = installDom();
  const parent = new MockElement("div");
  let ended = 0;
  const notMyTurn: ToolbarState = { ...state, canEndTurnNow: () => false };
  new Toolbar({
    parent: parent as unknown as HTMLElement,
    state: notMyTurn,
    callbacks: { ...callbacks, onEndTurn: async () => { ended += 1; } },
  });
  const btn = findButton(parent, "▶ End Turn");
  assert.ok(btn, "the End Turn button must exist");
  assert.equal(btn.disabled, false, "a loaded game keeps it pressable so the press can be explained");
  assert.equal(btn.title, "It is not your turn yet");

  btn.dispatchEvent("click");
  const seen = toasts(root);
  assert.equal(seen.length, 1, "one notice, not silence");
  assert.equal(seen[0].textContent, "It is not your turn yet");
  assert.equal(ended, 0, "…and no turn was ended");
});