// The city view's own readout of a construction site (2026-11-03). Both defects
// below live on the SAME line -- the site-status sentence the building menu
// prints -- and each has its own case, because fixing one is not fixing the
// other.
//
// F-b. A fresh placement was DISPLAYED as an automatic 2.00x crew (4 of 4
// builders) until the next End Turn, while the SERVER row already read
// `workers: 0`. Measured root cause: the city view's commit hands the same cart
// to TWO writers, in this order -- UIManager.onClose writes it straight into the
// client's state (its optimistic resource settle), and only then does
// UIManager.onPlaceBuildings run the engine's own `applyPlaceBuildings` on that
// already-written state. The resolver treats every entry it finds in the
// settlement as an EXISTING building (the cart round-trips whole between
// commits) and copies its staffing verbatim, so the engine's new-placement rule
// never ran for the fresh building on the CLIENT: the row kept the cart's absent
// count, `buildersOnSite` read that as the auto crew (the site ceiling, 4), and
// the menu printed 2.00x for a site the server holds frozen at 0. An unrelated
// AssignWorkers does not reconcile it -- assignWorkers writes only the building
// it addresses -- and only the next EndTurn's state replace does.
//
// The rig below reproduces that two-writer order exactly (both mocks quote the
// production call they stand in for), and the invariant each case pins is the
// one the brief names: the CLIENT's optimistic row for a fresh placement is the
// row the SERVER stores, and the sentence the player reads is the engine's own
// progress rule for it.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { cellToScreen, cityLayout } from "../../../src/core/cityGrid";
import type { BuildingDef, SettlementState } from "@heroes/contracts";
import type { GameState } from "@heroes/contracts";
import { applyPlaceBuildings, buildersOnSite, buildRate, newPlacementsAutoCrew } from "@heroes/engine";
import { makeSettlement, makeState, emptyWarehouse } from "../../charter/_helpers";

// cityView's import chain reaches src/render/assetDescriptors.ts (Vite-?url /
// import.meta.glob-coupled) and the render module's PNG `?url` imports -- the
// same hook pair test/screens/settlements/settlementPlacement.test.ts registers.
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

const { CityView } = await import("../../../src/screens/settlements/cityView/cityView");
const { siteStatus } = await import("../../../src/screens/settlements/cityView/siteStatus");
const { SpriteProvider } = await import("../../../src/render/assets");
const { toolbarHeight } = await import("@screens/shared/panelRail");

/** A provider that resolves nothing: this file drives the city view's own state, never a sprite. */
const NO_SPRITES = new SpriteProvider({ preload: () => {}, resolve: () => undefined });

/** The sentence the menu prints for a site, from the module the menu reads. */
function siteStatusText(b: BuildingDef, days: number): string {
  return siteStatus(b, days).text;
}

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

function buttonLabelled(root: MockNode, text: string): MockElement | null {
  return findAll(root, (el) => el.tagName === "BUTTON" && el.textContent.includes(text))[0] ?? null;
}

const savedGlobals = new Map<string, unknown>();
const GLOBAL_KEYS = ["document", "window", "getComputedStyle", "localStorage", "ResizeObserver", "Image", "HTMLCanvasElement"] as const;

function installDom(): MockElement {
  const body = new MockElement("body");
  const store = new Map<string, string>();
  for (const key of GLOBAL_KEYS) savedGlobals.set(key, (globalThis as Record<string, unknown>)[key]);
  const g = globalThis as Record<string, unknown>;
  g.document = {
    createElement: (tag: string): MockElement => new MockElement(tag),
    body,
    getElementById: () => null,
    addEventListener: () => {},
    removeEventListener: () => {},
    documentElement: { style: { setProperty: () => {} } },
  };
  g.window = {
    innerWidth: 1280,
    innerHeight: 720,
    addEventListener: () => {},
    removeEventListener: () => {},
    setTimeout: (fn: () => void) => setTimeout(fn, 0),
    clearTimeout: (id: unknown) => clearTimeout(id as NodeJS.Timeout),
    location: { search: "" },
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  };
  g.localStorage = (g.window as { localStorage: unknown }).localStorage;
  g.getComputedStyle = () => makeMockStyle();
  g.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
  g.Image = class {};
  g.HTMLCanvasElement = class {};
  return body;
}

function restoreDom(): void {
  for (const key of GLOBAL_KEYS) {
    const saved = savedGlobals.get(key);
    if (saved === undefined) delete (globalThis as Record<string, unknown>)[key];
    else (globalThis as Record<string, unknown>)[key] = saved;
  }
}

