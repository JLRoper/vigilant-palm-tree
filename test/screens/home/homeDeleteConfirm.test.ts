// The landing page's "Delete" on a saved-game row must prompt with the app's
// own in-page dialog, never the native confirm().
//
// The native confirm() blocks the renderer thread outright (measured in a real
// browser, tab foregrounded: `Page.handleJavaScriptDialog` returned {} while
// every `Runtime.evaluate` timed out after 5s and the rAF counter stood still),
// and a page driving its own animation loop must not need a dialog handler to
// keep running. The same measurement was taken at the toolbar's "+  New Game"
// site; this file pins the LANDING page's delete row, and -- the part a dialog
// rewrite can get wrong -- that the negative path still deletes nothing.
//
// z-index matters here in a way it does not for a prompt raised from the map:
// the row lives inside the Load dialog (300), which is itself above the home
// overlay (200), so the prompt has to clear both or it is a prompt the player
// can see but not click.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { installDom, restoreDom, findButton, findAll, textOf, settle, type MockElement } from "../../helpers/mockDom";
import { panelManagerSizeForTest, resetPanelManagerForTest } from "../../../src/screens/shared/panelManager";
import type { Game } from "../../../src/io/api";
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

const SEEN = "2026-10-25T22:42:20.526Z";
const GAME_NAME = "rt3a-delete-me-30b862";

/** Messages the native confirm() was asked to show. Must stay empty. */
let nativeConfirmMessages: string[] = [];

function serverRow(): Game {
  return {
    id: 7,
    name: GAME_NAME,
    seed: 51847157,
    hero_q: 12,
    hero_r: 7,
    gold: 2485,
    enemy_positions: [],
    created_at: "2026-10-25T20:00:00Z",
    updated_at: "2026-10-25T22:42:20Z",
    round: 4,
    day: 4,
    active_player_id: 0,
    players: [],
    heroes: {},
    settlements: {},
  };
}

function jsonResponse(body: unknown): unknown {
  return { ok: true, status: 200, statusText: "OK", json: async () => body, text: async () => "" };
}

interface Harness {
  body: MockElement;
  /** Every request the landing page made, in order. */
  calls: Array<{ method: string; url: string }>;
  /** The rows whose text carries the saved game's name. */
  rowsWithGame: () => MockElement[];
  /** The cached game list, as the landing page's own cache stores it. */
  cachedGames: () => Array<{ id: number; name: string }>;
}

/** Boots the landing page with one cached game and opens its Load list. */
async function openLandingLoadList(): Promise<Harness> {
  resetPanelManagerForTest();
  nativeConfirmMessages = [];
  (globalThis as { confirm?: (m?: string) => boolean }).confirm = (m?: string) => {
    nativeConfirmMessages.push(String(m));
    return true;
  };
  const calls: Array<{ method: string; url: string }> = [];
  const { body } = installDom({
    storage: {
      "heroesJs.userGames": JSON.stringify({
        version: 1,
        games: [{ id: 7, name: GAME_NAME, lastSeenAt: SEEN }],
      }),
    },
    fetchImpl: (url, init) => {
      const method = init?.method ?? "GET";
      calls.push({ method, url: String(url) });
      if (method === "DELETE") return { ok: true, status: 204, statusText: "No Content", json: async () => ({}), text: async () => "" };
      if (String(url).includes("/games")) return jsonResponse([serverRow()]);
      return null;
    },
  });
  const { createHomeView } = await import("../../../src/screens/home/homeView");
  const view: HomeView = createHomeView({
    onEnterGame: () => {},
    onNewGame: async () => {},
    onLoadGame: async () => {},
    isBackendOk: () => true,
  });
  const loadBtn = findButton(view.root as unknown as MockElement, "Load Game");
  assert.ok(loadBtn, "the landing page must offer a Load Game button");
  loadBtn.click();
  await settle();
  const rowsWithGame = (): MockElement[] => findAll(body, (el) => textOf(el).includes(GAME_NAME));
  return {
    body,
    calls,
    rowsWithGame,
    cachedGames: () =>
      (JSON.parse(localStorage.getItem("heroesJs.userGames") ?? "{}") as { games?: Array<{ id: number; name: string }> }).games ?? [],
  };
}

