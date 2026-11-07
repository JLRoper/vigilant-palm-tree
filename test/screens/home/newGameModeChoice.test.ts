import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import type { NewGameFormValues } from "../../../src/screens/home/newGameScreen";
import { gameModeOptions, settings, updateSettings } from "../../../src/state/settings";
import { UNCHARTED_DEFAULT } from "../../../src/io/unchartedGames";
import { DEFAULT_GAME_MODE, type GameMode } from "@heroes/contracts";

// The home screen's "Create a New Game" panel (SETTLERS-PLAN.md §4 W4): the
// SECOND new-game surface, which must offer the same modes and pre-select the
// same stored default as the toolbar's dialog. Same hand-rolled DOM stand-in
// and same asset hook pair as the sibling modal test.
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

const { createNewGameScreen } = await import("../../../src/screens/home/newGameScreen");

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
  placeholder = "";
  min = "";
  max = "";
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
}

const savedDocument = (globalThis as { document?: unknown }).document;
const savedStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const persisted = new Map<string, string>();

function installDom(): void {
  (globalThis as { document: unknown }).document = {
    createElement(tag: string): MockElement {
      return new MockElement(tag);
    },
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
  if (savedStorage === undefined) delete (globalThis as { localStorage?: unknown }).localStorage;
  else Object.defineProperty(globalThis, "localStorage", savedStorage);
}

/**
 * The screen's `root` is typed `HTMLElement` (the real DOM type) while these
 * specs walk the mock tree. ONE cast per helper, so the call sites contribute
 * no type debt -- which also retires the debt this file already carried:
 * tools/typecheck-gate.mjs is exact, not a ceiling, so a file whose count
 * SHRINKS must be re-recorded or it fails as a STALE BASELINE.
 */
function asMock(el: HTMLElement): MockElement {
  return el as unknown as MockElement;
}

function modeChips(root: HTMLElement): MockElement[] {
  const out: MockElement[] = [];
  const walk = (el: MockElement): void => {
    if (el.dataset.mode) out.push(el);
    for (const c of el.children) walk(c);
  };
  walk(asMock(root));
  return out;
}

function findButton(root: HTMLElement, label: string): MockElement | null {
  const search = (el: MockElement): MockElement | null => {
    if (el.tagName === "BUTTON" && el.textContent === label) return el;
    for (const child of el.children) {
      const match = search(child);
      if (match) return match;
    }
    return null;
  };
  return search(asMock(root));
}

/** Every checkbox in the form's tree (the game has one: the Uncharted mode row). */
function checkboxInputs(root: HTMLElement): MockElement[] {
  const out: MockElement[] = [];
  const walk = (el: MockElement): void => {
    if (el.tagName === "INPUT" && el.type === "checkbox") out.push(el);
    for (const c of el.children) walk(c);
  };
  walk(asMock(root));
  return out;
}

function openScreen(onCreate: (values: NewGameFormValues) => Promise<void> = async () => {}) {
  return createNewGameScreen({
    defaultName: "test-game",
    defaultSeed: 1234,
    isBackendOk: () => true,
    busy: false,
    onCancel: () => {},
    onCreate,
  });
}

beforeEach(() => {
  persisted.clear();
  installDom();
  updateSettings({ gameMode: DEFAULT_GAME_MODE });
});

afterEach(() => {
  restoreDom();
});

test("the home create-game panel offers every mode the settings store lists", () => {
  const screen = openScreen();
  assert.deepEqual(
    modeChips(screen.root).map((c) => c.dataset.mode),
    gameModeOptions().map((o) => o.value),
  );
  assert.deepEqual(
    modeChips(screen.root).map((c) => c.textContent),
    gameModeOptions().map((o) => o.label),
  );
});

test("a stored settlers default preselects the settlers chip here too", () => {
  updateSettings({ gameMode: "settlers" });
  const screen = openScreen();
  const active = modeChips(screen.root).find((c) => c.style.fontWeight === "700");
  assert.equal(active?.dataset.mode, "settlers");
});

test("the form hands the picked mode to onCreate and leaves the stored default alone", async () => {
  updateSettings({ gameMode: "classic" });
  const seen: NewGameFormValues[] = [];
  const screen = openScreen(async (values) => {
    seen.push(values);
  });

  const settlers = modeChips(screen.root).find((c) => c.dataset.mode === "settlers");
  assert.ok(settlers);
  settlers!.dispatchEvent("click");
  assert.equal(settings().gameMode, "classic", "the form never writes the store");

  findButton(screen.root, "Create Game")!.dispatchEvent("click");
  await new Promise((r) => setImmediate(r));
  assert.equal(seen.length, 1);
  assert.equal(seen[0].gameMode, "settlers");
  assert.equal(seen[0].name, "test-game");
});

test("the unanswered pick is the stored default", async () => {
  updateSettings({ gameMode: "settlers" });
  const seen: NewGameFormValues[] = [];
  const screen = openScreen(async (values) => {
    seen.push(values);
  });
  findButton(screen.root, "Create Game")!.dispatchEvent("click");
  await new Promise((r) => setImmediate(r));
  assert.equal(seen[0].gameMode, "settlers" as GameMode);
});

// ── Ledger #33: Uncharted mode is not on by default ────────────────────────

test("ledger #33: the home form's Uncharted mode starts OFF, and a form left alone submits it off", async () => {
  const seen: NewGameFormValues[] = [];
  const screen = openScreen(async (values) => {
    seen.push(values);
  });

  const boxes = checkboxInputs(screen.root);
  assert.equal(boxes.length, 1, "the form has exactly one checkbox -- the Uncharted mode row");
  assert.equal(boxes[0].checked, false, "a fresh game must not start hidden unless the player asks");

  findButton(screen.root, "Create Game")!.dispatchEvent("click");
  await new Promise((r) => setImmediate(r));
  assert.equal(seen[0].uncharted, false, "…and the submitted form says so");
});

test("ledger #33: ticking the row still turns uncharted on", async () => {
  const seen: NewGameFormValues[] = [];
  const screen = openScreen(async (values) => {
    seen.push(values);
  });

  const box = checkboxInputs(screen.root)[0];
  box.checked = true;
  box.dispatchEvent("change");

  findButton(screen.root, "Create Game")!.dispatchEvent("click");
  await new Promise((r) => setImmediate(r));
  assert.equal(seen[0].uncharted, true, "the opt-in is the player's, and it still works");
});

test("ledger #33: both new-game surfaces read ONE default", () => {
  assert.equal(UNCHARTED_DEFAULT, false, "the shared default is OFF, not a second literal per surface");
});
