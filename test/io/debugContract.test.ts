import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  attachDebugApi,
  type GameDebugApi,
  type DebugHeroSnapshot,
  type DebugSettlementSnapshot,
} from "../../src/io/debugCommands";
import { axialToPixel } from "../../src/core/hex";
import { cityGridDebug } from "../../src/screens/settlements/cityView/cityGridDebug";
import { cityLayout, cellsInDrawOrder } from "../../src/core/cityGrid";

const calls: Record<string, number> = {};
const args: Record<string, unknown[]> = {};

function spy(name: string, fn?: (...a: any[]) => unknown): (...a: any[]) => unknown {
  return (...a: any[]) => {
    calls[name] = (calls[name] ?? 0) + 1;
    args[name] = a;
    return fn ? fn(...a) : undefined;
  };
}

const fakeState = {
  phase: { kind: "PLAYER_TURN", playerId: 0 },
  round: 3,
  heroes: {
    h1: { id: "h1", q: 1, r: 2, ownerId: 0, movementRemaining: 5 },
    h2: { id: "h2", q: 4, r: 4, ownerId: 1, movementRemaining: 5 },
  },
  activeCharters: [],
};

const fakeTurnController = {
  getState: () => fakeState,
  selectHero: spy("selectHero"),
  requestMove: spy("requestMove", () => true),
  enterBattle: spy("enterBattle"),
  captureSettlement: spy("captureSettlement", () => true),
};

const fakeMap = {
  get: () => "grass",
  isPassable: spy("isPassable", () => true),
  cost: () => 1,
};

const fakeVisualHero = {
  id: "h1",
  tile: { q: 1, r: 2 },
  ownerId: 0,
  movementRemaining: 5,
  trail: [{ q: 0, r: 1 }],
  gold: 10,
  moveDurationMs: 220,
};

const fakeVisualSettlement = {
  id: "s1",
  tile: { q: 3, r: 4 },
  level: 2,
  ownerId: 0,
  buildings: [
    { gx: 0, gy: 0, kind: "townHall", level: 2, w: 2, h: 2 },
    { gx: 2, gy: 2, kind: "market", level: 1, construction: true },
  ],
  districts: {
    "3,3": { q: 3, r: 3, buildings: [{ gx: 0, gy: 0, kind: "farmField", level: 1 }] },
  },
};

const fakeEngine = {
  getState: () => fakeState,
  getTurnController: () => fakeTurnController,
  handleEndTurn: spy("handleEndTurn", async () => {}),
  syncFromController: spy("syncFromController"),
  maybeAutoResolveBattle: spy("maybeAutoResolveBattle"),
  refresh: spy("refresh"),
  state: {
    getState: () => fakeState,
    getTurnController: () => fakeTurnController,
    getGameMap: () => fakeMap,
    getHero: (id: string) => (id === "h1" ? fakeVisualHero : undefined),
    getHeroes: () => [fakeVisualHero],
    getSettlements: () => [fakeVisualSettlement],
    rebuildHeroesFromState: spy("rebuildHeroesFromState"),
    replaceState: spy("replaceState"),
    syncHeroVisualsToState: spy("syncHeroVisualsToState"),
  },
  view: {
    camera: { zoom: 2, x: 10, y: 20 },
    view: { hover: null, lastClickDebug: { q: 5, r: 6, moved: true } },
  },
  session: {
    getActiveGameId: () => 7,
    getActiveGameName: () => "contract-test-game",
  },
  eventLog: null,
  consoleHandle: null,
  setConsoleHandle: () => {},
  // Ledger #22: the city-view grid provider, mirroring CityView.gridDebug().
  // `cityGridOpen` is flipped by the closed-view test below.
  getCityGrid: () =>
    cityGridDebug({
      open: cityGridOpen,
      settlementId: "s1",
      size: 5,
      viewportW: 1280,
      viewportH: 800,
      topInset: 40,
    }),
};

let cityGridOpen = true;

// attachDebugApi assigns to `window`, which does not exist under bare node:test.
(globalThis as unknown as { window: unknown }).window = globalThis;
attachDebugApi(fakeEngine as unknown as Parameters<typeof attachDebugApi>[0]);
const api = (globalThis as unknown as { __gameDebug: GameDebugApi }).__gameDebug;