// ── the city view under test ──────────────────────────────────────────

const VIEWPORT = { w: 1280, h: 720 };
const SETTLEMENT_ID = "s0";
const SEED = 31144237;

function building(kind: BuildingDef["kind"], gx: number, gy: number, extra: Partial<BuildingDef> = {}): BuildingDef {
  return { gx, gy, kind, level: 1, style: "classic", ...extra };
}

/**
 * A settlement in one of the two shapes `newPlacementsAutoCrew` tells apart: a
 * pure BOOTSTRAP (no explicit count, no districts -- new placements stay on the
 * free auto crew) or a town being GROWN (one district is enough -- new
 * placements start at an explicit 0).
 */
function settlementOf(shape: "bootstrap" | "grown", buildings: BuildingDef[]): SettlementState {
  const s = makeSettlement(SETTLEMENT_ID, 0, 5, 5, {
    level: 3,
    population: 1500,
    gold: 5000,
    warehouse: emptyWarehouse({ wood: 500, stone: 500, iron: 500, arcane: 500, food: 500 }),
    buildings,
  });
  if (shape === "bootstrap") return s;
  return {
    ...s,
    districts: { "6,5": { q: 6, r: 5, citySpots: [], buildings: [building("farmField", 0, 0)] } },
  } as SettlementState;
}

interface Rig {
  view: InstanceType<typeof CityView>;
  body: MockElement;
  /** The payload of every onPlaceBuildings call, cloned. */
  payloads: Array<{ buildings: BuildingDef[]; initialLayout: boolean }>;
  /** The settlement the client's state holds, as the writers below leave it. */
  live: SettlementState;
  /** Buildings of the client's settlement after its last commit. */
  clientBuildings: BuildingDef[];
}

/**
 * A CityView wired to the city view's TWO production writers, in their real
 * order (see the file header):
 *
 *   - onClose mirrors `UIManager.onClose`'s optimistic write -- it settles the
 *     cart into the client's own state BEFORE the engine's commit runs;
 *   - onPlaceBuildings mirrors `UIManager.onPlaceBuildings` (turnController.
 *     placeBuildings): it runs the engine's own `applyPlaceBuildings` against
 *     the client's CURRENT state and adopts the result.
 *
 * `getSettlement` is the client's own state read, exactly as UIManager's is.
 */
function makeRig(shape: "bootstrap" | "grown", start: BuildingDef[]): Rig {
  const live = settlementOf(shape, start.map((b) => ({ ...b })));
  const rig = {
    body: null as unknown as MockElement,
    payloads: [] as Array<{ buildings: BuildingDef[]; initialLayout: boolean }>,
    live,
    clientBuildings: [] as BuildingDef[],
    view: null as unknown as InstanceType<typeof CityView>,
  };
  const clientState = (): GameState => makeState({ settlements: [rig.live] });
  const view = new CityView({
    provider: NO_SPRITES,
    getGameMode: () => "settlers" as never,
    onClose: (_id, buildings) => {
      rig.live = { ...rig.live, buildings: buildings.map((b) => ({ ...b })) };
      return true;
    },
    onPlaceBuildings: (_id, buildings, initialLayout) => {
      rig.payloads.push({ buildings: buildings.map((b) => ({ ...b })), initialLayout: initialLayout === true });
      const result = applyPlaceBuildings(clientState(), SETTLEMENT_ID, 0, buildings.map((b) => ({ ...b })), initialLayout === true);
      if (!result.ok) return false;
      rig.live = result.state.settlements[SETTLEMENT_ID];
      rig.clientBuildings = rig.live.buildings;
      return true;
    },
    getSettlement: () => rig.live,
    onUpgradeBuildings: () => ({ ok: true, reason: "" }),
  });
  rig.view = view;
  return rig;
}

function cellPoint(gx: number, gy: number): { x: number; y: number } {
  const layout = cityLayout(5, VIEWPORT.w, VIEWPORT.h, toolbarHeight());
  const centre = cellToScreen(gx, gy, layout.gridOrigin);
  return {
    x: layout.screenOrigin.x + centre.x * layout.tileScale,
    y: layout.screenOrigin.y + centre.y * layout.tileScale,
  };
}

const NO_MODIFIER = { ctrlKey: false, metaKey: false, shiftKey: false };

