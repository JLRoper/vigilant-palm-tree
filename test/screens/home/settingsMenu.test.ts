import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { openSettingsMenu } from "../../../src/screens/home/settingsMenu";
import { settings, updateSettings } from "../../../src/state/settings";
import { DEFAULT_TOOLBAR_STYLE, TOOLBAR_THEMES } from "../../../src/state/toolbarThemes";

// Minimal DOM mock to exercise settingsMenu in a headless node:test environment.
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

const savedDocument = (globalThis as { document?: unknown }).document;
const savedWindow = (globalThis as { window?: unknown }).window;

function installDom(): { root: MockElement } {
  const root = new MockElement("body");
  (globalThis as { document: unknown }).document = {
    createElement(tag: string): MockElement {
      return new MockElement(tag);
    },
    body: root,
  };
  (globalThis as { window: unknown }).window = {
    innerWidth: 1280,
    innerHeight: 720,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  return { root };
}

function restoreDom(): void {
  if (savedDocument === undefined) delete (globalThis as { document?: unknown }).document;
  else (globalThis as { document: unknown }).document = savedDocument;
  if (savedWindow === undefined) delete (globalThis as { window?: unknown }).window;
  else (globalThis as { window: unknown }).window = savedWindow;
}

beforeEach(() => {
  installDom();
});

afterEach(() => {
  restoreDom();
});

test("settings panel no longer renders build info (moved to the in-game gear menu)", () => {
  const parent = new MockElement("div");
  openSettingsMenu({ parent });
  assert.equal(
    parent.querySelector('[data-testid="settings-build-info"]'),
    null,
    "build info moved out of the settings panel to the toolbar gear menu",
  );
});

test("Visual toolbar style selector updates immediately and Reset restores modern", () => {
  const parent = new MockElement("div");
  updateSettings({ toolbarStyle: "classic-blue" });

  try {
    openSettingsMenu({ parent });
    const select = parent.querySelector('[data-testid="toolbar-style-select"]');
    assert.ok(select);
    assert.equal(select.value, "classic-blue");
    assert.deepEqual(
      select.children.map((option) => [option.value, option.textContent]),
      [
        ["modern", TOOLBAR_THEMES.modern.label],
        ["classic-blue", TOOLBAR_THEMES["classic-blue"].label],
      ],
    );

    select.value = "modern";
    select.dispatchEvent("change");
    assert.equal(settings().toolbarStyle, "modern");

    select.value = "classic-blue";
    select.dispatchEvent("change");
    assert.equal(settings().toolbarStyle, "classic-blue");

    const reset = findButton(parent, "Reset to default");
    assert.ok(reset);
    reset.dispatchEvent("click");
    assert.equal(settings().toolbarStyle, DEFAULT_TOOLBAR_STYLE);
    assert.equal(select.value, DEFAULT_TOOLBAR_STYLE);
  } finally {
    updateSettings({ toolbarStyle: DEFAULT_TOOLBAR_STYLE });
  }
});
