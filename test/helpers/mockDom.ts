// A hand-rolled DOM stand-in for the screens that build their own elements
// (no jsdom in this repo).
//
// The sibling suites keep their own copy of this mock (test/screens/home/
// settingsMenu.test.ts, test/screens/shared/toolbar.test.ts). The Load-path
// suites need a strictly larger surface -- openDialog + FloatingPanel +
// panelManager, i.e. `remove()`, `replaceChildren`, `insertBefore`,
// `querySelectorAll` with the `div[style*='z-index: N']` form, and enough of
// `document.body` for a dialog wrapper to be appended and detached again --
// so it is factored here once instead of forked twice and drifting.
//
// What it deliberately models faithfully:
//   - `style` is a Proxy over a Map that accepts any key, and `styleText()`
//     serializes it KEBAB-CASED the way an inline style attribute really
//     reads, so a selector written against `style*='z-index: 100'` matches a
//     real `zIndex = "100"` assignment (and, the point, does NOT match a
//     dialog mounted at 300).
//   - `addEventListener`/`dispatchEvent` drive the app's own handlers, so a
//     test clicks through the same listener the browser would.

export type MockListener = (ev: { stopPropagation(): void; preventDefault(): void; target?: MockElement }) => void;

function camelToKebab(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

export class MockElement {
  readonly tagName: string;
  readonly children: MockElement[] = [];
  /** Non-element children (a textContent setter is modelled as plain text). */
  readonly style: Record<string, string>;
  parent: MockElement | null = null;
  textContent = "";
  innerHTML = "";
  title = "";
  type = "";
  value = "";
  checked = false;
  disabled = false;
  /**
   * A live view of the `data-*` attributes, the way the real `dataset` is:
   * `el.dataset.modal = "true"` is readable as `getAttribute("data-modal")`,
   * so a `[data-modal]` query sees it.
   */
  readonly dataset: Record<string, string>;
  isConnected = false;
  private readonly attributes = new Map<string, string>();
  private readonly listeners = new Map<string, MockListener[]>();

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
    this.dataset = new Proxy({} as Record<string, string>, {
      get: (_t, prop) => {
        if (typeof prop !== "string") return undefined;
        return this.attributes.get(`data-${camelToKebab(prop)}`);
      },
      set: (_t, prop, value) => {
        this.attributes.set(`data-${camelToKebab(String(prop))}`, String(value));
        return true;
      },
      has: (_t, prop) => typeof prop === "string" && this.attributes.has(`data-${camelToKebab(prop)}`),
      deleteProperty: (_t, prop) => {
        if (typeof prop === "string") this.attributes.delete(`data-${camelToKebab(prop)}`);
        return true;
      },
      ownKeys: () =>
        [...this.attributes.keys()]
          .filter((k) => k.startsWith("data-"))
          .map((k) => k.slice(5).replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase())),
      getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
    });
    const map = new Map<string, string>();
    this.style = new Proxy({} as Record<string, string>, {
      get(_t, prop) {
        if (typeof prop === "string") return map.get(prop) ?? "";
        return undefined;
      },
      set(_t, prop, value) {
        if (typeof prop === "string") map.set(prop, String(value));
        return true;
      },
      ownKeys() {
        return [...map.keys()];
      },
      getOwnPropertyDescriptor(_t, prop) {
        if (typeof prop === "string" && map.has(prop)) {
          return { value: map.get(prop), enumerable: true, configurable: true, writable: true };
        }
        return undefined;
      },
    });
  }

  /** The inline style as an attribute would serialize it: `z-index: 300; color: #eee`. */
  styleText(): string {
    const parts: string[] = [];
    for (const key of Object.keys(this.style)) {
      parts.push(`${camelToKebab(key)}: ${this.style[key]}`);
    }
    return parts.join("; ");
  }

  appendChild(child: MockElement): MockElement {
    child.parent = this;
    child.isConnected = true;
    this.children.push(child);
    return child;
  }

  append(...children: MockElement[]): void {
    for (const c of children) this.appendChild(c);
  }

  insertBefore(node: MockElement, ref: MockElement | null): MockElement {
    const idx = ref ? this.children.indexOf(ref) : -1;
    node.parent = this;
    node.isConnected = true;
    if (idx < 0) this.children.push(node);
    else this.children.splice(idx, 0, node);
    return node;
  }

  removeChild(child: MockElement): MockElement {
    const idx = this.children.indexOf(child);
    if (idx >= 0) this.children.splice(idx, 1);
    child.parent = null;
    child.isConnected = false;
    return child;
  }

  replaceChildren(...nodes: MockElement[]): void {
    for (const c of [...this.children]) this.removeChild(c);
    for (const n of nodes) this.appendChild(n);
  }

  remove(): void {
    this.parent?.removeChild(this);
  }

  contains(node: MockElement | null): boolean {
    if (node === this) return true;
    return this.children.some((c) => c.contains(node));
  }

  focus(): void {}

  /** `<input>` behaviour the New Game form uses when it opens (select-all). */
  select(): void {}

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

  addEventListener(event: string, fn: MockListener): void {
    const list = this.listeners.get(event) ?? [];
    list.push(fn);
    this.listeners.set(event, list);
  }

  removeEventListener(event: string, fn: MockListener): void {
    const list = this.listeners.get(event);
    if (!list) return;
    const idx = list.indexOf(fn);
    if (idx >= 0) list.splice(idx, 1);
  }

  /** Fires the element's own listeners, the way a real click would. */
  dispatchEvent(event: string): void {
    for (const fn of [...(this.listeners.get(event) ?? [])]) {
      fn({ stopPropagation() {}, preventDefault() {}, target: this });
    }
  }

  click(): void {
    this.dispatchEvent("click");
  }

  private all(): MockElement[] {
    const out: MockElement[] = [];
    for (const c of this.children) {
      out.push(c, ...c.all());
    }
    return out;
  }

  querySelector(selector: string): MockElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  /**
   * Supports the four selector shapes the Load-path surfaces use: a bare tag,
   * `[attr]`, `[attr="value"]` and `tag[style*='<substring>']` (matched against
   * the KEBAB-cased inline style, as an attribute selector really would).
   */
  querySelectorAll(selector: string): MockElement[] {
    const parse = (sel: string): ((el: MockElement) => boolean) => {
      const trimmed = sel.trim();
      const styleSub = /^(\w+)?\[style\*=['"]([^'"]+)['"]\]$/.exec(trimmed);
      if (styleSub) {
        const tag = styleSub[1]?.toUpperCase();
        const needle = styleSub[2];
        return (el) => (!tag || el.tagName === tag) && el.styleText().includes(needle);
      }
      const attrOnly = /^(\w+)?\[([\w-]+)\]$/.exec(trimmed);
      if (attrOnly) {
        const tag = attrOnly[1]?.toUpperCase();
        const attr = attrOnly[2];
        return (el) => (!tag || el.tagName === tag) && el.getAttribute(attr) !== null;
      }
      const attrEq = /^(\w+)?\[([\w-]+)=['"]?([^'"\]]*)['"]?\]$/.exec(trimmed);
      if (attrEq) {
        const tag = attrEq[1]?.toUpperCase();
        const attr = attrEq[2];
        const val = attrEq[3];
        return (el) => (!tag || el.tagName === tag) && el.getAttribute(attr) === val;
      }
      const tagOnly = /^[a-zA-Z]+$/.exec(trimmed);
      if (tagOnly) {
        const tag = trimmed.toUpperCase();
        return (el) => el.tagName === tag;
      }
      return () => false;
    };
    const match = parse(selector);
    return this.all().filter(match);
  }
}

