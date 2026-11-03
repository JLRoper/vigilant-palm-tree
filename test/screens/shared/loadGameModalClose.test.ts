// F5 (playthrough round 2b): the in-game Load modal never closed after a
// successful Open. The game loaded behind it, the row stayed on "Loading…",
// and the dialog's fullscreen backdrop kept swallowing every later click on
// the map.
//
// Cause (measured, then fixed): the teardown was
// `document.body.querySelectorAll("div[style*='z-index: 100']")` -- the battle
// arena's layer -- while `openDialog` mounts its wrapper at z-index 300. The
// selector matched NOTHING, so the panel was never closed at all: its wrapper
// stayed in the DOM (the stuck overlay, and the reason the next click did not
// land) and it stayed registered in panelManager (the phantom modal).
//
// The POST-CLOSE state is the point, because that is where a naive fix goes
// wrong: re-pointing the selector at 300 and calling `el.remove()` clears the
// overlay but leaves the panel registered, so Escape and hasOpenPanels() still
// act on a detached surface. Both halves are asserted — no wrapper left in the
// document AND panelManager back to empty — plus a second open/close cycle
// proving the surface is still usable, and the failure path (a failed load
// must leave the dialog up with a retryable row).
//
// The failure path now fails through the callback the ENGINE wires
// (createToolbarLoadCallback) rather than a hand-written rejecting handler:
// the previous version handed the modal a callback production never builds, so
// it asserted a path the production wiring could not reach. Copilot's second
// comment on PR #289 named exactly that, and loadGameWiring.test.ts drives the
// same property through the real toolbar.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { installDom, restoreDom, findButton, settle, type MockElement } from "../../helpers/mockDom";
import type { Game } from "../../../src/io/api";
import { createToolbarLoadCallback } from "../../../src/managers/toolbarLoadCallback";
import {
  escapeTarget,
  hasOpenPanels,
  panelManagerSizeForTest,
  resetPanelManagerForTest,
} from "../../../src/screens/shared/panelManager";

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
const GAME_NAME = "rt2b-contend-30b862";

function gameRow(): Game {
  return {
    id: 7,
    name: GAME_NAME,
    seed: 51847157,
    hero_q: 12,
    hero_r: 7,
    turn: 1,
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
  return { ok: true, status: 200, statusText: "OK", json: async () => body };
}

/** The mounted dialogs: openDialog's wrapper is the div whose inline style carries z-index 300. */
function dialogWrappers(body: MockElement): MockElement[] {
  return body.querySelectorAll("div[style*='z-index: 300']");
}

interface Harness {
  body: MockElement;
  /** Game names a successful Open handed to onLoad. */
  opened: string[];
  /** Opens the Load modal; `onLoad` is the toolbar's load callback (throw to fail it). */
  openLoad: (onLoad?: (game: Game) => Promise<void>) => Promise<void>;
}

async function setup(): Promise<Harness> {
  resetPanelManagerForTest();
  const { body } = installDom({
    storage: {
      "heroesJs.userGames": JSON.stringify({
        version: 1,
        games: [{ id: 7, name: GAME_NAME, lastSeenAt: SEEN }],
      }),
    },
    fetchImpl: (url) => (url.includes("/games") ? jsonResponse(url.includes(GAME_NAME) ? gameRow() : [gameRow()]) : null),
  });
  const { openLoadGameModal } = await import("../../../src/screens/shared/loadGameModal");
  const opened: string[] = [];
  const openLoad = async (onLoad?: (game: Game) => Promise<void>): Promise<void> => {
    await openLoadGameModal({
      backendOk: () => true,
      onLoad: async (game) => {
        opened.push(game.name);
        if (onLoad) await onLoad(game);
      },
    });
  };
  return { body, opened, openLoad };
}

test("a successful Open closes the dialog AND empties panelManager", async () => {
  const h = await setup();
  await h.openLoad();

  assert.equal(panelManagerSizeForTest(), 1, "the Load dialog is open");
  assert.equal(dialogWrappers(h.body).length, 1, "one dialog wrapper is mounted");

  const open = findButton(h.body, "Open");
  assert.ok(open, "the row must offer an Open button");
  open.click();
  await settle();

  assert.deepEqual(h.opened, [GAME_NAME], "the Open actually loaded the game");
  // Half one: the overlay must be detached, or the loaded map is unclickable.
  assert.equal(dialogWrappers(h.body).length, 0, "no stuck overlay may be left over the loaded game");
  assert.equal(h.body.querySelector("[data-modal]"), null, "no modal marker may be left behind");
  // Half two: the panel must be gone from the REGISTRY, not merely detached
  // DOM -- this is what a naive `el.remove()` fix leaves behind.
  assert.equal(panelManagerSizeForTest(), 0, "no phantom panel may stay registered");
  assert.equal(hasOpenPanels(), false, "panelManager must report no open panels");
  assert.equal(escapeTarget(), null, "Escape must not target a detached panel");
});

test("after a successful Open the Load surface still works (the next click lands)", async () => {
  const h = await setup();

  await h.openLoad();
  findButton(h.body, "Open")?.click();
  await settle();
  assert.equal(panelManagerSizeForTest(), 0, "closed after the first load");

  // The click that used to land on the leftover backdrop: re-open the same
  // surface and close it through its own button.
  await h.openLoad();
  assert.equal(panelManagerSizeForTest(), 1, "the second open registers exactly one panel");
  assert.equal(dialogWrappers(h.body).length, 1, "and mounts exactly one wrapper");

  const close = findButton(h.body, "Close");
  assert.ok(close, "the dialog offers a Close button");
  close.click();
  await settle();
  assert.equal(panelManagerSizeForTest(), 0, "Close still tears the panel down");
  assert.equal(dialogWrappers(h.body).length, 0, "and removes the overlay");
});

test("a FAILED Open leaves the dialog open and the row retryable", async () => {
  const h = await setup();
  // The engine's own callback, over a load that rejects: this is the value the
  // modal awaits in production.
  await h.openLoad(
    createToolbarLoadCallback({
      loadGame: async () => {
        throw new Error("backend exploded");
      },
      afterLoad: () => {},
    }),
  );

  const open = findButton(h.body, "Open");
  assert.ok(open);
  open.click();
  await settle();

  assert.equal(panelManagerSizeForTest(), 1, "a failed load must NOT close the dialog");
  const retry = findButton(h.body, "Open");
  assert.ok(retry, "the row returns to its Open label so the player can retry");
  assert.equal(retry.disabled, false, "and the button is enabled again");
  assert.equal(dialogWrappers(h.body).length, 1, "the dialog the player is looking at stays mounted");
});

after(() => {
  resetPanelManagerForTest();
  restoreDom();
});
