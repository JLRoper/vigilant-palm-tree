import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { openSettingsMenu } from "../../../src/screens/home/settingsMenu";
import { DEFAULT_SETTINGS, gameModeOptions, settings, updateSettings, type GameSettings } from "../../../src/state/settings";
import { DEFAULT_TOOLBAR_STYLE, TOOLBAR_THEMES } from "../../../src/state/toolbarThemes";
import { DEFAULT_GAME_MODE } from "@heroes/contracts";

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
// ── The panel's own contents (playthrough round 4, F1/F2) ───────────────
//
// The rule these pin: a settings panel must not misrepresent what it holds.
// Every key the store persists has a control that writes it, every slider row
// shows its own name and its current value, and Reset restores EVERY key --
// not a hand-kept subset of them.

function textOf(el: MockElement): string {
  return el.textContent + el.children.map(textOf).join("");
}

function findBySetting(root: MockElement, key: string): MockElement | null {
  return root.querySelector(`[data-setting="${key}"]`);
}

function findAll(root: MockElement, pred: (el: MockElement) => boolean): MockElement[] {
  const out: MockElement[] = [];
  for (const child of root.children) {
    if (pred(child)) out.push(child);
    out.push(...findAll(child, pred));
  }
  return out;
}

interface ControlSpec {
  kind: "range" | "select" | "checkbox";
  /** A value that differs from the key's DEFAULT and is inside its range. */
  set: number | string | boolean;
}

/**
 * The panel's control for every key the store persists. A key added to
 * GameSettings without a control is a compile error HERE and a failure in the
 * test below -- which is the point: the panel must not silently drop a setting
 * it claims to hold.
 *
 * ORDER MATTERS ONCE: the four skybox-only rows (the two background offsets,
 * the parallax toggle and the layer count) are inert while the city backdrop is
 * the diorama, so the table switches the backdrop to the skybox first.
 */
const PANEL_CONTROLS: Record<keyof GameSettings, ControlSpec> = {
  moveDurationMs: { kind: "range", set: 520 },
  enemyMoveDurationMs: { kind: "range", set: 640 },
  arenaMoveMsPerHex: { kind: "range", set: 250 },
  territoryBorderWidth: { kind: "range", set: 3 },
  populationGrowthRate: { kind: "range", set: 0.3 },
  cityBackdrop: { kind: "select", set: "skybox" },
  cityBgOffsetX: { kind: "range", set: 40 },
  cityBgOffsetY: { kind: "range", set: -40 },
  parallaxEnabled: { kind: "checkbox", set: true },
  parallaxLayerCount: { kind: "range", set: 3 },
  maxZoomOutHexesWide: { kind: "range", set: 30 },
  toolbarStyle: { kind: "select", set: "classic-blue" },
  resourceStyle: { kind: "select", set: "iso-bubbly" },
  spriteVariant: { kind: "select", set: 4 },
  cityGridLines: { kind: "checkbox", set: false },
  buildingUpgradeConfirm: { kind: "checkbox", set: false },
  showLogPanel: { kind: "checkbox", set: true },
  gameMode: { kind: "select", set: "settlers" },
};

/**
 * Every slider row: its key, a pattern for the name it shows, and a pattern
 * for its current value. The parallax layer slider is the one row whose single
 * line carries both name and value ("3 layers — speeds: …"), which is why its
 * name pattern matches that line rather than a plain name.
 */
const SLIDER_ROWS: Array<[keyof GameSettings, RegExp, RegExp]> = [
  ["moveDurationMs", /^Hero movement speed/, /\d+ms \u00b7 /],
  ["enemyMoveDurationMs", /^Enemy movement speed/, /\d+ms \u00b7 /],
  ["arenaMoveMsPerHex", /^Battle move animation speed/, /\d+ms\/hex \u00b7 /],
  ["territoryBorderWidth", /^Territory border thickness/, /\d+(\.\d+)?px/],
  ["populationGrowthRate", /^Population growth rate/, /\d+%/],
  ["parallaxLayerCount", /^\d+ layers/, /\d+ layers \u2014 speeds: /],
  ["cityBgOffsetX", /^City background X offset/, /-?\d+px/],
  ["cityBgOffsetY", /^City background Y offset/, /-?\d+px/],
  ["maxZoomOutHexesWide", /^Max zoom-out width/, /\d+ hexes wide/],
];

