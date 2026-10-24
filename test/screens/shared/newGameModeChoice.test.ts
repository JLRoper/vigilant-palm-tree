import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import type { NewGameHandler } from "../../../src/screens/shared/newGameModal";
import { gameModeOptions, settings, updateSettings } from "../../../src/state/settings";
import { DEFAULT_GAME_MODE, type GameMode } from "@heroes/contracts";

// The New Game dialog's mode selector (SETTLERS-PLAN.md §4 W4), exercised
// through the real DOM-building screen with the same hand-rolled DOM stand-in
// test/screens/home/settingsMenu.test.ts uses -- no browser, no jsdom.
//
// Its import chain reaches src/render/assetDescriptors.ts (via
// newGameModal -> factionChoices), which is Vite-?url-coupled, so the same
// hook pair test/screens/shared/toolbar.test.ts uses makes it loadable under
// bare node:test and the modal is imported dynamically after registration.
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

const { openNewGameModal } = await import("../../../src/screens/shared/newGameModal");

// What it pins: both modes are offered, the chip that starts active is the
// STORED default, the picked mode reaches the create handler, and picking a
// mode for one game never rewrites the stored preference.

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
  private readonly listeners = new Map<string, Array<() => void>>();

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

  replaceChildren(...children: MockElement[]): void {
    for (const c of [...this.children]) c.parent = null;
    this.children.length = 0;
    for (const c of children) this.appendChild(c);
  }

  removeChild(child: MockElement): void {
    const idx = this.children.indexOf(child);
    if (idx >= 0) this.children.splice(idx, 1);
    child.parent = null;
  }

  remove(): void {
    if (this.parent) this.parent.removeChild(this);
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

  addEventListener(event: string, fn: () => void): void {
    const list = this.listeners.get(event) ?? [];
    list.push(fn);
    this.listeners.set(event, list);
  }

  removeEventListener(event: string, fn: () => void): void {
    const list = this.listeners.get(event) ?? [];
    const idx = list.indexOf(fn);
    if (idx >= 0) list.splice(idx, 1);
  }

  dispatchEvent(event: string): void {
    for (const fn of this.listeners.get(event) ?? []) fn();
  }

  focus(): void {}

  select(): void {}

  querySelector(selector: string): MockElement | null {
    if (selector.startsWith("[") && selector.endsWith("]")) {
      const inner = selector.slice(1, -1);
      const [attr, rawVal] = inner.split("=");
      const val = rawVal ? rawVal.replace(/^["']|["']$/g, "") : undefined;
      const match = (el: MockElement): MockElement | null => {
        const attrVal = el.getAttribute(attr);
        if (attrVal !== null && (val === undefined || attrVal === val)) return el;
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

/** Every mode chip the dialog built, in the order it built them. */
function modeChips(): MockElement[] {
  const out: MockElement[] = [];
  const walk = (el: MockElement): void => {
    if (el.dataset.mode) out.push(el);
    for (const c of el.children) walk(c);
  };
  walk(body);
  return out;
}

/** The chip the dialog marked active (the refresh paints active ones bold). */
function activeChip(): MockElement | null {
  return modeChips().find((c) => c.style.fontWeight === "700") ?? null;
}

function findButton(root: MockElement, label: string): MockElement | null {
  if (root.tagName === "BUTTON" && root.textContent === label) return root;
  for (const child of root.children) {
    const match = findButton(child, label);
    if (match) return match;
  }
  return null;
}

/** The chip whose label is `label` (its textContent is the option's label). */
function chipFor(mode: GameMode): MockElement | null {
  return modeChips().find((c) => c.dataset.mode === mode) ?? null;
}

const body = new MockElement("body");
const savedDocument = (globalThis as { document?: unknown }).document;
const savedWindow = (globalThis as { window?: unknown }).window;
const savedStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const persisted = new Map<string, string>();

function installDom(): void {
  (globalThis as { document: unknown }).document = {
    createElement(tag: string): MockElement {
      return new MockElement(tag);
    },
    body,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  (globalThis as { window: unknown }).window = {
    innerWidth: 1280,
    innerHeight: 720,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => persisted.get(k) ?? null,
      setItem: (k: string, v: string) => persisted.set(k, v),
      removeItem: (k: string) => persisted.delete(k),
    },
  });
}

function restoreDom(): void {
  if (savedDocument === undefined) delete (globalThis as { document?: unknown }).document;
  else (globalThis as { document: unknown }).document = savedDocument;
  if (savedWindow === undefined) delete (globalThis as { window?: unknown }).window;
  else (globalThis as { window: unknown }).window = savedWindow;
  if (savedStorage === undefined) delete (globalThis as { localStorage?: unknown }).localStorage;
  else Object.defineProperty(globalThis, "localStorage", savedStorage);
}

beforeEach(() => {
  body.replaceChildren();
  persisted.clear();
  installDom();
  updateSettings({ gameMode: DEFAULT_GAME_MODE });
});

afterEach(() => {
  body.replaceChildren();
  restoreDom();
});

test("the dialog offers every mode the settings store lists, in its order", () => {
  openNewGameModal({ onNew: () => {} });
  assert.deepEqual(
    modeChips().map((c) => c.dataset.mode),
    gameModeOptions().map((o) => o.value),
  );
  assert.deepEqual(
    modeChips().map((c) => c.textContent),
    gameModeOptions().map((o) => o.label),
  );
});

test("a stored settlers default preselects the settlers chip", () => {
  updateSettings({ gameMode: "settlers" });
  openNewGameModal({ onNew: () => {} });
  assert.equal(activeChip()?.dataset.mode, "settlers");
});

test("a stored classic default preselects the classic chip", () => {
  updateSettings({ gameMode: "classic" });
  openNewGameModal({ onNew: () => {} });
  assert.equal(activeChip()?.dataset.mode, "classic");
});

test("picking a mode moves the active chip and reaches the create handler", async () => {
  updateSettings({ gameMode: "classic" });
  const seen: Array<{ gameMode?: GameMode }> = [];
  const onNew: NewGameHandler = (opts) => {
    seen.push({ gameMode: opts.gameMode });
  };
  openNewGameModal({ onNew });

  assert.equal(chipFor("settlers")?.dataset.mode, "settlers");
  chipFor("settlers")!.dispatchEvent("click");
  assert.equal(activeChip()?.dataset.mode, "settlers", "the picked chip is the active one");
  assert.equal(
    settings().gameMode,
    "classic",
    "picking a mode for one game does not rewrite the stored preference",
  );

  findButton(body, "Create")!.dispatchEvent("click");
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(seen, [{ gameMode: "settlers" }]);
});

test("the default pick is handed to the create handler unanswered: classic on a fresh store", async () => {
  const seen: Array<{ gameMode?: GameMode }> = [];
  openNewGameModal({
    onNew: (opts) => {
      seen.push({ gameMode: opts.gameMode });
    },
  });
  findButton(body, "Create")!.dispatchEvent("click");
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(seen, [{ gameMode: DEFAULT_GAME_MODE }]);
});

test("each mode chip carries its own hint as a tooltip", () => {
  openNewGameModal({ onNew: () => {} });
  for (const chip of modeChips()) {
    assert.equal(typeof chip.title, "string");
    assert.ok(chip.title.length > 0, `${chip.dataset.mode} has a tooltip`);
  }
  assert.notEqual(chipFor("classic")?.title, chipFor("settlers")?.title);
});
