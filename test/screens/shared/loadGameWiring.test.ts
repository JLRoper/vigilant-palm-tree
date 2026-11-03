// Copilot's second comment on the landed load path (PR #289, github/main
// 44e0f1d, v0.38.9): the toolbar callback was
//   onLoad: (loaded) => void this.sessions.loadGame(loaded).then(...)
// which returns void, so the modal's `await opts.onLoad(game)` could never
// observe a rejection: a failed load closed the dialog and bypassed the
// retryable Open state in production. The card that landed the modal wrote a
// "failed loads" test that handed the modal a hand-written rejecting handler --
// a path the production wiring cannot reach -- so it proved nothing about
// production.
//
// These tests drive the PRODUCTION chain instead: the callback the engine wires
// (createToolbarLoadCallback, the one GameEngine.initUI hands the toolbar), on
// the REAL Toolbar, opening the REAL Load modal, clicking its own row's Open.
// The property under test is the callback's RETURNED VALUE -- what the modal
// awaits -- not the modal's failure branch on its own.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { registerHooks } from "node:module";
import { installDom, restoreDom, findButton, settle, type MockElement } from "../../helpers/mockDom";
import type { Game } from "../../../src/io/api";
import {
  panelManagerSizeForTest,
  resetPanelManagerForTest,
} from "../../../src/screens/shared/panelManager";
import { createToolbarLoadCallback } from "../../../src/managers/toolbarLoadCallback";

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

const GAME_NAME = "rt2b-contend-30b862";

function gameRow(): Game {
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
  return { ok: true, status: 200, statusText: "OK", json: async () => body };
}

const toolbarState = {
  backendOk: () => true,
  hasActiveGame: () => true,
  canEndTurnNow: () => true,
  getCalendar: () => null,
  getSaveStatus: () => "saved" as const,
  getLastSavedAt: () => null,
  getZoom: () => 1,
};

interface Harness {
  body: MockElement;
  afterLoadCalls: number;
}

/**
 * Mounts the real toolbar wired with the engine's own load callback, then
 * clicks Load (the toolbar's button) and Open (the modal's row button).
 */
async function clickOpen(onLoad: (game: Game) => Promise<void>): Promise<Harness> {
  resetPanelManagerForTest();
  const { body } = installDom({
    storage: {
      "heroesJs.userGames": JSON.stringify({
        version: 1,
        games: [{ id: 7, name: GAME_NAME, lastSeenAt: "2026-10-25T22:42:20.526Z" }],
      }),
    },
    fetchImpl: (url) =>
      url.includes("/games") ? jsonResponse(url.includes(GAME_NAME) ? gameRow() : [gameRow()]) : null,
  });

  new Toolbar({
    parent: body as unknown as HTMLElement,
    state: toolbarState,
    callbacks: {
      onNew: () => {},
      onLoad,
      onSave: () => {},
      onEndTurn: async () => {},
    },
  });

  const loadBtn = findButton(body, "📂 Load");
  assert.ok(loadBtn, "the toolbar must offer its Load button");
  loadBtn.click();
  await settle();
  assert.equal(panelManagerSizeForTest(), 1, "the Load modal is open");

  const open = findButton(body, "Open");
  assert.ok(open, "the row must offer an Open button");
  open.click();
  await settle();

  return { body, afterLoadCalls: 0 };
}

test("a FAILED load through the engine's callback leaves the dialog open and the row retryable", async () => {
  let afterLoad = 0;
  const onLoad = createToolbarLoadCallback({
    loadGame: async () => {
      throw new Error("backend exploded");
    },
    afterLoad: () => {
      afterLoad += 1;
    },
  });

  const h = await clickOpen(onLoad);

  // If the callback swallowed the failure (the pre-fix `void` shape), the modal
  // would have taken the success path and closed: this is the wiring assertion.
  assert.equal(panelManagerSizeForTest(), 1, "a failed load must NOT close the dialog");
  const retry = findButton(h.body, "Open");
  assert.ok(retry, "the row returns to its Open label so the player can retry");
  assert.equal(retry.disabled, false, "and the button is enabled again");
  assert.equal(afterLoad, 0, "the post-load frame work must not run over a failed load");
});

test("a SUCCESSFUL load through the same chain closes the dialog and runs the frame work", async () => {
  let afterLoad = 0;
  const onLoad = createToolbarLoadCallback({
    loadGame: async () => {},
    afterLoad: () => {
      afterLoad += 1;
    },
  });

  await clickOpen(onLoad);

  assert.equal(panelManagerSizeForTest(), 0, "the dialog closes on a successful load");
  assert.equal(afterLoad, 1, "and the post-load frame work runs exactly once");
});

test("the callback RETURNS the promise the engine's load runs on (the value the modal awaits)", async () => {
  let afterLoad = 0;
  const failing = createToolbarLoadCallback({
    loadGame: () => Promise.reject(new Error("nope")),
    afterLoad: () => {
      afterLoad += 1;
    },
  });

  const returned = failing(gameRow());
  assert.ok(returned instanceof Promise, "the callback's returned value must be awaitable");
  await assert.rejects(returned, /nope/, "and it must carry the load's rejection");
  assert.equal(afterLoad, 0);

  const ok = createToolbarLoadCallback({
    loadGame: () => Promise.resolve(),
    afterLoad: () => {
      afterLoad += 1;
    },
  });
  await ok(gameRow());
  assert.equal(afterLoad, 1);
});

test("GameEngine wires the toolbar's onLoad through that same callback", () => {
  // Source-level pin, the shape test/state/bootState.test.ts uses for a
  // GameEngine line only reachable with a DOM: the chain exercised above is the
  // production one only while initUI keeps wiring the promise-returning
  // callback (a `void this.sessions.loadGame(...)` here is the whole defect).
  const source = readFileSync(
    fileURLToPath(new URL("../../../src/managers/GameEngine.ts", import.meta.url)),
    "utf8",
  );
  const start = source.indexOf("private initUI(): void {");
  assert.ok(start > -1, "GameEngine still has an initUI()");
  const end = source.indexOf("private initInput(): void {", start + 1);
  const body = source
    .slice(start, end > -1 ? end : undefined)
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");

  assert.match(body, /onLoad:\s*createToolbarLoadCallback\(/, "onLoad is the engine's own load callback");
  assert.doesNotMatch(
    body,
    /void\s+this\.sessions\.loadGame/,
    "a void load callback cannot be observed by the modal that awaits it",
  );
});

after(() => {
  resetPanelManagerForTest();
  restoreDom();
});