/** The prompt raised from the delete row: the wrapper's inline style carries its z-index. */
function promptWrappers(body: MockElement): MockElement[] {
  return body.querySelectorAll("div[style*='z-index: 320']");
}

test("delete row: the prompt is an in-page dialog over the Load dialog, not a native confirm()", async () => {
  const h = await openLandingLoadList();
  const del = findButton(h.body, "Delete");
  assert.ok(del, "the landing row must carry a Delete action");
  del.click();

  assert.deepEqual(nativeConfirmMessages, [], "the native confirm() must not be used: it blocks the renderer thread");
  assert.equal(promptWrappers(h.body).length, 1, "the prompt must be mounted");
  // The row sits inside the Load dialog at 300; a prompt at or below that is
  // behind the very dialog that raised it and cannot be clicked.
  const loadDialogs = h.body.querySelectorAll("div[style*='z-index: 300']");
  assert.equal(loadDialogs.length, 1, "the Load dialog is still mounted behind the prompt");
  assert.equal(panelManagerSizeForTest(), 2, "the prompt registers beside the Load dialog");
  assert.ok(findButton(promptWrappers(h.body)[0], "Cancel"), "the prompt offers Cancel");
  assert.ok(findButton(promptWrappers(h.body)[0], "Delete"), "the prompt offers its confirm action");
  assert.ok(
    findAll(h.body, (el) => el.textContent.includes(`Delete saved game "${GAME_NAME}"? This cannot be undone.`)).length > 0,
    "the prompt states exactly what is being deleted",
  );
});

test("cancelling leaves the save alone: no DELETE, the row and the cache survive", async () => {
  const h = await openLandingLoadList();
  const del = findButton(h.body, "Delete");
  assert.ok(del);
  del.click();

  const cancel = findButton(promptWrappers(h.body)[0], "Cancel");
  assert.ok(cancel, "the prompt offers Cancel");
  cancel.click();
  await settle();

  assert.deepEqual(nativeConfirmMessages, []);
  assert.deepEqual(
    h.calls.filter((c) => c.method === "DELETE"),
    [],
    "cancelling must send no DELETE: deleting on the negative path is data loss",
  );
  assert.equal(h.rowsWithGame().length > 0, true, "the row must still be on screen");
  assert.deepEqual(
    h.cachedGames().map((g) => g.name),
    [GAME_NAME],
    "the landing cache must still hold the game",
  );
  assert.equal(promptWrappers(h.body).length, 0, "the prompt closes itself");
  assert.equal(panelManagerSizeForTest(), 1, "the Load dialog stays open");
});

test("confirming deletes exactly that game and drops its row", async () => {
  const h = await openLandingLoadList();
  const del = findButton(h.body, "Delete");
  assert.ok(del);
  del.click();

  const go = findButton(promptWrappers(h.body)[0], "Delete");
  assert.ok(go);
  go.click();
  await settle();

  assert.deepEqual(nativeConfirmMessages, []);
  const deletes = h.calls.filter((c) => c.method === "DELETE");
  assert.equal(deletes.length, 1, "confirming sends exactly one DELETE");
  assert.match(deletes[0].url, new RegExp(`${GAME_NAME}$`), "and it names the game the prompt showed");
  assert.equal(h.rowsWithGame().length, 0, "the row is gone");
  assert.deepEqual(h.cachedGames(), [], "and the landing cache no longer holds it");
  assert.equal(promptWrappers(h.body).length, 0, "the prompt closes itself once answered");
});

after(() => {
  delete (globalThis as { confirm?: unknown }).confirm;
  resetPanelManagerForTest();
  restoreDom();
});