const EXPECTED_KEYS = [
  "activeGameId",
  "activeGameName",
  "captureSettlement",
  "cityGrid",
  "console",
  "debugInjectCharter",
  "endTurn",
  "enterBattle",
  "eventLog",
  "events",
  "getGameState",
  "getHeroes",
  "getMoveDurationMs",
  "getSettlements",
  "getState",
  "getTurnController",
  "hover",
  "isPassable",
  "lastClick",
  "phase",
  "requestMove",
  "round",
  "screenFor",
  "setSelectedHero",
  "settings",
  "teleportHero",
];

test("the attached surface has exactly the documented 26 keys", () => {
  assert.deepEqual(Object.keys(api).sort(), [...EXPECTED_KEYS].sort());
});

test("member types match the contract", () => {
  const functions = [
    "getState",
    "getGameState",
    "getTurnController",
    "endTurn",
    "setSelectedHero",
    "requestMove",
    "enterBattle",
    "captureSettlement",
    "teleportHero",
    "debugInjectCharter",
    "getHeroes",
    "getSettlements",
    "cityGrid",
    "hover",
    "lastClick",
    "isPassable",
    "getMoveDurationMs",
  ];
  for (const key of functions) {
    assert.equal(typeof (api as unknown as Record<string, unknown>)[key], "function", `${key} must be a function`);
  }
  assert.equal(typeof api.screenFor, "function");
  // Ledger #20: the pointer readouts are calls now, like every other readout on
  // this surface -- a driver never has to know which spelling a member uses.
  assert.equal(typeof api.hover, "function");
  assert.equal(api.hover(), null);
  assert.equal(typeof api.lastClick, "function");
  assert.deepEqual(api.lastClick(), { q: 5, r: 6, moved: true });
  assert.deepEqual(api.phase, fakeState.phase);
  assert.equal(api.round, 3);
  assert.equal(api.activeGameId, 7);
  assert.equal(api.activeGameName, "contract-test-game");
  assert.equal(api.eventLog, null);
});

test("snapshot getters map the engine's visual entities", () => {
  const expectedHeroes: DebugHeroSnapshot[] = [
    { id: "h1", q: 1, r: 2, ownerId: 0, movementRemaining: 5, trail: [{ q: 0, r: 1 }], gold: 10 },
  ];
  const expectedSettlements: DebugSettlementSnapshot[] = [
    {
      id: "s1",
      q: 3,
      r: 4,
      level: 2,
      ownerId: 0,
      // Ledger #11: the settlement's own tier is `level`; each BUILDING carries
      // its own, so a town hall at L2 under a still-L1 settlement is readable.
      buildings: [
        { kind: "townHall", level: 2, construction: false, district: null },
        { kind: "market", level: 1, construction: true, district: null },
        { kind: "farmField", level: 1, construction: false, district: { q: 3, r: 3 } },
      ],
    },
  ];
  assert.deepEqual(api.getHeroes(), expectedHeroes);
  assert.deepEqual(api.getSettlements(), expectedSettlements);

  const px = axialToPixel(1, 2);
  assert.deepEqual(api.screenFor(1, 2), { x: px.x * 2 + 10, y: px.y * 2 + 20 });

  assert.equal(api.isPassable(0, 0), true);
  assert.equal(api.getMoveDurationMs(), 220);
});

test("ledger #22: cityGrid() hands a driver the view's own layout, and null while it is closed", () => {
  const grid = api.cityGrid();
  assert.ok(grid, "an open city view must report its grid");

  // The layout IS the view's own call (`cityLayout(size, innerWidth,
  // innerHeight, toolbarHeight())`), not a second solve, and the cell list is
  // the paint order -- so a driver never re-derives the projection.
  assert.deepEqual(grid!.layout, cityLayout(5, 1280, 800, 40));
  assert.deepEqual(grid!.cells, cellsInDrawOrder(5));
  assert.equal(grid!.settlementId, "s1");
  assert.equal(grid!.size, 5);
  assert.equal(grid!.viewport.width, 1280);
  assert.equal(grid!.viewport.height, 800);
  assert.equal(grid!.topInset, 40);

  // A named cell maps to a screen point and back to itself: what a driver needs
  // to click one cell rather than a guess.
  const pt = grid!.cellToScreen(1, 2);
  assert.deepEqual(grid!.screenToCell(pt.x, pt.y), { gx: 1, gy: 2 });
  assert.equal(grid!.screenToCell(-5000, -5000), null, "off the grid is null, never a wrapped cell");

  cityGridOpen = false;
  assert.equal(api.cityGrid(), null, "a closed city view has no geometry to report");
  cityGridOpen = true;
});

