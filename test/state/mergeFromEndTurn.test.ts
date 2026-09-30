import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeFromEndTurn } from "../../src/game/turnHooks";
import type { EndTurnResult } from "../../src/io/commands";
import { makeHero, makeSettlement, makeState } from "../charter/_helpers";
import type { GameState, HeroId, SettlementId } from "@heroes/contracts";

function buildResult(state: GameState, overrides: Partial<EndTurnResult> = {}): EndTurnResult {
  return {
    round: 2,
    day: 8,
    activePlayerId: 1,
    players: state.players,
    heroes: { ...state.heroes },
    settlements: { ...state.settlements },
    ...overrides,
  };
}

test("mergeFromEndTurn keeps selections whose entities still exist even when a different player is active (AI hand-off)", () => {
  const state = {
    ...makeState({
      heroes: [makeHero("h0", 0, 2, 2), makeHero("h1", 1, 18, 4)],
      settlements: [makeSettlement("s0", 0, 2, 2), makeSettlement("s1", 1, 18, 4)],
      selectedHeroId: "h0",
      activePlayerId: 1,
    }),
    selectedSettlementId: "s0" as SettlementId | null,
  };

  const merged = mergeFromEndTurn(state, buildResult(state));

  assert.equal(merged.selectedHeroId, "h0", "a surviving hero stays selected even though activePlayerId is another player's seat");
  assert.equal(merged.selectedSettlementId, "s0", "a surviving settlement stays selected through the AI hand-off");
  assert.equal(merged.activePlayerId, 1, "the turn advance itself is unchanged");
});

test("mergeFromEndTurn drops a selection whose entity no longer exists", () => {
  const state = {
    ...makeState({
      heroes: [makeHero("h0", 0, 2, 2), makeHero("h1", 1, 18, 4)],
      settlements: [makeSettlement("s0", 0, 2, 2), makeSettlement("s1", 1, 18, 4)],
      selectedHeroId: "h0",
    }),
    selectedSettlementId: "s0" as SettlementId | null,
  };
  const heroes = { ...state.heroes };
  delete heroes["h0" as HeroId];
  const settlements = { ...state.settlements };
  delete settlements["s0" as SettlementId];

  const merged = mergeFromEndTurn(state, buildResult(state, { heroes, settlements }));

  assert.equal(merged.selectedHeroId, null, "a vanished hero must not stay selected");
  assert.equal(merged.selectedSettlementId, null, "a vanished settlement must not stay selected");
});

test("mergeFromEndTurn keeps a selection whose entity changed owner during the wrap", () => {
  const state = {
    ...makeState({
      heroes: [makeHero("h0", 0, 2, 2), makeHero("h1", 1, 18, 4)],
      settlements: [makeSettlement("s0", 0, 2, 2), makeSettlement("s1", 1, 18, 4)],
      selectedHeroId: "h0",
    }),
    selectedSettlementId: "s0" as SettlementId | null,
  };
  const heroes = { ...state.heroes, h0: makeHero("h0", 1, 2, 2) };
  const settlements = { ...state.settlements, s0: makeSettlement("s0", 1, 2, 2) };

  const merged = mergeFromEndTurn(state, buildResult(state, { heroes, settlements }));

  assert.equal(merged.selectedHeroId, "h0", "a hero that changed owner still exists, so it stays selected");
  assert.equal(merged.selectedSettlementId, "s0", "a captured settlement still exists, so it stays selected and its panel shows the new owner");
});

test("mergeFromEndTurn leaves absent selections as null", () => {
  const state = makeState();
  assert.equal(state.selectedHeroId, null);
  assert.equal(state.selectedSettlementId, null);

  const merged = mergeFromEndTurn(state, buildResult(state));

  assert.equal(merged.selectedHeroId, null);
  assert.equal(merged.selectedSettlementId, null);
});

test("mergeFromEndTurn with a known local seat drops a FOREIGN-seat hero selection", () => {
  const state = {
    ...makeState({
      heroes: [makeHero("h0", 0, 2, 2), makeHero("h1", 1, 18, 4)],
      settlements: [makeSettlement("s0", 0, 2, 2), makeSettlement("s1", 1, 18, 4)],
      selectedHeroId: "h1",
      activePlayerId: 1,
    }),
    selectedSettlementId: "s0" as SettlementId | null,
  };

  const merged = mergeFromEndTurn(state, buildResult(state), 0);

  assert.equal(merged.selectedHeroId, null, "a foreign hero's selection must not survive the merge (it would render its path/trail through fog)");
  assert.equal(merged.selectedSettlementId, "s0", "settlement selections keep the existence-only rule");
});

test("mergeFromEndTurn with a known local seat keeps the viewer's OWN hero selection", () => {
  const state = {
    ...makeState({
      heroes: [makeHero("h0", 0, 2, 2), makeHero("h1", 1, 18, 4)],
      settlements: [makeSettlement("s0", 0, 2, 2), makeSettlement("s1", 1, 18, 4)],
      selectedHeroId: "h0",
      activePlayerId: 1,
    }),
    selectedSettlementId: null as SettlementId | null,
  };

  const merged = mergeFromEndTurn(state, buildResult(state), 0);

  assert.equal(merged.selectedHeroId, "h0");
});

test("mergeFromEndTurn ownership follows the merged hero's owner, not the pre-wrap one", () => {
  const state = {
    ...makeState({
      heroes: [makeHero("h0", 0, 2, 2), makeHero("h1", 1, 18, 4)],
      settlements: [makeSettlement("s0", 0, 2, 2), makeSettlement("s1", 1, 18, 4)],
      selectedHeroId: "h0",
      activePlayerId: 1,
    }),
    selectedSettlementId: null as SettlementId | null,
  };
  const heroes = { ...state.heroes, h0: makeHero("h0", 1, 2, 2) };

  const merged = mergeFromEndTurn(state, buildResult(state, { heroes }), 0);

  assert.equal(merged.selectedHeroId, null, "once the selected hero belongs to another seat it must be dropped for the local viewer");
});
