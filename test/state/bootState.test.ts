import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { emptyGameState } from "@heroes/engine";

// C-POLISH-2: after F5 (a page load with no game opened) the client used to show
// a LOCALLY GENERATED world -- day 1, three seats, five named settlements and
// three heroes -- that matched no database row, while activeGameName was null and
// no /api/games request had been made. The boot state is empty now, and the load
// paths replace it wholesale.

test("emptyGameState is a world with no entities: no players, heroes or settlements (C-POLISH-2)", () => {
  const state = emptyGameState();

  assert.deepEqual(state.players, [], "no seats are fabricated at boot");
  assert.deepEqual(state.heroes, {}, "no heroes are fabricated at boot");
  assert.deepEqual(state.settlements, {}, "no settlements are fabricated at boot");
  assert.deepEqual(state.activeCharters, []);
  assert.deepEqual(state.tradeRoutes, []);

  // The parts every surface reads stay valid: the calendar/round and a phase the
  // client can sit in without a game.
  assert.equal(state.day, 1);
  assert.equal(state.round, 1);
  assert.equal(state.activePlayerId, 0);
  assert.deepEqual(state.phase, { kind: "PLAYER_TURN", playerId: 0 });
  assert.equal(state.selectedHeroId, null);
  assert.equal(state.selectedSettlementId, null);
});

test("the client's boot state comes from emptyGameState, not a locally generated world (C-POLISH-2)", async () => {
  // Source-level pin, same shape as test/state/turnController.test.ts's coverage
  // guard: GameEngine's private initGameState() is only reachable with a DOM, so
  // the regression to catch is the call, not a rendered result.
  const source = readFileSync(
    fileURLToPath(new URL("../../src/managers/GameEngine.ts", import.meta.url)),
    "utf8",
  );
  const start = source.indexOf("private initGameState(): void {");
  assert.ok(start > -1, "GameEngine still has an initGameState()");
  const end = source.indexOf("private init", start + 1);
  const raw = source.slice(start, end > -1 ? end : undefined);
  // Strip comments first: the fix's own rationale names the old call.
  const body = raw
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");

  assert.match(body, /emptyGameState\(\)/, "the boot state is the empty one");
  assert.doesNotMatch(
    body,
    /buildInitialGameState\s*\(|makeInitialStatePayload\s*\(/,
    "booting must not fabricate a local world (C-POLISH-2)",
  );
});