export interface MockDomHandles {
  body: MockElement;
  document: unknown;
  window: unknown;
}

const savedDocument = (globalThis as { document?: unknown }).document;
const savedWindow = (globalThis as { window?: unknown }).window;
const savedLocalStorage = (globalThis as { localStorage?: unknown }).localStorage;
const savedFetch = (globalThis as { fetch?: unknown }).fetch;

export interface InstallDomOptions {
  /** Seed `localStorage` (the Load Game list and the auth cache are read from it). */
  storage?: Record<string, string>;
  /** Answer `fetch(url, init)`; return null for an unhandled URL (rejects). */
  fetchImpl?: (url: string, init?: RequestInit) => Promise<unknown> | unknown;
}

/** Replaces globalThis.document/window/localStorage/fetch. Pair with restoreDom(). */
export function installDom(opts: InstallDomOptions = {}): MockDomHandles {
  const body = new MockElement("body");
  const store = new Map<string, string>(Object.entries(opts.storage ?? {}));
  const doc = {
    createElement(tag: string): MockElement {
      return new MockElement(tag);
    },
    body,
    addEventListener: () => {},
    removeEventListener: () => {},
    querySelector: (sel: string) => body.querySelector(sel),
    querySelectorAll: (sel: string) => body.querySelectorAll(sel),
  };
  const win = {
    innerWidth: 1400,
    innerHeight: 1000,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  (globalThis as { document: unknown }).document = doc;
  (globalThis as { window: unknown }).window = win;
  (globalThis as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
  };
  if (opts.fetchImpl) {
    const impl = opts.fetchImpl;
    (globalThis as { fetch: unknown }).fetch = async (url: string, init?: RequestInit) => {
      const res = await impl(String(url), init);
      if (res === null || res === undefined) throw new Error(`mock fetch: unhandled ${url}`);
      return res;
    };
  }
  return { body, document: doc, window: win };
}

export function restoreDom(): void {
  const set = (key: string, saved: unknown): void => {
    if (saved === undefined) delete (globalThis as Record<string, unknown>)[key];
    else (globalThis as Record<string, unknown>)[key] = saved;
  };
  set("document", savedDocument);
  set("window", savedWindow);
  set("localStorage", savedLocalStorage);
  set("fetch", savedFetch);
}

/** The first element in `root`'s subtree whose tag + trimmed text match. */
export function findByText(root: MockElement, tag: string, text: string): MockElement | null {
  if (root.tagName === tag.toUpperCase() && root.textContent.trim() === text) return root;
  for (const child of root.children) {
    const hit = findByText(child, tag, text);
    if (hit) return hit;
  }
  return null;
}

/** Every element in `root`'s subtree matching the predicate. */
export function findAll(root: MockElement, pred: (el: MockElement) => boolean): MockElement[] {
  const out: MockElement[] = [];
  for (const child of root.children) {
    if (pred(child)) out.push(child);
    out.push(...findAll(child, pred));
  }
  return out;
}

export function findButton(root: MockElement, label: string): MockElement | null {
  return findByText(root, "BUTTON", label);
}

/**
 * The element's own text plus every descendant's, in tree order — what a real
 * `element.textContent` returns. The mock stores text per element (the app
 * assigns it leaf-by-leaf), so a row's full label is computed.
 */
export function textOf(el: MockElement): string {
  return el.textContent + el.children.map(textOf).join("");
}

/** Lets the microtask queue drain so an awaited handler chain settles. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r));
}
