// The Build palette's two city-view minor findings, asserted on what the
// palette actually RENDERS (the established hand-rolled-DOM pattern from
// test/screens/home/settingsMenu.test.ts and the panel-aware mock in
// test/screens/combat/arena.test.ts) -- the panel code is written to tolerate
// a DOM stand-in (see FloatingPanel.isPanelVisible).
//
// C-MINOR-3: the "Cart:" line is a CHARGE readout. It used to print the cart's
// internal accounting (a placement counted POSITIVE) tinted green whenever the
// settlement could afford it, so spending read as income; and it printed a
// running total against the palette-open baseline, which never returned to
// zero once the placement had been paid for. It now prints what the cart still
// owes, signed against the treasury, and disappears when nothing is owed.
//
// C-MINOR-4: selecting a row and placing a building both re-render the list
// (renderPaletteBody), which replaced the scrolling element and threw the
// viewer back to the top -- below the fold, "Production" and "Civilian" rows
// sat out of reach for one placement each. The offset is now carried across
// the re-render.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { cellToScreen, cityLayout } from "../../../src/core/cityGrid";
import { buildingPlacementCost } from "@heroes/engine";
import type { BuildingDef } from "@heroes/contracts";

// buildingPlacer's import chain reaches src/render/assetDescriptors.ts (via
// @screens/shared/panel), which is Vite-?url / import.meta.glob-coupled -- the
// same hook pair test/screens/shared/toolbar.test.ts registers.
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

const { BuildingPlacer } = await import("../../../src/screens/settlements/cityView/buildingPlacer");
const { CART_TONE_COLORS } = await import("../../../src/screens/settlements/cityView/netCost");
const { toolbarHeight } = await import("../../../src/screens/shared/panelRail");

// ── DOM stand-in ──────────────────────────────────────────────────────

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

class MockNode {
  readonly children: MockNode[] = [];
  readonly style = makeMockStyle();
  parent: MockNode | null = null;
  private ownText: string | null = null;
  innerHTML = "";
  title = "";
  className = "";
  type = "";
  value = "";
  checked = false;
  disabled = false;
  src = "";
  scrollTop = 0;
  scrollHeight = 0;
  clientHeight = 0;
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

