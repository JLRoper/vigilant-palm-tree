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

// ---------------------------------------------------------------------------
// F2 (the adventure map lies about what you can see): outside every vision
// ring, the panel said "Unexplored" with no terrain and no move cost — even on
// hexes the map had already painted as explored ground, so the player was told
// nothing about dirt they could plainly see under the veil. "Unexplored" now
// means NEVER SEEN: a hex in the seat's reveal set reads its terrain and move
// cost, marked as seen-before. A hex that was never revealed is unchanged.
// ---------------------------------------------------------------------------

/** A map with one dirt hex at (dirtQ, dirtR) and grass everywhere else. */
function makeGrassMapWithDirt(dirtQ: number, dirtR: number, width: number, height: number): GameMap {
  const rows: TileRow[] = [];
  for (let r = 0; r < height; r++) {
    for (let q = 0; q < width; q++) {
      rows.push({ q, r, terrain: q === dirtQ && r === dirtR ? "dirt" : "grass", resource: null });
    }
  }
  return GameMap.fromTiles(rows);
}

test("F2: an explored-but-unwatched hex reads terrain and move cost, never \"Unexplored\"", () => {
  const map = makeGrassMapWithDirt(6, 12, 16, 16);
  // The hero stands at (0,0): (6,12) is ~15 hexes away, far outside vision.
  const hero = makeCommander(0, 0);
  const state = makeState({
    players: [
      { id: 0, faction: "player", name: "Player 1", color: "#d62828", heroIds: [], settlementIds: [], revealedTiles: ["6,12"] },
      { id: 1, faction: "ai", name: "AI", color: "#1d7dd1", heroIds: [], settlementIds: [], revealedTiles: ["0,0"] },
    ],
  });
  const info = describeTile({
    map,
    state,
    heroes: [hero],
    castles: [],
    viewPlayerId: 0,
    tile: { q: 6, r: 12 },
    revealed: new Set(["6,12"]),
  });

  assert.ok(info);
  assert.deepEqual(
    panelText(info!),
    ["Tile 6, 12", "Dirt · move cost 1", "Explored — not in sight"],
    "the panel must read the ground the map has already drawn as explored",
  );
  assert.equal(info!.fogged, true, "the hex is outside the hero's 4-hex vision ring");
  assert.equal(info!.explored, true, "but the map's revealed state has it");
  assert.deepEqual(info!.terrain, {
    kind: "dirt",
    label: "Dirt",
    cost: 1,
    passable: true,
  });
  assert.equal(
    tilePanelLines(info!).some((line) => line.text === "Unexplored"),
    false,
    "an explored hex must never be called Unexplored",
  );
});

test("F2: a hex that was never revealed still reads \"Unexplored\" in the same game", () => {
  const map = makeGrassMapWithDirt(6, 12, 16, 16);
  const hero = makeCommander(0, 0);
  const state = makeState({
    players: [
      { id: 0, faction: "player", name: "Player 1", color: "#d62828", heroIds: [], settlementIds: [], revealedTiles: ["6,12"] },
      { id: 1, faction: "ai", name: "AI", color: "#1d7dd1", heroIds: [], settlementIds: [] },
    ],
  });
  // (9,9) is neither visible nor in the reveal set.
  const info = describeTile({
    map,
    state,
    heroes: [hero],
    castles: [],
    viewPlayerId: 0,
    tile: { q: 9, r: 9 },
    revealed: new Set(["6,12"]),
  });

  assert.ok(info);
  assert.equal(info!.explored, false);
  assert.equal(info!.terrain, null);
  assert.deepEqual(panelText(info!), ["Tile 9, 9", "Unexplored"]);
});

test("F2: a classic game (no reveal set) keeps the locked two-state fog", () => {
  const map = makeGrassMapWithDirt(6, 12, 16, 16);
  const hero = makeCommander(0, 0);
  const info = describeTile({
    map,
    state: makeState(),
    heroes: [hero],
    castles: [],
    viewPlayerId: 0,
    tile: { q: 6, r: 12 },
  });

  assert.ok(info);
  assert.equal(info!.explored, false, "no reveal set means nothing is explored");
  assert.deepEqual(panelText(info!), ["Tile 6, 12", "Unexplored"]);
});

// ---------------------------------------------------------------------------
// The tile panel prints a PRICE, not a float. `GameMap.cost` discounts a
// district-roaded hex by ROAD_MOVEMENT_MULTIPLIER (0.75), so a roaded forest
// costs 1.2 * 0.75 = 0.8999999999999999 in IEEE-754. The panel printed that raw
// (`${label} · move cost ${cost}`), and the twenty-character line no longer fit
// the panel's 202-px body: the rows beneath it reflowed, which is the 4,669 px
// that moved the district-map visual baseline. The value the engine USES must
// stay exact; only its RENDERING rounds, in one place (`formatMoveCost`).
// ---------------------------------------------------------------------------

test("a roaded hex's discounted price renders as one exact decimal, while the engine keeps the raw product", () => {
  const rows: TileRow[] = [
    { q: 0, r: 0, terrain: "grass", resource: null },
    { q: 1, r: 0, terrain: "forest", resource: null },
  ];
  const map = GameMap.fromTiles(rows);
  const installed = map.setRoadTiles(["1,0"]);
  assert.equal(installed, 1, "the road is installed over the forest hex");

  const hero = makeCommander(1, 0, 6);
  const info = describeTile({
    map,
    state: makeState({ selectedHeroId: hero.id }),
    heroes: [hero],
    castles: [],
    viewPlayerId: 0,
    tile: { q: 1, r: 0 },
  });

  assert.ok(info);
  // The engine is untouched: the price a unit actually pays is the exact float
  // product of the terrain cost and the road discount, not a rounded copy.
  assert.equal(info!.terrain!.cost, 1.2 * 0.75, "the engine keeps the exact discounted price");
  assert.notEqual(info!.terrain!.cost, 0.9, "and that exact price is not the rounded 0.9");
  // The panel rounds it for display only -- twenty characters of noise must not return.
  assert.equal(tilePanelLines(info!)[0].text, "Forest · move cost 0.9");
  assert.deepEqual(panelText(info!), [
    "Tile 1, 0",
    "Forest · move cost 0.9",
    "Commander (Player 1) — 24 troops, 6 move",
  ]);
});

