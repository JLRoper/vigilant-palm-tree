import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { SKYBOX_DEPENDENCY, openSettingsMenu } from "../../../src/screens/home/settingsMenu";
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
  disabled = false;
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

/**
 * The panel is handed a MockElement parent and only ever touches the handful of
 * DOM members the mock carries. That contract is stated once here instead of a
 * cast at every call site -- and it is what the mock is FOR: the panel's own
 * contract, not a real browser.
 */
function mount(parent: MockElement): void {
  openSettingsMenu({ parent: parent as unknown as HTMLElement });
}

beforeEach(() => {
  installDom();
});

afterEach(() => {
  restoreDom();
});

test("settings panel no longer renders build info (moved to the in-game gear menu)", () => {
  const parent = new MockElement("div");
  mount(parent);
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
    mount(parent);
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
  mount(parent);
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
  mount(parent);
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
  mount(parent);
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
    mount(parent);
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
    mount(reopened);
    assert.equal(findBySetting(reopened, "gameMode")?.value, "settlers");
  } finally {
    updateSettings({ gameMode: DEFAULT_GAME_MODE });
  }
});

// ── The four skybox-only rows ───────────────────────────────────────────
//
// The rule these pin is the same one the rows above pin, narrowed to a case
// the dimming hid: a control's STATE and its WORDS must both be true. Four
// persisted keys -- both city view background offsets, the parallax toggle and
// the parallax layer count -- are written by their controls but reach the
// screen only through the watercolour skybox: `paintCitySkybox` returns into
// the diorama painter before it reads any of them, and the DEFAULT backdrop is
// the diorama. So at the default they write a value and change nothing, and
// before this the panel said nothing about it anywhere -- a dimmed slider with
// no words reads as a live control that does nothing.
//
// The rows now carry their dependency in words while it is real, and drop the
// words the moment the skybox makes the row live. The rows are not hidden, no
// setting's behaviour or default changed, and the other fourteen rows must not
// claim a dependency they do not have.

const SKYBOX_ONLY_KEYS: Array<keyof GameSettings> = [
  "cityBgOffsetX",
  "cityBgOffsetY",
  "parallaxEnabled",
  "parallaxLayerCount",
];

/**
 * The other fourteen. Derived by exclusion from the store's own defaults, so a
 * nineteenth key has to be classified here rather than silently passing.
 */
const LIVE_KEYS: Array<keyof GameSettings> = (
  Object.keys(DEFAULT_SETTINGS) as Array<keyof GameSettings>
).filter((key) => !SKYBOX_ONLY_KEYS.includes(key));

function unavailableNotices(root: MockElement): MockElement[] {
  return findAll(root, (el) => el.getAttribute("data-setting-unavailable") !== null);
}

function keysOf(notice: MockElement): string[] {
  return (notice.getAttribute("data-setting-unavailable") ?? "").split(/\s+/);
}

test("the skybox-only rows say why they are dead at the default backdrop", () => {
  const parent = new MockElement("div");
  updateSettings({ ...DEFAULT_SETTINGS });
  try {
    assert.equal(
      settings().cityBackdrop,
      "diorama",
      "the default backdrop is the one the four rows are dead under -- that is the case this test is about",
    );
    mount(parent);

    const notices = unavailableNotices(parent);
    assert.equal(
      notices.length,
      3,
      "the skybox-only rows: two background offsets, plus the parallax row that carries two keys",
    );

    for (const key of SKYBOX_ONLY_KEYS) {
      const spoken = notices.filter((notice) => keysOf(notice).includes(key));
      assert.equal(spoken.length, 1, `${key}: the row must carry a notice naming its dependency`);
      const notice = spoken[0];
      assert.equal(
        textOf(notice),
        SKYBOX_DEPENDENCY,
        `${key}: the notice must state the dependency in words the player reads, not just dim the row`,
      );

      const control = findBySetting(parent, key);
      assert.ok(control, `${key}: no control carries a data-setting hook`);
      let onOwnRow = false;
      for (let node = control.parent; node; node = node.parent) {
        if (node === notice.parent) onOwnRow = true;
      }
      assert.ok(onOwnRow, `${key}: the notice is not on the row that holds the control`);
      assert.equal(
        control.title,
        SKYBOX_DEPENDENCY,
        `${key}: the control must name the dependency too, the way the logistics panel disables and says why`,
      );
    }

    for (const key of LIVE_KEYS) {
      const claimed = notices.filter((notice) => keysOf(notice).includes(key));
      assert.equal(
        claimed.length,
        0,
        `${key}: this row works at the default backdrop, so it must not claim a skybox dependency`,
      );
      assert.equal(
        findBySetting(parent, key)?.title,
        "",
        `${key}: a live row must not carry an unavailable reason`,
      );
    }
  } finally {
    updateSettings({ ...DEFAULT_SETTINGS });
  }
});

test("the skybox-only rows drop the words and go live once the skybox is selected", () => {
  const parent = new MockElement("div");
  updateSettings({ ...DEFAULT_SETTINGS });
  try {
    mount(parent);
    const backdrop = findBySetting(parent, "cityBackdrop");
    assert.ok(backdrop, "the backdrop control the four rows depend on");
    backdrop.value = "skybox";
    backdrop.dispatchEvent("change");

    const notices = unavailableNotices(parent);
    assert.equal(notices.length, 3);
    for (const notice of notices) {
      assert.equal(
        textOf(notice),
        "",
        "the dependency is gone, so the words must go with it -- state and words stay true together",
      );
    }

    for (const key of SKYBOX_ONLY_KEYS) {
      const control = findBySetting(parent, key);
      assert.ok(control, `${key}: no control carries a data-setting hook`);
      assert.equal(control.disabled, false, `${key}: the skybox makes this row live again`);
      assert.equal(control.title, "", `${key}: a live row must not carry an unavailable reason`);
    }

    // ...and the rows still DO what they say: the skybox is the backdrop this
    // change is a truthfulness note about, not a rewrite of how the keys write.
    const bgX = findBySetting(parent, "cityBgOffsetX");
    const bgY = findBySetting(parent, "cityBgOffsetY");
    assert.ok(bgX);
    assert.ok(bgY);
    bgX.value = "40";
    bgX.dispatchEvent("input");
    bgY.value = "-40";
    bgY.dispatchEvent("input");
    assert.equal(settings().cityBgOffsetX, 40);
    assert.equal(settings().cityBgOffsetY, -40);

    const parallax = findBySetting(parent, "parallaxEnabled");
    const layers = findBySetting(parent, "parallaxLayerCount");
    assert.ok(parallax);
    assert.ok(layers);
    parallax.checked = true;
    parallax.dispatchEvent("change");
    layers.value = "3";
    layers.dispatchEvent("input");
    assert.equal(settings().parallaxEnabled, true);
    assert.equal(settings().parallaxLayerCount, 3);
  } finally {
    updateSettings({ ...DEFAULT_SETTINGS });
  }
});
