// The settlement-placement friction a real playthrough hit, asserted through the
// city view's own click path (the mock-DOM pattern from
// test/screens/settlements/buildingPaletteCart.test.ts, extended with the
// globals CityView's import chain touches). The findings come from
// .agentboard/playthrough-reports/wtgui-settlers-town-hall-level-2-r-44130c.md
// section (c) and Block 2; each test below fails against the pre-fix code:
//
//   1. A grid click was a silent no-op unless a mousemove preceded it:
//      handleBuildingClick called buildingPlacer.place(), which needs
//      hoverCell/valid from computeSnap(), and computeSnap only ever ran from
//      updateMouse (a mousemove). No request, no status, no words.
//   2. The 5x5 grid's centre cell is reserved and the only feedback was the
//      ghost's colour (green/red). "The center cell is reserved" is not
//      guessable from a colour.
//   3. Confirm re-committed an already-committed cart: cityView wired BOTH
//      setOnPlaced and setOnConfirm to persistBuildings, so one placement sent
//      two identical PlaceBuildings commands and two buildings_placed events.
//      On the granular store the second one is rejected outright
//      (duplicate key on (game_id, settlement_id, gx, gy)).
//   4. (The landing page's starter game is intended quick-start behaviour --
//      GameSessionManager.initBackend only creates one when the game list is
//      empty, and test/smoke.ts asserts the boot game is named starter-*. No
//      test here: no code changed for it.)

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { cellToScreen, cityLayout } from "../../../src/core/cityGrid";
import type { BuildingDef } from "@heroes/contracts";

// cityView's import chain reaches src/render/assetDescriptors.ts (Vite-?url /
// import.meta.glob-coupled) and the render module's PNG `?url` imports -- the
// same hook pair test/screens/settlements/buildingPaletteCart.test.ts registers.
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
const { BuildingPlacer } = await import("../../../src/screens/settlements/cityView/buildingPlacer");
const { cartCommitSignature } = await import("../../../src/screens/settlements/cityView/commitSignature");
const { toolbarHeight } = await import("../../../src/screens/shared/panelRail");
const { buildCityScene } = await import("../../../src/render/scene/sceneBuilder/cityScene");
const { paintCityGhostBuilding } = await import("../../../src/render/scene/paint2d");
const { makeNoopPaint2DDep, makeRecordingCtx } = await import("../../render/_helpers");

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

