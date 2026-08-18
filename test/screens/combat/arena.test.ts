import { test } from "node:test";
import assert from "node:assert/strict";
import {
  startManualBattle,
  type BattleSide,
  type Combatant,
  type ManualBattleState,
} from "@heroes/engine";
import type { UnitType } from "../../../src/state/units";
import { fitHexSize, gridExtent, type GridExtent } from "../../../src/screens/combat/arena/layout";
import { buildPlatoonStrip } from "../../../src/screens/combat/arena/view";
import { applyLeaveBehind } from "../../../src/screens/combat/arena/leaveBehind";

// ---- Hand-rolled minimal DOM mock -----------------------------------------
// The arena modules touch document.createElement / Node.style / addEventListener
// in view.ts (buildPlatoonStrip) and leaveBehind.ts (openLeaveBehindDialog).
// jsdom is intentionally not added; node:test provides the harness.

// Captures CSS-style property reads/writes through a Proxy. The arena code
// sets styles with `Object.assign(el.style, { border: "..." })` and reads them
// back via `el.style.getProperty(name)` — both paths must see the same store.
function makeMockStyle(): MockStyle {
  const map = new Map<string, string>();
  const target = new Proxy({} as Record<string, unknown>, {
    get(_t, prop) {
      if (prop === "setProperty") return (name: string, value: string) => map.set(name, value);
      if (prop === "getProperty") return (name: string) => map.get(name) ?? "";
      if (typeof prop === "string") return map.get(prop) ?? "";
      return undefined;
    },
    set(_t, prop, value) {
      if (typeof prop === "string" && prop !== "setProperty" && prop !== "getProperty") {
        map.set(prop, String(value));
      }
      return true;
    },
    has(_t, prop) {
      return typeof prop === "string" && map.has(prop);
    },
    ownKeys() {
      return Array.from(map.keys());
    },
  }) as unknown as MockStyle;
  return target;
}

class MockStyle {
  setProperty(_name: string, _value: string): void {}
  getProperty(_name: string): string { return ""; }
  toString(): string { return ""; }
}

class MockNode {
  readonly children: MockNode[] = [];
  readonly style: MockStyle = makeMockStyle();
  parent: MockNode | null = null;
  textContent = "";
  innerHTML = "";
  className = "";
  dataset: Record<string, string> = {};
  private readonly listeners = new Map<string, Array<(...args: unknown[]) => unknown>>();

