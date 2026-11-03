// The landing page's "Multiplayer" button must tell the player the API is
// offline through the app's own in-page dialog, never the native alert().
//
// A native alert() blocks the renderer thread outright, exactly like its
// confirm() sibling (measured in a real browser, tab foregrounded,
// `document.hidden === false`): the click never returned
// (`Input.dispatchMouseEvent` timed out at 5s, because the box opens inside
// the handler), every `Runtime.evaluate` -- `1+1`, `location.href`, even
// reading a counter -- timed out at 5s, and `Page.handleJavaScriptDialog`
// answered `{}` (an empty object: a dialog really was pending), which
// unwedged the tab instantly. Across that window the animation loop stood
// still for 10 026 ms between two frames 9 ms apart (481 ticks landed in 2.0s
// either side of it). A page driving its own animation loop must not need a
// dialog handler to keep running.
//
// z-index matters here in the same way it does at the two home-screen
// confirm() sites: the button sits on the landing overlay itself (200), so a
// notice drawn at the helper's default (120) is one the player can see but
// not click.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { installDom, restoreDom, findButton, findAll, textOf, settle, type MockElement } from "../../helpers/mockDom";
import { panelManagerSizeForTest, resetPanelManagerForTest } from "../../../src/screens/shared/panelManager";
import type { HomeView } from "../../../src/screens/home/homeView";

// homeView's import chain reaches src/render/assetDescriptors.ts (via
// newGameScreen -> factionChoices), which is Vite-?url/import.meta.glob-coupled.
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

/** The notice's own words -- homeView.ts's string, verbatim. */
const NOTICE = "Backend offline. Multiplayer requires the API.";
/** The landing overlay's z-index (homeView.ts); the notice has to clear it. */
const HOME_OVERLAY_Z = 200;

/** Messages the native alert() was asked to show. Must stay empty. */
let nativeAlertMessages: string[] = [];

function jsonResponse(body: unknown): unknown {
  return { ok: true, status: 200, statusText: "OK", json: async () => body, text: async () => "" };
}

interface Harness {
  body: MockElement;
  view: HomeView;
  /** Flip what `isBackendOk()` answers, i.e. the API coming back. */
  setBackendOk: (value: boolean) => void;
  multiplayerBtn: () => MockElement;
}

/** Boots the landing page with the backend OFFLINE and no saved games. */
async function bootLanding(): Promise<Harness> {
  resetPanelManagerForTest();
  nativeAlertMessages = [];
  (globalThis as { alert?: (m?: string) => void }).alert = (m?: string) => {
    nativeAlertMessages.push(String(m));
  };
  let backendOk = false;
  const { body } = installDom({
    fetchImpl: (url) => {
      if (String(url).includes("/games")) return jsonResponse([]);
      return null;
    },
  });
  const { createHomeView } = await import("../../../src/screens/home/homeView");
  const view = createHomeView({
    onEnterGame: () => {},
    onNewGame: async () => {},
    onLoadGame: async () => {},
    isBackendOk: () => backendOk,
  });
  const multiplayerBtn = (): MockElement => {
    const btn = findButton(view.root as unknown as MockElement, "Multiplayer");
    assert.ok(btn, "the landing page must offer a Multiplayer button");
    return btn;
  };
  return { body, view, setBackendOk: (v) => (backendOk = v), multiplayerBtn };
}

/** The notice raised from the Multiplayer button: its wrapper carries the z-index. */
function noticeWrappers(body: MockElement): MockElement[] {
  return body.querySelectorAll(`div[style*='z-index: ${HOME_OVERLAY_Z + 20}']`);
}

/** Any dialog layer at the helper's default z-index (120) -- the trap this guards. */
function defaultLayerDialogs(body: MockElement): MockElement[] {
  return body.querySelectorAll("div[style*='z-index: 120']");
}

test("offline Multiplayer: the notice is an in-page dialog above the landing overlay, not a native alert()", async () => {
  const h = await bootLanding();
  assert.equal(h.view.root.style.zIndex, String(HOME_OVERLAY_Z), "the landing overlay is the surface that raises the notice");
  h.multiplayerBtn().click();
  await settle();

  assert.deepEqual(nativeAlertMessages, [], "the native alert() must not be used: it blocks the renderer thread outright");
  assert.equal(noticeWrappers(h.body).length, 1, "exactly one notice is mounted");
  assert.equal(
    defaultLayerDialogs(h.body).length,
    0,
    "and not at the helper's default 120, which sits UNDER the landing overlay (200): visible but unclickable",
  );
  // The words still reach the player -- the fix moves the surface, not the message.
  assert.ok(
    findAll(h.body, (el) => textOf(el).includes(NOTICE)).length > 0,
    "the notice still states why multiplayer is unavailable",
  );
  const notice = noticeWrappers(h.body)[0];
  assert.ok(findButton(notice, "OK"), "the notice offers an acknowledge action");
  assert.ok(findButton(notice, "Close"), "and a dismissive one: it is a notice, not a question");
  assert.equal(panelManagerSizeForTest(), 1, "the notice registers as the only panel");
});

test("offline Multiplayer: the notice is not a substitute for the guard -- no lobby is opened", async () => {
  const h = await bootLanding();
  h.multiplayerBtn().click();
  await settle();

  assert.deepEqual(nativeAlertMessages, []);
  assert.equal(
    findAll(h.body, (el) => textOf(el).includes("Multiplayer Lobby")).length,
    0,
    "offline must not enter the lobby: the backend is what serves it",
  );
  assert.equal(panelManagerSizeForTest(), 1, "only the notice, never the lobby dialog beside it");
});

test("the same click path resumes: dismissing the notice leaves multiplayer working", async () => {
  const h = await bootLanding();
  h.multiplayerBtn().click();
  await settle();

  const close = findButton(noticeWrappers(h.body)[0], "Close");
  assert.ok(close, "the notice offers Close");
  close.click();
  await settle();

  assert.deepEqual(nativeAlertMessages, []);
  assert.equal(noticeWrappers(h.body).length, 0, "the notice closes itself");
  assert.equal(panelManagerSizeForTest(), 0, "and unregisters: the click left no stuck state behind");

  // Same button, same handler, the API back up.
  h.setBackendOk(true);
  h.multiplayerBtn().click();
  await settle();

  assert.deepEqual(nativeAlertMessages, [], "still no native alert() on the resume path");
  assert.ok(
    findAll(h.body, (el) => textOf(el).includes("Multiplayer Lobby")).length > 0,
    "with the backend up the same handler opens the lobby",
  );
  assert.equal(noticeWrappers(h.body).length, 0, "and raises no notice");
});

after(() => {
  delete (globalThis as { alert?: unknown }).alert;
  resetPanelManagerForTest();
  restoreDom();
});
