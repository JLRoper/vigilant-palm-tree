// Shared harness for the city-grid placement specs (palette affordability, the
// affordability refusal, and the regression guards for the click-from-
// coordinates / geometry-refusal behaviour main already ships).
//
// Hand-rolled DOM stand-in + the asset hooks from buildingPaletteCart.test.ts,
// plus the cell -> canvas-point maths the placer's snap reads -- a spec here
// drives the REAL BuildingPlacer with no canvas, no engine and no mousemove.

import { registerHooks } from "node:module";
import { cellToScreen, cityLayout } from "../../../src/core/cityGrid";
import type { BuildingDef } from "@heroes/contracts";

// buildingPlacer's import chain reaches src/render/assetDescriptors.ts (via
// @screens/shared/panel), which is Vite-?url / import.meta.glob-coupled.
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

export const { BuildingPlacer } = await import("../../../src/screens/settlements/cityView/buildingPlacer");
export const { toolbarHeight } = await import("@screens/shared/panelRail");

export type Placer = InstanceType<typeof BuildingPlacer>;

// ── DOM stand-in ────────────────────────────────────────────────────────────

function makeMockStyle(): Record<string, string> {
  const map = new Map<string, string>();
  return new Proxy({} as Record<string, string>, {
    get(_t, prop) {
      return typeof prop === "string" ? map.get(prop) ?? "" : undefined;
    },
    set(_t, prop, value) {
      if (typeof prop === "string") map.set(prop, String(value));
      return true;
    },
  });
}

export class MockNode {
  readonly children: MockNode[] = [];
  readonly style = makeMockStyle();
  parent: MockNode | null = null;
  private ownText: string | null = null;
  innerHTML = "";
  title = "";
  alt = "";
  className = "";
  type = "";
  value = "";
  checked = false;
  disabled = false;
  src = "";
  scrollTop = 0;
  dataset: Record<string, string> = {};
  private readonly attributes = new Map<string, string>();
  private readonly listeners = new Map<string, Array<(...args: unknown[]) => unknown>>();