  appendChild(child: MockNode): MockNode {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  append(...children: MockNode[]): void {
    for (const c of children) this.appendChild(c);
  }

  removeChild(child: MockNode): void {
    const i = this.children.indexOf(child);
    if (i >= 0) this.children.splice(i, 1);
    child.parent = null;
  }

  contains(other: MockNode | null): boolean {
    if (other === null) return false;
    let cur: MockNode | null = other;
    while (cur) {
      if (cur === this) return true;
      cur = cur.parent;
    }
    return false;
  }

  closest(selector: string): MockNode | null {
    if (!selector.startsWith("[")) return null;
    const end = selector.indexOf("]");
    if (end < 0) return null;
    const body = selector.slice(1, end);
    const eq = body.indexOf("=");
    let key: string;
    let value: string | undefined;
    if (eq < 0) {
      key = body;
      value = undefined;
    } else {
      key = body.slice(0, eq);
      value = body.slice(eq + 1);
    }
    let cur: MockNode | null = this;
    while (cur) {
      if (value === undefined) {
        if (Object.prototype.hasOwnProperty.call(cur.dataset, key)) return cur;
      } else if (cur.dataset[key] === value) return cur;
      cur = cur.parent;
    }
    return null;
  }

  addEventListener(event: string, handler: (...args: unknown[]) => unknown): void {
    const list = this.listeners.get(event) ?? [];
    list.push(handler);
    this.listeners.set(event, list);
  }

  dispatch(event: string, ...args: unknown[]): void {
    const list = this.listeners.get(event) ?? [];
    for (const h of list) h(...args);
  }
}

class MockElement extends MockNode {
  readonly tagName: string;
  constructor(tagName: string) { super(); this.tagName = tagName.toUpperCase(); }
  get disabled(): boolean { return this.dataset["disabled"] === "true"; }
  set disabled(v: boolean) { this.dataset["disabled"] = v ? "true" : "false"; }
}

const savedDocument = (globalThis as { document?: unknown }).document;
const savedWindow = (globalThis as { window?: unknown }).window;
const savedRequestAnimationFrame = (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame;

function installDom(): void {
  (globalThis as { document: unknown }).document = {
    createElement(tag: string): MockElement {
      return new MockElement(tag);
    },
    body: new MockElement("body"),
  };
  (globalThis as { window: unknown }).window = {
    innerWidth: 1280,
    innerHeight: 720,
  };
  (globalThis as { requestAnimationFrame: unknown }).requestAnimationFrame = () => 0;
}

function restoreDom(): void {
  if (savedDocument === undefined) delete (globalThis as { document?: unknown }).document;
  else (globalThis as { document: unknown }).document = savedDocument;
  if (savedWindow === undefined) delete (globalThis as { window?: unknown }).window;
  else (globalThis as { window: unknown }).window = savedWindow;
  if (savedRequestAnimationFrame === undefined) delete (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame;
  else (globalThis as { requestAnimationFrame: unknown }).requestAnimationFrame = savedRequestAnimationFrame as never;
}

// ---- Helpers for crafting a small ManualBattleState -----------------------

const unitTypes: Record<string, UnitType> = {
  footman: {
    id: "footman",
    name: "Footman",
    attack: 5,
    defence: 5,
    health: 20,
    speed: 3,
    description: "",
    advantageType: "infantry",
    specialty: "shield",
    specialtyPriority: 0,
  },
  archer: {
    id: "archer",
    name: "Archer",
    attack: 5,
    defence: 2,
    health: 10,
    speed: 3,
    description: "",
    advantageType: "ranged",
    specialty: "archery",
    specialtyPriority: 0,
  },
};

function makeCombatant(slotIndex: number, side: BattleSide, q: number, r: number, entries: { unitTypeId: string; count: number }[]): Combatant {
  let maxHealth = 0;
  for (const e of entries) {
    const ut = unitTypes[e.unitTypeId];
    if (ut) maxHealth += e.count * ut.health;
  }
  return {
    side,
    slotIndex,
    position: { q, r },
    entries: entries.map((e) => ({ unitTypeId: e.unitTypeId, count: e.count })),
    retreated: false,
    maxHealth,
    hasCounterCharge: true,
  };
}

function makeState(): ManualBattleState {
  const playerPlatoons = [{ entries: [{ unitTypeId: "footman", count: 5 }, { unitTypeId: "archer", count: 3 }] }];
  const aiPlatoons = [{ entries: [{ unitTypeId: "footman", count: 4 }] }];
  return startManualBattle(playerPlatoons, aiPlatoons, {
    unitTypes,
    obstacleSeed: 1,
    sideChoice: "attacker",
  });
}

// ---- layout tests ---------------------------------------------------------

test("fitHexSize: 1280x720 box yields a hex size between MIN and MAX", () => {
  const state = makeState();
  const extent = gridExtent(state, 1);
  const size = fitHexSize(extent, 1280, 720);
  assert.ok(size >= 14 && size <= 44, `got ${size}`);
});

test("fitHexSize: 1920x1080 box yields a larger hex than 1280x720 (same grid)", () => {
  const state = makeState();
  const extent = gridExtent(state, 1);
  const at1080 = fitHexSize(extent, 1920, 1080);
  const at720 = fitHexSize(extent, 1280, 720);
  assert.ok(at1080 >= at720, `1080=${at1080}, 720=${at720}`);
});

test("fitHexSize: 900x600 small viewport clamps to HEX_SIZE_MIN", () => {
  const state = makeState();
  const extent = gridExtent(state, 1);
  const size = fitHexSize(extent, 900, 600);
  assert.ok(size >= 14, `expected at least HEX_SIZE_MIN, got ${size}`);
});

test("gridExtent: a unit-extent object with zero span is well-formed", () => {
  const empty: GridExtent = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const size = fitHexSize(empty, 800, 600);
  assert.ok(size >= 14 && size <= 44, `got ${size}`);
});

// ---- view tests -----------------------------------------------------------

test("buildPlatoonStrip: collapsed strip has a top row + HP track, no detail rows", () => {
  installDom();
  try {
    const state = makeState();
    const combatant = state.attacker[0];
    const strip = buildPlatoonStrip({
      state,
      combatant,
      accent: "#3070c0",
      selected: false,
      dimmed: false,
      expanded: false,
    });
    // Collapsed-but-alive = top row + HP track (2 children). Expanded adds
    // the detail rows on top.
    assert.equal(strip.children.length, 2, "collapsed strip should have only the top row + HP track");
  } finally {
    restoreDom();
  }
});

test("buildPlatoonStrip: selected strip uses the accent color in its border", () => {
  installDom();
  try {
    const state = makeState();
    const combatant = state.attacker[0];
    const selected = buildPlatoonStrip({
      state,
      combatant,
      accent: "#3070c0",
      selected: true,
      dimmed: false,
      expanded: false,
    });
    const unselected = buildPlatoonStrip({
      state,
      combatant,
      accent: "#3070c0",
      selected: false,
      dimmed: false,
      expanded: false,
    });
    assert.notEqual(
      selected.style.getProperty("border"),
      unselected.style.getProperty("border"),
      "selected vs unselected strip borders should differ",
    );
  } finally {
    restoreDom();
  }
});

test("buildPlatoonStrip: dimmed/dead opacity is lower than alive", () => {
  installDom();
  try {
    const state = makeState();
    const combatant = state.attacker[0];
    const alive = buildPlatoonStrip({
      state,
      combatant,
      accent: "#3070c0",
      selected: false,
      dimmed: false,
      expanded: false,
    });
    const dimmed = buildPlatoonStrip({
      state,
      combatant,
      accent: "#3070c0",
      selected: false,
      dimmed: true,
      expanded: false,
    });
    const dead = makeCombatant(0, "attacker", 0, 0, [{ unitTypeId: "footman", count: 0 }]);
    const deadStrip = buildPlatoonStrip({
      state,
      combatant: dead,
      accent: "#3070c0",
      selected: false,
      dimmed: false,
      expanded: false,
    });
    assert.equal(alive.style.getProperty("opacity"), "1");
    assert.equal(dimmed.style.getProperty("opacity"), "0.55");
    assert.equal(deadStrip.style.getProperty("opacity"), "0.35");
  } finally {
    restoreDom();
  }
});

// ---- leaveBehind tests ----------------------------------------------------

test("applyLeaveBehind: zero shortfall is a no-op (all counts preserved)", () => {
  const state = makeState();
  const before = state.attacker[0].entries.map((e) => e.count);
  applyLeaveBehind(state, "attacker", new Map());
  const after = state.attacker[0].entries.map((e) => e.count);
  assert.deepEqual(after, before, "empty leftBehind map should not mutate counts");
});

test("applyLeaveBehind: removes the requested count from matching entries", () => {
  const state = makeState();
  applyLeaveBehind(state, "attacker", new Map([["0:footman", 2]]));
  const footman = state.attacker[0].entries.find((e) => e.unitTypeId === "footman");
  assert.ok(footman, "footman entry should still exist");
  assert.equal(footman.count, 3, "5 - 2 = 3");
  const archer = state.attacker[0].entries.find((e) => e.unitTypeId === "archer");
  assert.equal(archer?.count, 3, "untouched entry count should be unchanged");
});

test("applyLeaveBehind: removing more than the count drops the entry entirely", () => {
  const state = makeState();
  applyLeaveBehind(state, "attacker", new Map([["0:archer", 99]]));
  const archer = state.attacker[0].entries.find((e) => e.unitTypeId === "archer");
  assert.equal(archer, undefined, "archer entry should be removed when count reaches 0");
});

test("applyLeaveBehind: only the named side is mutated", () => {
  const state = makeState();
  const attackerFootBefore = state.attacker[0].entries.find((e) => e.unitTypeId === "footman")!.count;
  const defenderFootBefore = state.defender[0].entries.find((e) => e.unitTypeId === "footman")!.count;
  applyLeaveBehind(state, "defender", new Map([["0:footman", 2]]));
  assert.equal(state.attacker[0].entries.find((e) => e.unitTypeId === "footman")!.count, attackerFootBefore);
  assert.equal(state.defender[0].entries.find((e) => e.unitTypeId === "footman")!.count, defenderFootBefore - 2);
});

test("applyLeaveBehind: ignores entries for retreated combatants", () => {
  const state = makeState();
  state.attacker[0].retreated = true;
  applyLeaveBehind(state, "attacker", new Map([["0:footman", 2]]));
  assert.equal(state.attacker[0].entries.find((e) => e.unitTypeId === "footman")!.count, 5);
});