test("the events nested surface matches the contract", () => {
  const expected = ["available", "subscribe", "getEntries", "clear", "stats", "setCapacity"].sort();
  assert.deepEqual(Object.keys(api.events).sort(), expected);
  for (const key of expected) {
    assert.equal(typeof (api.events as unknown as Record<string, unknown>)[key], "function", `events.${key} must be a function`);
  }
  assert.equal(api.events.available(), false);
  assert.equal(api.events.stats(), null);
  assert.deepEqual(api.events.getEntries(), []);
});

test("the console nested surface matches the contract", () => {
  const expected = ["isOpen", "isPinned", "show", "hide", "togglePin", "setPinned"].sort();
  assert.deepEqual(Object.keys(api.console).sort(), expected);
  assert.equal(typeof api.console.isOpen, "boolean");
  assert.equal(typeof api.console.isPinned, "boolean");
  assert.equal(api.console.isOpen, false);
  assert.equal(api.console.isPinned, false);
  assert.equal(typeof api.console.show, "function");
  assert.equal(typeof api.console.hide, "function");
  assert.equal(typeof api.console.setPinned, "function");
  assert.equal(api.console.togglePin(), false);
});

test("the settings nested surface matches the contract", () => {
  const expected = ["get", "update", "reset"].sort();
  assert.deepEqual(Object.keys(api.settings).sort(), expected);
  assert.equal(typeof api.settings.get, "function");
  assert.equal(typeof api.settings.get(), "object");
  const updated = api.settings.update({ parallaxEnabled: true });
  assert.equal(typeof updated, "object");
  assert.equal(updated.parallaxEnabled, true);
  api.settings.update({ parallaxEnabled: false });
});

test("debug commands delegate to the engine", () => {
  for (const key of Object.keys(calls)) delete calls[key];
  for (const key of Object.keys(args)) delete args[key];

  api.endTurn();
  assert.equal(calls.handleEndTurn, 1);

  api.setSelectedHero("h1");
  assert.equal(calls.selectHero, 1);
  assert.deepEqual(args.selectHero, ["h1"]);

  assert.equal(api.teleportHero("h1", 9, 9), true);
  assert.equal(calls.replaceState, 1);

  api.enterBattle("h1", "h2");
  assert.equal(calls.enterBattle, 1);
  assert.deepEqual(args.enterBattle, ["h1", "h2"]);
  assert.equal(calls.maybeAutoResolveBattle, 1);
});

const SCAN_ROOTS = ["src", "test", "scripts", "tools"];
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "local"]);
const LOOSE_CAST_NEEDLES = ["(window as any).__gameDebug", "__gameDebug?: {"];

function collectSourceFiles(root: string): string[] {
  const files: string[] = [];
  const pending: string[] = [root];
  while (pending.length > 0) {
    const dir = pending.pop() as string;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) pending.push(join(dir, entry.name));
      } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".mjs")) {
        files.push(join(dir, entry.name));
      }
    }
  }
  return files;
}

test("no loose window.__gameDebug casts survive outside the typed GameDebugApi seam", () => {
  const self = resolve(fileURLToPath(import.meta.url));
  const repoRoot = resolve(self, "..", "..", "..");
  const offenders: string[] = [];
  for (const root of SCAN_ROOTS) {
    for (const file of collectSourceFiles(join(repoRoot, root))) {
      // This file legitimately carries the needles as scan patterns.
      if (resolve(file) === self) continue;
      const text = readFileSync(file, "utf8");
      for (const needle of LOOSE_CAST_NEEDLES) {
        if (text.includes(needle)) {
          offenders.push(`${file} contains ${needle}`);
        }
      }
    }
  }
  assert.equal(
    offenders.length,
    0,
    `loose __gameDebug casts must go through (window as unknown as { __gameDebug: GameDebugApi }):\n${offenders.join("\n")}`,
  );
});