  appendChild<T extends MockNode>(child: T): T {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  append<T extends MockNode>(...nodes: T[]): void {
    for (const n of nodes) this.appendChild(n);
  }

  get textContent(): string {
    if (this.ownText !== null) return this.ownText;
    return this.children.map((c) => c.textContent).join("");
  }

  set textContent(value: string | null) {
    this.ownText = value ?? "";
  }

  insertBefore<T extends MockNode>(child: T, ref: MockNode | null): T {
    if (!ref) return this.appendChild(child);
    const i = this.children.indexOf(ref);
    if (i < 0) return this.appendChild(child);
    child.parent = this;
    this.children.splice(i, 0, child);
    return child;
  }

  removeChild(child: MockNode): void {
    const i = this.children.indexOf(child);
    if (i >= 0) this.children.splice(i, 1);
    child.parent = null;
  }

  replaceChildren(...nodes: MockNode[]): void {
    for (const child of [...this.children]) this.removeChild(child);
    this.append(...nodes);
  }

  remove(): void {
    this.parent?.removeChild(this);
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

  addEventListener(event: string, fn: (...args: unknown[]) => unknown): void {
    const list = this.listeners.get(event) ?? [];
    list.push(fn);
    this.listeners.set(event, list);
  }

  removeEventListener(event: string, fn: (...args: unknown[]) => unknown): void {
    const list = this.listeners.get(event) ?? [];
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }

  dispatchEvent(event: string | { type: string }): void {
    const type = typeof event === "string" ? event : event.type;
    for (const fn of this.listeners.get(type) ?? []) {
      fn({ type, stopPropagation() {}, preventDefault() {} });
    }
  }

  getBoundingClientRect(): { left: number; top: number; right: number; bottom: number; width: number; height: number; x: number; y: number } {
    return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
  }
}

export class MockElement extends MockNode {
  readonly tagName: string;
  constructor(tagName: string) {
    super();
    this.tagName = tagName.toUpperCase();
  }
}

function findAll(root: MockNode, match: (el: MockElement) => boolean): MockElement[] {
  const out: MockElement[] = [];
  const walk = (node: MockNode): void => {
    if (node instanceof MockElement && match(node)) out.push(node);
    for (const child of node.children) walk(child);
  };
  walk(root);
  return out;
}

const savedDocument = (globalThis as { document?: unknown }).document;
const savedWindow = (globalThis as { window?: unknown }).window;
const savedGetComputedStyle = (globalThis as { getComputedStyle?: unknown }).getComputedStyle;

export function installDom(): MockElement {
  const body = new MockElement("body");
  (globalThis as { document: unknown }).document = {
    createElement: (tag: string): MockElement => new MockElement(tag),
    body,
    getElementById: () => null,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  (globalThis as { window: unknown }).window = {
    innerWidth: 1280,
    innerHeight: 720,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  (globalThis as { getComputedStyle: unknown }).getComputedStyle = () => makeMockStyle();
  return body;
}

export function restoreDom(): void {
  const restore = (key: "document" | "window" | "getComputedStyle", saved: unknown): void => {
    if (saved === undefined) delete (globalThis as Record<string, unknown>)[key];
    else (globalThis as Record<string, unknown>)[key] = saved;
  };
  restore("document", savedDocument);
  restore("window", savedWindow);
  restore("getComputedStyle", savedGetComputedStyle);
}

// ── fixtures ────────────────────────────────────────────────────────────────

export const VIEWPORT = { w: 1280, h: 720 };

export const RICH = {
  gold: 5000,
  warehouse: { wood: 500, stone: 500, iron: 500, arcane: 500, food: 500 },
};

export const BROKE = { gold: 0, warehouse: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 } };

/** The canvas point at a cell's centre, as a click there would carry. */
export function pointFor(gx: number, gy: number, size = 5): { x: number; y: number } {
  const layout = cityLayout(size, VIEWPORT.w, VIEWPORT.h, toolbarHeight());
  const c = cellToScreen(gx, gy, layout.gridOrigin);
  return {
    x: layout.screenOrigin.x + c.x * layout.tileScale,
    y: layout.screenOrigin.y + c.y * layout.tileScale,
  };
}

/** A placer with the palette open on a 5x5 grid whose centre cell is reserved. */
export function openPlacer(initialBuildings: BuildingDef[] = [], gold = RICH.gold): { placer: Placer; body: MockElement } {
  const body = installDom();
  const placer = new BuildingPlacer();
  placer.setAffordability({ gold, warehouse: { ...RICH.warehouse } });
  placer.init(5, { gx: 2, gy: 2 }, initialBuildings);
  placer.showPalette(body as unknown as HTMLElement, 10, 10);
  return { placer, body };
}

/** The palette's build rows (the entry-status title is what marks them). */
export function buildRowButtons(root: MockNode): MockElement[] {
  return findAll(root, (el) => el.tagName === "BUTTON" && (el.title ?? "").length > 0);
}

export function rowFor(root: MockNode, label: string): MockElement {
  const row = buildRowButtons(root).find((b) => b.textContent.includes(label));
  if (!row) throw new Error(`palette row "${label}" must exist`);
  return row;
}

/** The palette's own refusal line, or null when nothing is being refused. */
export function paletteNotice(root: MockNode): string | null {
  const el = findAll(root, (n) => n.dataset.testid === "palette-notice")[0];
  return el ? el.textContent : null;
}

/**
 * The palette's scrollable build list (the re-render that must not lose its
 * offset). The panel's own body is scrollable too, so it is excluded by its
 * `data-panel-body` marker.
 */
export function buildListWrap(root: MockNode): MockElement {
  const el = findAll(root, (n) => n.style.overflowY === "auto" && n.dataset.panelBody !== "true")[0];
  if (!el) throw new Error("the palette's build list must exist");
  return el;
}