/** Open the city, open the palette from its Build button, and select one row. */
function openPalette(rig: Rig, label: string): void {
  rig.view.open(SETTLEMENT_ID, "Test hold", 5, "#d62828", [], [], rig.live.buildings, SEED);
  const build = buttonLabelled(rig.body, "Build");
  assert.ok(build, "the City Design box's Build button must be in the document");
  build.dispatchEvent("click");
  const row = buttonLabelled(rig.body, label);
  assert.ok(row, `the palette must list ${label}`);
  row.dispatchEvent("click");
}

function clickCell(rig: Rig, gx: number, gy: number): void {
  const p = cellPoint(gx, gy);
  rig.view.handleBuildingClick(p.x, p.y, NO_MODIFIER);
}

beforeEach(() => {
  installDom();
});

afterEach(() => {
  restoreDom();
});

// ── F-b ───────────────────────────────────────────────────────────────

test("F-b: a fresh placement's row is the row the server stores, not an automatic full crew", () => {
  const rig = makeRig("grown", [building("farmField", 0, 0)]);
  rig.body = (globalThis as unknown as { document: { body: MockElement } }).document.body;
  const before = structuredClone(rig.live);
  assert.equal(newPlacementsAutoCrew(rig.live), false, "the fixture is a town being grown, not a bootstrap");

  openPalette(rig, "Granary");
  clickCell(rig, 3, 3);

  assert.equal(rig.payloads.length, 1, "the placement commits once");
  const payload = rig.payloads[0].buildings;
  const fresh = payload.find((b) => b.kind === "granary");
  assert.ok(fresh, "the cart carries the fresh placement");

  // The SERVER's row, computed the way server/app/commandHandler.ts does: the
  // same reducer against the settlement as the server still holds it.
  const server = applyPlaceBuildings(makeState({ settlements: [before] }), SETTLEMENT_ID, 0, payload.map((b) => ({ ...b })));
  assert.equal(server.ok, true);
  const serverRow = server.state.settlements[SETTLEMENT_ID].buildings.find((b) => b.kind === "granary");
  assert.ok(serverRow);

  const clientRow = rig.clientBuildings.find((b) => b.kind === "granary");
  assert.ok(clientRow, "the client's own state holds the placement");

  // The invariant: on the client, a fresh placement into a grown town is
  // staffed out of the pool (`workers: 0`) exactly as the server stores it.
  assert.equal(serverRow.workers, 0, "the server freezes a fresh site in a grown town until it is staffed");
  assert.equal(
    clientRow.workers,
    serverRow.workers,
    `the client's optimistic row must be the server's row -- client ${JSON.stringify(clientRow)} vs server ${JSON.stringify(serverRow)}`,
  );

  // ...which is what the player reads: the engine's own progress rule, not a
  // 2.00x crew the site does not have.
  const days = clientRow.construction?.daysRemaining ?? 0;
  const show = { builders: buildersOnSite(clientRow), rate: buildRate(buildersOnSite(clientRow)).toFixed(2) };
  assert.deepEqual(show, { builders: 0, rate: "0.00" }, "the site has nobody on it");
  assert.equal(
    siteStatusText(clientRow, days),
    "Under construction \u2014 stalled: no builders \u00b7 3 days remaining",
    "and the menu sentence says the site is frozen, not that it is at a full crew",
  );
});

test("F-b control: a bootstrap town's fresh placement keeps the free auto crew on BOTH sides", () => {
  const rig = makeRig("bootstrap", [building("farmField", 0, 0)]);
  rig.body = (globalThis as unknown as { document: { body: MockElement } }).document.body;
  const before = structuredClone(rig.live);
  assert.equal(newPlacementsAutoCrew(rig.live), true, "the fixture is a pure bootstrap");

  openPalette(rig, "Granary");
  clickCell(rig, 3, 3);

  const payload = rig.payloads[0].buildings;
  const server = applyPlaceBuildings(makeState({ settlements: [before] }), SETTLEMENT_ID, 0, payload.map((b) => ({ ...b })));
  const serverRow = server.state.settlements[SETTLEMENT_ID].buildings.find((b) => b.kind === "granary");
  const clientRow = rig.clientBuildings.find((b) => b.kind === "granary");
  assert.ok(serverRow && clientRow);

  assert.equal(serverRow.workers, undefined, "a bootstrap placement stays on the legacy auto crew server-side");
  assert.equal(clientRow.workers, serverRow.workers, "and the client must not invent an explicit 0 for it either");
  assert.equal(
    siteStatusText(clientRow, clientRow.construction?.daysRemaining ?? 0),
    "Under construction \u2014 2.00\u00d7 (4 of 4 builders) \u00b7 3 days remaining",
    "the free crew is a real 2.00x site, and the line must still say so",
  );
});
