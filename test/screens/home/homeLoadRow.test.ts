// F4 (playthrough round 2b): the LANDING page's own Load list rendered
// `turn ${server.turn}` while the in-game Load modal rendered `round ${server.round}`.
// `games.turn` was a column written once at INSERT (DEFAULT 1) and never advanced
// -- measured on the shared database: every row had turn = 1 while `round` ran
// from 1 to 1996 -- so the landing list advertised a round-4 save as "turn 1"
// and the two surfaces disagreed about which save was which. (The column itself
// is gone: server/migrations/036_drop_games_turn.sql.)
//
// The fix routes the landing row through the SAME `loadRowProgress` helper the
// in-game modal uses, so the two cannot drift again. This test drives the real
// landing screen (createHomeView -> the "Load Game" button -> the rendered row)
// and reads the progress line off the DOM the player sees; it fails on the old
// `turn ${entry.server.turn}` line and on any later edit that re-introduces it.
//
// The in-game row's own file (test/screens/shared/loadGameRow.test.ts) pins the
// helper; this one pins the LANDING surface's use of it.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { installDom, restoreDom, findAll, findButton, textOf, settle, type MockElement } from "../../helpers/mockDom";
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
const GAME_NAME = "rt2b-contend-30b862";

/** The server row as GET /api/games returns it: `turn` frozen at creation, round/day live. */
function serverRow(over: Partial<Game> = {}): Game {
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
    ...over,
  };
}

function jsonResponse(body: unknown): unknown {
  return { ok: true, status: 200, statusText: "OK", json: async () => body };
}

/** Boots the landing page with one cached game, opens its Load list, clicks Open. */
async function openLandingLoadList(row: Game): Promise<MockElement> {
  const { body } = installDom({
    storage: {
      "heroesJs.userGames": JSON.stringify({
        version: 1,
        games: [{ id: row.id, name: row.name, lastSeenAt: SEEN }],
      }),
    },
    fetchImpl: (url) => (url.includes("/games") ? jsonResponse([row]) : null),
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
  return body;
}

/**
 * Boots the landing page with one cached game, opens its Load list and clicks
 * that row's Open. `listRow` answers GET /games (the list route), `detailRow`
 * answers GET /games/<name> (the game's own row) -- the two routes really do
 * return different payloads, and this is the seam under test.
 */
async function clickLandingOpen(
  listRow: Game,
  detailRow: Game,
): Promise<{ loaded: Game[]; detailFetches: string[] }> {
  const loaded: Game[] = [];
  const detailFetches: string[] = [];
  const { body } = installDom({
    storage: {
      "heroesJs.userGames": JSON.stringify({
        version: 1,
        games: [{ id: listRow.id, name: listRow.name, lastSeenAt: SEEN }],
      }),
    },
    fetchImpl: (url) => {
      if (/\/games\/[^/]+$/.test(url)) {
        detailFetches.push(url);
        return jsonResponse(detailRow);
      }
      return url.includes("/games") ? jsonResponse([listRow]) : null;
    },
  });
  const { createHomeView } = await import("../../../src/screens/home/homeView");
  const view: HomeView = createHomeView({
    onEnterGame: () => {},
    onNewGame: async () => {},
    onLoadGame: async (game) => {
      loaded.push(game);
    },
    isBackendOk: () => true,
  });
  const loadBtn = findButton(view.root as unknown as MockElement, "Load Game");
  assert.ok(loadBtn, "the landing page must offer a Load Game button");
  loadBtn.click();
  await settle();
  const open = findButton(body, "Open");
  assert.ok(open, "the landing row must offer Open");
  open.click();
  await settle();
  await settle();
  return { loaded, detailFetches };
}

test("landing load row: the progress line reads the round, not the frozen turn column", async () => {
  const body = await openLandingLoadList(serverRow());
  const metas = findAll(body, (el) => / · \d+g · seen /.test(el.textContent));
  assert.equal(metas.length, 1, "exactly one Load row must have rendered");
  const line = metas[0].textContent;
  assert.match(line, /^round 4 · 2485g · seen /, `landing row read "${line}"`);
  assert.doesNotMatch(line, /turn 1/, "the landing row must not advertise a round-4 game as turn 1");
});

test("landing load row: the round line matches what the in-game Load modal renders", async () => {
  const row = serverRow({ round: 12, day: 7, gold: 995 });
  const body = await openLandingLoadList(row);
  const metas = findAll(body, (el) => / · \d+g · seen /.test(el.textContent));
  const { loadRowProgress } = await import("../../../src/screens/shared/loadGameModal");
  assert.equal(
    metas[0].textContent,
    loadRowProgress(row, SEEN),
    "the landing list and the in-game list must render the same progress line",
  );
});

test("landing load row: the measured surface is the landing list (Delete), not the in-game one (Forget)", async () => {
  const body = await openLandingLoadList(serverRow());
  assert.ok(findButton(body, "Delete"), "the landing row carries the Delete action");
  assert.equal(findButton(body, "Forget"), null, "the in-game row's Forget action must not be on this surface");
  const row = findAll(body, (el) => textOf(el).includes(GAME_NAME))[0];
  assert.ok(row, "the row's name must be on screen");
});

// BLOCKER-B of the classic second pass: the landing page's Load Game dropped
// in-flight charters and unlocked the chartering hero. The row the list
// rendered comes from `GET /games`, which selects the games table and nothing
// joined to it -- no `charters` (see the Game.charters doc in src/io/api.ts).
// Handing that row straight to the load path hydrated `activeCharters: []`
// while `heroes.<id>.isChartering` survived, and hydrateGameState's
// unlockOrphanedCharteringHeroes cleared the flag, so the `traveling` row was
// left with nothing that would ever advance it (the server's own day-tick
// travel pass is skipped for a game with no trade routes). The in-game Load
// modal never had the bug: it fetches the game's own row first
// (src/screens/shared/loadGameModal.ts). Open must do the same.
test("landing load row: Open loads the game's own row, so an in-flight charter is not dropped", async () => {
  const charter = {
    id: "ch0",
    heroId: "p0-hero",
    ownerId: 0,
    targetQ: 7,
    targetR: 7,
    settlementName: "Storm hollow",
    phase: "traveling" as const,
    daysRemaining: 10,
    settlementId: "s4",
    resourceRates: { wood: 15 },
    foundedOnResource: null,
    citySpots: [],
  };
  // The list route's row: exactly the shape GET /games returns, and it carries
  // no `charters` key at all.
  const listRow = serverRow();
  assert.equal(
    Object.prototype.hasOwnProperty.call(listRow, "charters"),
    false,
    "fixture check: the list route's row must not carry charters, or this test proves nothing",
  );
  const detailRow = serverRow({ charters: [charter] });

  const { loaded, detailFetches } = await clickLandingOpen(listRow, detailRow);

  assert.equal(loaded.length, 1, "Open must hand exactly one game to the load path");
  assert.equal(
    detailFetches.length,
    1,
    "Open must read the game's own row (GET /games/<name>); reusing the list row is the defect",
  );
  assert.deepEqual(
    loaded[0].charters,
    [charter],
    "the loaded game must carry the in-flight charter, or hydration drops it and unlocks the hero",
  );
});

// Leave the globals as they were: node:test runs every file in one process.
after(() => restoreDom());