test("every slider row carries its own name and its current value", () => {
  const parent = new MockElement("div");
  openSettingsMenu({ parent });
  try {
    const sliders = findAll(parent, (el) => el.tagName === "INPUT" && el.type === "range");
    assert.equal(
      sliders.length,
      SLIDER_ROWS.length,
      "the panel's slider count -- a new slider must arrive with its own row here",
    );
    for (const [key, namePattern, valuePattern] of SLIDER_ROWS) {
      const slider = findBySetting(parent, key);
      assert.ok(slider, `${key}: no slider carries a data-setting hook`);
      const row = slider.parent;
      assert.ok(row, `${key}: the slider is not mounted in a row`);
      assert.ok(
        row.children.some((child) => namePattern.test(textOf(child).trim())),
        `${key}: the row does not name its slider (a bare number is what round 4 F1 found)`,
      );
      assert.match(
        textOf(row),
        valuePattern,
        `${key}: the row does not show the slider's current value`,
      );
    }
  } finally {
    updateSettings({ ...DEFAULT_SETTINGS });
  }
});

test("every persisted setting has a control in the panel, and each control writes its own key", () => {
  const parent = new MockElement("div");
  openSettingsMenu({ parent });
  updateSettings({ ...DEFAULT_SETTINGS });
  try {
    for (const key of Object.keys(PANEL_CONTROLS) as Array<keyof GameSettings>) {
      const spec = PANEL_CONTROLS[key];
      const control = findBySetting(parent, key);
      assert.ok(control, `${key} has no control in the panel, so a player cannot change it`);
      if (spec.kind === "checkbox") {
        control.checked = spec.set === true;
        control.dispatchEvent("change");
      } else {
        control.value = String(spec.set);
        control.dispatchEvent(spec.kind === "range" ? "input" : "change");
      }
      assert.equal(settings()[key], spec.set, `${key} was not written by its own control`);
    }
  } finally {
    updateSettings({ ...DEFAULT_SETTINGS });
  }
});

test("Reset to default restores every key the store persists", () => {
  const parent = new MockElement("div");
  openSettingsMenu({ parent });
  const off: Partial<GameSettings> = {};
  for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof GameSettings>) {
    (off as Record<string, unknown>)[key] = PANEL_CONTROLS[key].set;
  }
  try {
    updateSettings(off);
    for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof GameSettings>) {
      assert.notDeepEqual(
        settings()[key],
        DEFAULT_SETTINGS[key],
        `${key} is still at its default, so a Reset that restores nothing would pass`,
      );
    }

    const reset = findButton(parent, "Reset to default");
    assert.ok(reset);
    reset.dispatchEvent("click");
    assert.deepEqual(settings(), DEFAULT_SETTINGS, "Reset left a key at the player's value");

    // The panel's own controls followed the reset -- including the two keys the
    // old hand-kept list missed.
    assert.equal(findBySetting(parent, "gameMode")?.value, DEFAULT_GAME_MODE);
    assert.equal(findBySetting(parent, "buildingUpgradeConfirm")?.checked, true);
  } finally {
    updateSettings({ ...DEFAULT_SETTINGS });
  }
});

test("the new-game default mode has a writer in the UI, and it says when it applies", () => {
  const parent = new MockElement("div");
  updateSettings({ gameMode: DEFAULT_GAME_MODE });
  try {
    openSettingsMenu({ parent });
    const select = findBySetting(parent, "gameMode");
    assert.ok(select, "the stored new-game default had no writer a player could reach (round 4 F2)");
    assert.deepEqual(
      select.children.map((opt) => [opt.value, opt.textContent]),
      gameModeOptions().map((opt) => [opt.value, opt.label]),
      "the writer offers the store's own option list, not a second copy",
    );
    assert.equal(select.value, DEFAULT_GAME_MODE);

    select.value = "settlers";
    select.dispatchEvent("change");
    assert.equal(settings().gameMode, "settlers", "the panel's own control writes the stored default");

    const hint = parent.querySelector('[data-setting-hint="gameMode"]');
    assert.ok(hint);
    assert.match(textOf(hint), /New Game form starts on this mode/);
    assert.match(textOf(hint), /never changes the mode of an existing game/);

    // ...and the surface that READS the key renders what this row wrote.
    const reopened = new MockElement("div");
    openSettingsMenu({ parent: reopened });
    assert.equal(findBySetting(reopened, "gameMode")?.value, "settlers");
  } finally {
    updateSettings({ gameMode: DEFAULT_GAME_MODE });
  }
});
