import { test } from "node:test";
import assert from "node:assert/strict";
import type { GameState } from "../../../src/state/gameState";
import { Hero } from "../../../src/entities/hero";
import { GameMap, type TileRow } from "../../../src/map/gameMap";
import { describeTile } from "../../../src/screens/adventure/tileInfo";
import { tilePanelLines, tilePanelTitle, type TilePanelLine } from "../../../src/screens/adventure/tileInfoPanel";

// The tile panel's player-visible text, pinned exactly. Two playthrough
// findings live here (CONSOLIDATED-playthrough-findings.md, M-MINOR-1 and
// M-MINOR-2): the panel an unrevealed hex is inspected with must read
// "Unexplored" and nothing else (the locked fog decision, docs/map.md), and the
// panel for the hex a hero has just moved onto must show that hex's terrain.
// The strings are read from the same model the panel renders (tilePanelLines /
// tilePanelTitle), so an edit that changes what the player reads fails here.

function makeGrassMap(width: number, height: number, resources: Array<{ q: number; r: number; resource: string }> = []): GameMap {
  const resourceAt = new Map(resources.map((r) => [`${r.q},${r.r}`, r.resource]));
  const rows: TileRow[] = [];
  for (let r = 0; r < height; r++) {
    for (let q = 0; q < width; q++) {
      rows.push({ q, r, terrain: "grass", resource: resourceAt.get(`${q},${r}`) ?? null });
    }
  }
  return GameMap.fromTiles(rows);
}

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    round: 1,
    day: 1,
    activePlayerId: 0,
    players: [
      { id: 0, faction: "player", name: "Player 1", color: "#d62828", heroIds: [], settlementIds: [] },
      { id: 1, faction: "ai", name: "AI", color: "#1d7dd1", heroIds: [], settlementIds: [] },
    ],
    heroes: {},
    settlements: {},
    phase: { kind: "PLAYER_TURN", playerId: 0 },
    selectedHeroId: null,
    selectedSettlementId: null,
    dirty: false,
    castleSeed: 0,
    castleCount: 0,
    activeCharters: [],
    nextCharterId: 0,
    nextSettlementId: 0,
    ...overrides,
  };
}

function makeCommander(q: number, r: number, movementRemaining = 7): Hero {
  return new Hero("p0-hero", "Commander", q, r, "player", 0, movementRemaining, undefined, 300, 24, [
    { entries: [{ count: 24, unitTypeId: "swordsman" }] },
  ]);
}

function panelText(info: NonNullable<ReturnType<typeof describeTile>>): string[] {
  return [tilePanelTitle(info), ...tilePanelLines(info).map((line: TilePanelLine) => line.text)];
}

test("M-MINOR-1: the panel for an unrevealed hex reads its coordinates and exactly \"Unexplored\"", () => {
  const map = makeGrassMap(12, 1);
  const hero = makeCommander(0, 0);
  const info = describeTile({
    map,
    state: makeState(),
    heroes: [hero],
    castles: [],
    viewPlayerId: 0,
    tile: { q: 9, r: 0 },
  });

  assert.ok(info);
  assert.equal(info!.fogged, true, "(9,0) is 9 hexes from the hero, well outside vision");
  assert.deepEqual(panelText(info!), ["Tile 9, 0", "Unexplored"]);
  assert.deepEqual(
    tilePanelLines(info!),
    [{ text: "Unexplored", dim: true }],
    "an unexplored hex reveals nothing but the word: no terrain, cost or world lines",
  );
});

test("M-MINOR-2: after the hero lands on it, the same hex's panel leads with its terrain and move cost", () => {
  const map = makeGrassMap(12, 1);
  const before = describeTile({
    map,
    state: makeState(),
    heroes: [makeCommander(0, 0)],
    castles: [],
    viewPlayerId: 0,
    tile: { q: 9, r: 0 },
  });
  assert.deepEqual(panelText(before!), ["Tile 9, 0", "Unexplored"]);

  const hero = makeCommander(9, 0, 6);
  const after = describeTile({
    map,
    state: makeState({ selectedHeroId: hero.id }),
    heroes: [hero],
    castles: [],
    viewPlayerId: 0,
    tile: { q: 9, r: 0 },
  });

  assert.ok(after);
  assert.equal(after!.fogged, false, "the destination is seen once the hero stands on it");
  assert.deepEqual(panelText(after!), [
    "Tile 9, 0",
    "Grass · move cost 1",
    "Commander (Player 1) — 24 troops, 6 move",
  ]);
  assert.equal(
    tilePanelLines(after!).some((line) => line.text === "Unexplored"),
    false,
    "the destination panel never falls back to the fog line",
  );
});

test("a seen impassable hex still reports its terrain, marked impassable", () => {
  const rows: TileRow[] = [
    { q: 0, r: 0, terrain: "grass", resource: null },
    { q: 1, r: 0, terrain: "denseForest", resource: null },
  ];
  const map = GameMap.fromTiles(rows);
  const info = describeTile({
    map,
    state: makeState(),
    heroes: [makeCommander(0, 0)],
    castles: [],
    viewPlayerId: 0,
    tile: { q: 1, r: 0 },
  });

  assert.ok(info);
  assert.deepEqual(panelText(info!), ["Tile 1, 0", "Dense forest · impassable"]);
});
