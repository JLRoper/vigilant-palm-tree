// The toolbar's gear -> "+  New Game" prompt must be the app's own in-page
// dialog, never the native confirm().
//
// Why that is a defect and not a preference (measured in a real browser, tab
// foregrounded, on the tip this branch starts from): the native confirm()
// blocks the renderer thread outright. With the box up,
// `Page.handleJavaScriptDialog` returned {} -- i.e. a dialog really was pending
// -- while every `Runtime.evaluate` ("1+1", `location.href`) timed out after 5s,
// a requestAnimationFrame counter advanced 0 ticks across a 2s window that
// otherwise carried 274, and the very click that opened the box never acked
// (`Input.dispatchMouseEvent` timed out after 5s). Dismissing it unwedged the
// tab in 0.0s. A page that drives its own animation loop must not need a dialog
// handler installed to keep running.
//
// So this pins the toolbar's site: the prompt is a dialog the app owns, the
// native confirm is never called, and cancelling starts nothing.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { installDom, restoreDom, findButton, findAll, settle, MockElement } from "../../helpers/mockDom";
import { panelManagerSizeForTest, resetPanelManagerForTest } from "../../../src/screens/shared/panelManager";
import type { ToolbarState, ToolbarCallbacks } from "../../../src/screens/shared/toolbar";

// The toolbar's import chain reaches src/render/assetDescriptors.ts (via
// newGameModal -> factionChoices), which is Vite-?url/import.meta.glob-coupled.
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

const { Toolbar } = await import("../../../src/screens/shared/toolbar");

const state: ToolbarState = {
  backendOk: () => true,
  hasActiveGame: () => true,
  canEndTurnNow: () => true,
  getCalendar: () => null,
  getSaveStatus: () => "saved",
  getLastSavedAt: () => null,
  getZoom: () => 1,
};

const callbacks: ToolbarCallbacks = {
  onNew: () => {},
  onLoad: async () => {},
  onSave: () => {},
  onEndTurn: async () => {},
};

/** Messages the native confirm() was asked to show. Must stay empty. */
let nativeConfirmMessages: string[] = [];
let body: MockElement;

beforeEach(() => {
  resetPanelManagerForTest();
  nativeConfirmMessages = [];
  // A native confirm() would resolve to this global; it answers "OK" so a
  // regression that still calls it would go on to start the game.
  (globalThis as { confirm?: (m?: string) => boolean }).confirm = (m?: string) => {
    nativeConfirmMessages.push(String(m));
    return true;
  };
  body = installDom().body;
});

afterEach(() => {
  delete (globalThis as { confirm?: unknown }).confirm;
  resetPanelManagerForTest();
  restoreDom();
});

/** The mounted prompt: openDialog's wrapper is the div whose inline style carries the z-index. */
function promptWrappers(): MockElement[] {
  return body.querySelectorAll("div[style*='z-index: 120']");
}

/** Mounts the toolbar and opens the gear's "+  New Game" item. */
function openNewGameMenuItem(): MockElement {
  const parent = new MockElement("div");
  body.appendChild(parent);
  new Toolbar({ parent: parent as unknown as HTMLElement, state, callbacks });

  const gear = findButton(parent, "⚙");
  assert.ok(gear, "the toolbar must render its gear");
  gear.dispatchEvent("click");

  const item = findButton(parent, "+  New Game");
  assert.ok(item, "the gear menu must offer +  New Game");
  item.dispatchEvent("click");
  return parent;
}

test("gear > + New Game: the prompt is an in-page dialog, not a native confirm()", () => {
  openNewGameMenuItem();

  assert.deepEqual(nativeConfirmMessages, [], "the native confirm() must not be used: it blocks the renderer thread");
  assert.equal(promptWrappers().length, 1, "the prompt must be mounted as the app's own dialog");
  assert.equal(panelManagerSizeForTest(), 1, "the prompt registers with panelManager like every other dialog");
  assert.ok(findButton(body, "Cancel"), "the prompt offers Cancel");
  assert.ok(findButton(body, "New Game"), "the prompt offers its confirm action");
  assert.ok(
    findAll(body, (el) => el.textContent.includes("Current game will be lost.")).length > 0,
    "the prompt states what the player loses",
  );
});

test("cancelling the prompt starts nothing: no native confirm, no New Game form", async () => {
  openNewGameMenuItem();

  const cancel = findButton(body, "Cancel");
  assert.ok(cancel, "the prompt offers Cancel");
  cancel.dispatchEvent("click");
  await settle();

  assert.deepEqual(nativeConfirmMessages, []);
  assert.equal(findButton(body, "Create"), null, "cancelling must NOT open the New Game form");
  assert.equal(body.querySelectorAll("div[style*='z-index: 300']").length, 0, "no form dialog may be mounted");
  assert.equal(promptWrappers().length, 0, "the prompt closes itself");
  assert.equal(panelManagerSizeForTest(), 0, "and leaves nothing registered");
});

test("confirming the prompt opens the New Game form", async () => {
  openNewGameMenuItem();

  const go = findButton(body, "New Game");
  assert.ok(go);
  go.dispatchEvent("click");
  await settle();

  assert.deepEqual(nativeConfirmMessages, []);
  assert.ok(findButton(body, "Create"), "confirming must open the New Game form");
  assert.equal(promptWrappers().length, 0, "the prompt closes itself once answered");
  assert.equal(body.querySelectorAll("div[style*='z-index: 300']").length, 1, "the form is the one dialog left up");
});