/** The palette's "why nothing happened" line, or null when the last click landed. */
function paletteNotice(root: MockNode): MockElement | null {
  return findAll(root, (el) => el.dataset.testid === "palette-notice")[0] ?? null;
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

interface FakeSettlement {
  id: string;
  name: string;
  ownerId: number;
  buildings: BuildingDef[];
  gold: number;
  warehouse: { wood: number; stone: number; iron: number; arcane: number; food: number };
}

interface Write {
  buildings: BuildingDef[];
  initialLayout: boolean;
}

interface Rig {
  view: InstanceType<typeof CityView>;
  body: MockElement;
  writes: Write[];
  live: FakeSettlement;
  closeCalls: number;
}

function makeRig(gameMode: string | undefined = "settlers"): Rig {
  const live: FakeSettlement = {
    id: SETTLEMENT_ID,
    name: "Test hold",
    ownerId: 0,
    buildings: [],
    gold: 5000,
    warehouse: { wood: 500, stone: 500, iron: 500, arcane: 500, food: 500 },
  };
  const writes: Write[] = [];
  const rig = {
    body: null as unknown as MockElement,
    writes,
    live,
    closeCalls: 0,
    view: null as unknown as InstanceType<typeof CityView>,
  };
  const view = new CityView({
    provider: {
      resolveSpriteForBuilding: () => null,
      resolveSpriteForUnit: () => null,
      resolveSpriteForCityPerson: () => null,
    },
    getGameMode: () => gameMode as never,
    onClose: (_id, buildings) => {
      rig.closeCalls += 1;
      live.buildings = buildings.map((b) => ({ ...b }));
      return true;
    },
    onPlaceBuildings: (_id, buildings, initialLayout) => {
      writes.push({ buildings: buildings.map((b) => ({ ...b })), initialLayout: initialLayout === true });
      live.buildings = buildings.map((b) => ({ ...b }));
      return true;
    },
    getSettlement: () => live as never,
    onUpgradeBuildings: () => ({ ok: true, reason: "" }),
  });
  rig.view = view;
  return rig;
}

/** The screen point of a grid cell's centre, exactly as the renderer places it. */
function cellPoint(gx: number, gy: number): { x: number; y: number } {
  const layout = cityLayout(5, VIEWPORT.w, VIEWPORT.h, toolbarHeight());
  const centre = cellToScreen(gx, gy, layout.gridOrigin);
  return {
    x: layout.screenOrigin.x + centre.x * layout.tileScale,
    y: layout.screenOrigin.y + centre.y * layout.tileScale,
  };
}

const NO_MODIFIER = { ctrlKey: false, metaKey: false, shiftKey: false };

/** Open the city, open the palette from its Build button, and select a row. */
function openPalette(rig: Rig, buildingLabel: string): void {
  rig.view.open(SETTLEMENT_ID, "Test hold", 5, "#d62828", [], [], [...rig.live.buildings], 31144237);
  const build = buttonLabelled(rig.body, "Build");
  assert.ok(build, "the City Design box's Build button must be in the document");
  build.dispatchEvent("click");
  const row = buttonLabelled(rig.body, buildingLabel);
  assert.ok(row, `the palette must list ${buildingLabel}`);
  row.dispatchEvent("click");
}

/** A click at the cell's own screen point, with NO mousemove before it. */
function clickCell(rig: Rig, gx: number, gy: number): void {
  const p = cellPoint(gx, gy);
  rig.view.handleBuildingClick(p.x, p.y, NO_MODIFIER);
}

const CITY_SETTINGS = {
  spriteVariant: 1,
  cityBackdrop: null,
  cityGridLines: true,
  parallaxEnabled: false,
  parallaxLayerCount: 4,
  cityBgOffsetX: 0,
  cityBgOffsetY: 0,
};

beforeEach(() => {
  installDom();
});

afterEach(() => {
  restoreDom();
});

// ── finding 1 ─────────────────────────────────────────────────────────

test("placement: a click places on the cell it landed on, with no mousemove before it", () => {
  const rig = makeRig();
  rig.body = (globalThis as { document: { body: MockElement } }).document.body;
  openPalette(rig, "Town Hall");

  clickCell(rig, 0, 0);

  assert.equal(rig.writes.length, 1, "a bare click must commit the held building");
  const written = rig.writes[0].buildings.filter((b) => b.kind === "townHall");
  assert.equal(written.length, 1);
  assert.deepEqual(
    { gx: written[0].gx, gy: written[0].gy },
    { gx: 0, gy: 0 },
    "the building must land on the cell the click landed on, not on a stale hover",
  );
  assert.equal(paletteNotice(rig.body), null, "a landed click leaves nothing to explain");
});

test("placement: a click outside the grid places nothing and says so", () => {
  const rig = makeRig();
  rig.body = (globalThis as { document: { body: MockElement } }).document.body;
  openPalette(rig, "Town Hall");

  // Below the diamond entirely: screenToGridCell has no cell there.
  rig.view.handleBuildingClick(20, VIEWPORT.h - 4, NO_MODIFIER);

  assert.equal(rig.writes.length, 0);
  const notice = paletteNotice(rig.body);
  assert.ok(notice, "a click that cannot place must say why, in words");
  assert.match(notice.textContent, /not a cell of the grid/i);
});

test("placement: a second click does not put the same cell in the cart twice", () => {
  const rig = makeRig();
  rig.body = (globalThis as { document: { body: MockElement } }).document.body;
  openPalette(rig, "Town Hall");

  clickCell(rig, 0, 0);
  assert.equal(rig.writes.length, 1);
  assert.equal(rig.writes[0].buildings.length, 1);

  // A click on a DIFFERENT cell while the same building is still held. Pre-fix
  // this re-placed at the stale hoverCell and the cart carried two identical
  // town-hall entries -- the payload the granular store rejects with a
  // duplicate-key 500 (measured off the wire in the playthrough).
  clickCell(rig, 4, 4);

  assert.equal(rig.writes.length, 1, "nothing new was committed");
  assert.equal(rig.writes[0].buildings.length, 1, "the cart must never hold two buildings on one cell");
});

// ── finding 2 ─────────────────────────────────────────────────────────

test("refusal: the reserved centre cell is explained in words, in the palette and beside the ghost", () => {
  const rig = makeRig();
  rig.body = (globalThis as { document: { body: MockElement } }).document.body;
  openPalette(rig, "Town Hall");

  // A 2x2 at (1,1) covers (2,2) -- the centre of a 5x5 grid.
  const p = cellPoint(1, 1);
  rig.view.updateMouse(p.x, p.y);
  clickCell(rig, 1, 1);

  assert.equal(rig.writes.length, 0, "the refused cell commits nothing");
  const notice = paletteNotice(rig.body);
  assert.ok(notice, "the palette must state the refusal in words");
  assert.equal(notice.textContent, "The center cell is reserved.");

  // The ghost carries the same sentence, and the painter draws it: the ghost's
  // colour alone was the whole of the old feedback.
  const placer = new BuildingPlacer();
  placer.init(5, { gx: 2, gy: 2 }, []);
  placer.selectBuilding("townHall");
  assert.equal(placer.canPlaceAt(1, 1), false, "the rule itself still refuses the centre");
  assert.equal(placer.placementBlockReason(1, 1), "The center cell is reserved.");
  assert.equal(placer.placementBlockReason(0, 0), null, "a free cell has no reason to give");
  placer.computeSnap(p.x, p.y, VIEWPORT.w, VIEWPORT.h);
  assert.equal(placer.hoverBlockReason(), "The center cell is reserved.", "the hovered ghost carries the reason");
  assert.equal(placer.ghostSnapshot()?.reason, "The center cell is reserved.");

  const nodes = buildCityScene({
    viewportW: VIEWPORT.w,
    viewportH: VIEWPORT.h,
    settlementName: "Test hold",
    size: 5,
    hover: { gx: 1, gy: 1 },
    citySpots: [],
    cityMines: [],
    buildings: [],
    ghost: { gx: 1, gy: 1, kind: "townHall", w: 2, h: 2, valid: false, reason: "The center cell is reserved." },
    citySettings: CITY_SETTINGS,
  } as Parameters<typeof buildCityScene>[0]);
  const ghostNode = nodes.find((n) => n.kind === "cityGhostBuilding");
  assert.ok(ghostNode && ghostNode.kind === "cityGhostBuilding");
  assert.equal(ghostNode.reason, "The center cell is reserved.");

  const { ctx, calls } = makeRecordingCtx();
  paintCityGhostBuilding(ctx, ghostNode, makeNoopPaint2DDep());
  const text = calls.find((c) => c.name === "fillText");
  assert.ok(text, "the invalid ghost must paint its reason as text");
  assert.equal(text.args[0], "The center cell is reserved.");
  assert.equal(text.args[1], ghostNode.center.x, "the sentence sits on the ghost, not in a corner");
  assert.ok((text.args[2] as number) > ghostNode.center.y, "and below it, clear of the footprint");
});

test("refusal: the reason is carried exactly when the ghost is refused, never on a valid one", () => {
  const scene = (ghost: Record<string, unknown>): ReturnType<typeof buildCityScene> =>
    buildCityScene({
      viewportW: VIEWPORT.w,
      viewportH: VIEWPORT.h,
      settlementName: "Test hold",
      size: 5,
      hover: { gx: 1, gy: 1 },
      citySpots: [],
      cityMines: [],
      buildings: [],
      ghost,
      citySettings: CITY_SETTINGS,
    } as Parameters<typeof buildCityScene>[0]);
  const ghostNodeOf = (nodes: ReturnType<typeof buildCityScene>): Record<string, unknown> => {
    const node = nodes.find((n) => n.kind === "cityGhostBuilding");
    assert.ok(node);
    return node as unknown as Record<string, unknown>;
  };

  const refused = ghostNodeOf(
    scene({ gx: 1, gy: 1, kind: "townHall", w: 2, h: 2, valid: false, reason: "The center cell is reserved." }),
  );
  assert.equal(refused.reason, "The center cell is reserved.", "a refused ghost carries its reason");

  const valid = ghostNodeOf(scene({ gx: 0, gy: 0, kind: "house", w: 1, h: 1, valid: true, reason: null }));
  assert.equal("reason" in valid, false, "a valid ghost's node stays byte-identical to the pre-reason shape");
});

// ── finding 3 ─────────────────────────────────────────────────────────

test("confirm: a second confirm of the same cart writes nothing", () => {
  const rig = makeRig();
  rig.body = (globalThis as { document: { body: MockElement } }).document.body;
  openPalette(rig, "Town Hall");

  clickCell(rig, 0, 0);
  assert.equal(rig.writes.length, 1, "the placement itself commits");
  assert.equal(rig.closeCalls, 1);

  const confirm = buttonLabelled(rig.body, "Confirm");
  assert.ok(confirm, "the palette must carry a Confirm button");
  confirm.dispatchEvent("click");

  assert.equal(rig.writes.length, 1, "Confirm must not re-send the cart the placement already sent");
  assert.equal(rig.closeCalls, 1, "and must not re-apply the same commit either");
});

test("confirm: a real change after the placement still commits, and the next confirm is quiet again", () => {
  const rig = makeRig();
  rig.body = (globalThis as { document: { body: MockElement } }).document.body;
  openPalette(rig, "Town Hall");

  clickCell(rig, 0, 0);
  assert.equal(rig.writes.length, 1);

  // A different building on a free cell is a real change: the fingerprint
  // moves, so the commit must go through.
  const houseRow = buttonLabelled(rig.body, "House");
  assert.ok(houseRow, "the palette must list a house");
  houseRow.dispatchEvent("click");
  clickCell(rig, 3, 3);
  assert.equal(rig.writes.length, 2, "a real change must still be committed");
  assert.equal(rig.writes[1].buildings.length, 2);

  const confirm = buttonLabelled(rig.body, "Confirm");
  assert.ok(confirm);
  confirm.dispatchEvent("click");
  assert.equal(rig.writes.length, 2, "and the confirm that follows is quiet again");
});

test("confirm: the free starter layout is not re-sent by a confirm either", () => {
  // Classic mode: an empty settlement is handed its free starter city on open,
  // and that commit must not be repeated by the palette's Confirm.
  const rig = makeRig("classic");
  rig.body = (globalThis as { document: { body: MockElement } }).document.body;
  rig.view.open(SETTLEMENT_ID, "Test hold", 5, "#d62828", [], [], [], 31144237);
  assert.equal(rig.writes.length, 1, "the starter layout commits once, at open");
  assert.equal(rig.writes[0].initialLayout, true);

  const build = buttonLabelled(rig.body, "Build");
  assert.ok(build);
  build.dispatchEvent("click");
  const confirm = buttonLabelled(rig.body, "Confirm");
  assert.ok(confirm);
  confirm.dispatchEvent("click");

  assert.equal(rig.writes.length, 1, "Confirm must not re-send the starter layout");
});

test("commit signature: identical carts collide, a real difference does not", () => {
  const cart: BuildingDef[] = [{ gx: 0, gy: 0, kind: "townHall", level: 1, style: "pixel", w: 2, h: 2 }];
  const settled = cartCommitSignature(cart, false, undefined, {});
  assert.equal(cartCommitSignature([...cart], false, undefined, {}), settled);
  assert.notEqual(cartCommitSignature(cart, false, undefined, { gold: 150 }), settled, "an unpaid charge is a different write");
  assert.notEqual(cartCommitSignature(cart, true, undefined, {}), settled, "the initial layout is a different write");
  assert.notEqual(cartCommitSignature(cart, false, { q: 4, r: 4 }, {}), settled, "a district is a different write");
  assert.notEqual(
    cartCommitSignature([...cart, { gx: 3, gy: 3, kind: "house", level: 1, w: 1, h: 1 }], false, undefined, {}),
    settled,
    "a second building is a different write",
  );
});

