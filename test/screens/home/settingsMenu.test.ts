import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { openSettingsMenu } from "../../../src/screens/home/settingsMenu";
import {
  APP_VERSION,
  BUILD_COMMIT,
  BUILD_TIME,
  formatBuildTime,
} from "../../../src/core/version";

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

test("openSettingsMenu renders build info element with version, commit and build time", () => {
  const parent = new MockElement("div");
  openSettingsMenu({ parent });

  const buildInfo = parent.querySelector('[data-testid="settings-build-info"]');
  assert.ok(buildInfo, "settings-build-info container must exist");
  assert.equal(buildInfo.style.fontSize, "11px");
  assert.equal(buildInfo.style.opacity, "0.5");
  assert.equal(buildInfo.style.fontVariantNumeric, "tabular-nums");

  assert.equal(buildInfo.children.length, 2, "buildInfo should have versionLine and builtLine");
  const [versionLine, builtLine] = buildInfo.children;

  assert.equal(versionLine.textContent, `v${APP_VERSION} (${BUILD_COMMIT})`);
  assert.equal(builtLine.textContent, `Built: ${formatBuildTime(BUILD_TIME)}`);
  assert.equal(builtLine.title, `Built: ${BUILD_TIME}`);

  // Verify closeRow flex alignment
  const closeRow = buildInfo.parent;
  assert.ok(closeRow, "buildInfo must have a parent (closeRow)");
  assert.equal(closeRow.style.justifyContent, "space-between");
  assert.equal(closeRow.style.alignItems, "center");
});