  /** Aggregates children like the real DOM, so a row's label is readable off its button. */
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

class MockElement extends MockNode {
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

function buttonLabelled(root: MockNode, text: string): MockElement {
  const btn = findAll(root, (el) => el.tagName === "BUTTON" && el.textContent.includes(text))[0];
  assert.ok(btn, `palette button "${text}" must exist`);
  return btn;
}

/** The cart charge line, or null when the cart owes nothing (settled). */
function cartLine(root: MockNode): MockElement | null {
  return findAll(root, (el) => el.dataset.testid === "palette-cart")[0] ?? null;
}

/** The scrolling build list (`maxHeight: 240px; overflowY: auto`). */
function buildList(root: MockNode): MockElement | null {
  return findAll(root, (el) => el.style.overflowY === "auto" && el.style.maxHeight === "240px")[0] ?? null;
}

const savedDocument = (globalThis as { document?: unknown }).document;
const savedWindow = (globalThis as { window?: unknown }).window;
const savedGetComputedStyle = (globalThis as { getComputedStyle?: unknown }).getComputedStyle;

function installDom(): MockElement {
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

function restoreDom(): void {
  const restore = (key: "document" | "window" | "getComputedStyle", saved: unknown): void => {
    if (saved === undefined) delete (globalThis as Record<string, unknown>)[key];
    else (globalThis as Record<string, unknown>)[key] = saved;
  };
  restore("document", savedDocument);
  restore("window", savedWindow);
  restore("getComputedStyle", savedGetComputedStyle);
}

const VIEWPORT = { w: 1280, h: 720 };

const AFFORDABLE = {
  gold: 5000,
  warehouse: { wood: 500, stone: 500, iron: 500, arcane: 500, food: 500 },
};

/** A placer with the palette open on an empty 5x5 grid. */
function openPalette(initialBuildings: BuildingDef[] = []): { placer: InstanceType<typeof BuildingPlacer>; body: MockElement } {
  const body = installDom();
  const placer = new BuildingPlacer();
  placer.setAffordability(AFFORDABLE);
  placer.init(5, { gx: 2, gy: 2 }, initialBuildings);
  placer.showPalette(body as unknown as HTMLElement, 10, 10);
  return { placer, body };
}

/** Snap to a grid cell and place the selected building on it. */
function placeOn(placer: InstanceType<typeof BuildingPlacer>, gx: number, gy: number): boolean {
  const layout = cityLayout(5, VIEWPORT.w, VIEWPORT.h, toolbarHeight());
  const centre = cellToScreen(gx, gy, layout.gridOrigin);
  placer.computeSnap(
    layout.screenOrigin.x + centre.x * layout.tileScale,
    layout.screenOrigin.y + centre.y * layout.tileScale,
    VIEWPORT.w,
    VIEWPORT.h,
  );
  return placer.confirmPlacement();
}

beforeEach(() => {
  installDom();
});

afterEach(() => {
  restoreDom();
});

// ── C-MINOR-3 ─────────────────────────────────────────────────────────

test("cart: an outstanding placement renders as a negative charge in the cost colour, never a green plus", () => {
  const { placer, body } = openPalette();
  assert.equal(cartLine(body), null, "a fresh palette owes nothing, so it shows no cart line");

  placer.selectBuilding("house");
  assert.ok(placeOn(placer, 1, 1), "the house should be staged on a free cell");

  const cost = buildingPlacementCost("house");
  const line = cartLine(body);
  assert.ok(line, "a staged, unpaid placement must show the cart charge");
  assert.equal(line.textContent, `Cart: -${cost.gold}g -${cost.wood}w`);
  assert.equal(line.style.color, CART_TONE_COLORS.cost, "a cost must not wear the credit green");
  assert.notEqual(CART_TONE_COLORS.cost, CART_TONE_COLORS.credit);
});

test("cart: a charge the treasury cannot cover renders red", () => {
  const { placer, body } = openPalette();
  const cost = buildingPlacementCost("house");
  placer.selectBuilding("house");
  assert.ok(placeOn(placer, 1, 1), "stage the house while it is still affordable");

  // Then the treasury is emptied: the gate itself refuses to stage anything
  // new, but the charge already owed must re-tint instead of silently reading
  // as affordable.
  placer.setAffordability({
    gold: (cost.gold ?? 0) - 1,
    warehouse: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 },
  });
  placer.selectBuilding("house");

  const line = cartLine(body);
  assert.ok(line, "the blocked charge must still be visible");
  assert.match(line.textContent ?? "", /^Cart: -/);
  assert.equal(line.style.color, CART_TONE_COLORS.over);
});

test("cart: settling a placement clears the line instead of accumulating a total", () => {
  const { placer, body } = openPalette();
  // Every real placement is committed immediately; markSynced is what the city
  // view calls once the commit lands.
  placer.setOnPlaced(() => placer.markSynced());
  placer.selectBuilding("house");

  assert.ok(placeOn(placer, 1, 1));
  assert.equal(cartLine(body), null, "the paid-for placement must leave nothing owed");

  assert.ok(placeOn(placer, 3, 3));
  const second = cartLine(body);
  assert.equal(second, null, "a second paid placement must not show a running total either");
});

test("cart: a destroy refund reads positive and green, the one case that is income", () => {
  const buildings: BuildingDef[] = [{ gx: 1, gy: 1, kind: "house", level: 1, w: 1, h: 1 }];
  const { placer, body } = openPalette(buildings);
  placer.removeAt(1, 1);

  const cost = buildingPlacementCost("house");
  const refundGold = Math.ceil((cost.gold ?? 0) * 0.5);
  const refundWood = Math.ceil((cost.wood ?? 0) * 0.5);
  const line = cartLine(body);
  assert.ok(line, "a refund is a credit and must be shown");
  assert.equal(line.textContent, `Cart: +${refundGold}g +${refundWood}w`);
  assert.equal(line.style.color, CART_TONE_COLORS.credit);
});

// ── C-MINOR-4 ─────────────────────────────────────────────────────────

test("scroll: selecting a row keeps the list where the viewer left it", () => {
  const { placer, body } = openPalette();
  const list = buildList(body);
  assert.ok(list, "the build list must be scrollable");
  list.scrollTop = 150;

  buttonLabelled(body, "House").dispatchEvent("click");

  assert.notEqual(buildList(body), list, "the re-render replaces the list element");
  assert.equal(buildList(body)?.scrollTop, 150, "the new list must be re-scrolled to the viewer's offset");
  assert.equal(
    buttonLabelled(body, "House").style.background,
    "rgba(60,120,60,0.6)",
    "the clicked row still shows as selected",
  );
  assert.equal(placer.isActive(), true, "the row click still arms a placement");
});

test("scroll: placing a building keeps the list where the viewer left it", () => {
  const { placer, body } = openPalette();
  placer.selectBuilding("house");
  const list = buildList(body);
  assert.ok(list);
  list.scrollTop = 220;

  assert.ok(placeOn(placer, 1, 1), "the placement must land");
  assert.equal(buildList(body)?.scrollTop, 220, "a placement must not throw the list back to the top");
});

test("scroll: a freshly opened palette starts at the top", () => {
  const { placer, body } = openPalette();
  const list = buildList(body);
  assert.ok(list);
  list.scrollTop = 180;
  buttonLabelled(body, "House").dispatchEvent("click");
  assert.equal(buildList(body)?.scrollTop, 180);

  placer.hidePalette();
  placer.showPalette(body as unknown as HTMLElement, 10, 10);
  assert.equal(buildList(body)?.scrollTop, 0, "reopening the palette is a fresh view, not a restored one");
});
