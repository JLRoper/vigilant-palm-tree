// C-POLISH-1: the Load Game row's progress line.
//
// The row read `games.turn`, a column written once when the game is created
// and never advanced by End Turn -- so a game on round 37 advertised itself as
// "turn 1" and the player had no way to tell a long-running save from a fresh
// one. The line now reads the round, the counter the HUD's Round pill and the
// End Turn cycle actually move.
//
// The line is a pure function of the server row, so it is asserted directly
// (the same seam style as settlementInfoMenu's rows): a fixture with a stale
// `turn` and a live `round` is the whole defect.

import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import type { Game } from "../../../src/io/api";

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

const { loadRowProgress } = await import("../../../src/screens/shared/loadGameModal");

const SEEN = "2026-10-25T22:42:20.526Z";

/** A server row as GET /api/games returns it: `turn` frozen at creation, round/day live. */
function serverRow(over: Partial<Game> = {}): Game {
  return {
    id: 7,
    name: "pt-classic-city-515690",
    seed: 515690,
    hero_q: 12,
    hero_r: 7,
    turn: 1,
    gold: 5500,
    enemy_positions: [],
    created_at: "2026-09-18T00:00:00Z",
    updated_at: "2026-10-25T22:42:20Z",
    round: 37,
    day: 4,
    active_player_id: 0,
    players: [],
    heroes: {},
    settlements: {},
    ...over,
  };
}

test("load row: the progress line reads the round, not the frozen turn column", () => {
  const row = serverRow();
  const line = loadRowProgress(row, SEEN);
  assert.equal(line, `round 37 · 5500g · seen ${new Date(SEEN).toLocaleString()}`);
  assert.doesNotMatch(line, /turn 1/, "the row must not advertise the game as turn 1 on round 37");
});

test("load row: a round-1 game still reads as its own round", () => {
  const line = loadRowProgress(serverRow({ round: 1, day: 1, gold: 0 }), SEEN);
  assert.equal(line, `round 1 · 0g · seen ${new Date(SEEN).toLocaleString()}`);
});

test("load row: the stale turn column cannot leak into the line, whatever it holds", () => {
  const line = loadRowProgress(serverRow({ turn: 99, round: 12 }), SEEN);
  assert.match(line, /^round 12 · /);
  assert.doesNotMatch(line, /99/, "the turn column is not the row's progress");
});
