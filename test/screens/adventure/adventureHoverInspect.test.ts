import { test } from "node:test";
import assert from "node:assert/strict";
import type { Axial } from "../../../src/core/hex";
import type { GameState } from "../../../src/state/gameState";
import { Camera } from "../../../src/render/camera";
import { MinimapCamera } from "../../../src/render/minimapCamera";
import { GameMap, type TileRow } from "../../../src/map/gameMap";
import type { MapRenderer } from "../../../src/render/renderer";
import type { Hero } from "../../../src/entities/hero";
import type { TurnController } from "../../../src/state/turnController";

// The tile panel is driven by the view's onTileInspect channel, which a click
// has always used (docs/map.md: clicking a hex inspects it as a side effect).
// The playthrough findings M-MINOR-1/M-MINOR-2 were both filed against the
// panel's contents after *hovering* a hex, which used to leave the panel
// closed entirely -- so this pins that the hex under the pointer reaches the
// same channel, and that the panel is not reopened for the hex it is already
// showing. The DOM half (the exact strings the panel renders) is pinned in
// tileInfoPanel.test.ts; the end-to-end behaviour is verified in the browser.

function makeGrassMap(width: number, height: number): GameMap {
  const rows: TileRow[] = [];
  for (let r = 0; r < height; r++) {
    for (let q = 0; q < width; q++) rows.push({ q, r, terrain: "grass", resource: null });
  }
  return GameMap.fromTiles(rows);
}

function makeState(): GameState {
  return {
    round: 1,
    day: 1,
    activePlayerId: 0,
    players: [{ id: 0, faction: "player", name: "Player 1", color: "#d62828", heroIds: [], settlementIds: [] }],
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
  };
}

function installWindowStub(): void {
  const listeners = { addEventListener: () => {}, removeEventListener: () => {} };
  (globalThis as unknown as { window: typeof listeners }).window = listeners;
}

interface PointerHarness {
  pendingPointer: { x: number; y: number } | null;
  flushPointerState(): void;
}

async function makeView(): Promise<{
  inspect: (tile: Axial | null) => void;
  inspected: Array<Axial | null>;
}> {
  installWindowStub();
  const { AdventureView } = await import("../../../src/screens/adventure/adventureView");
  const map = makeGrassMap(12, 12);
  const state = makeState();
  const canvas = {
    addEventListener: () => {},
    removeEventListener: () => {},
    clientWidth: 1280,
    clientHeight: 800,
  } as unknown as HTMLCanvasElement;
  let current: Axial | null = null;
  const renderer = { hoverFromScreen: () => current } as unknown as MapRenderer;
  const inspected: Array<Axial | null> = [];
  const view = new AdventureView({
    canvas,
    renderer,
    map,
    camera: new Camera(),
    minimapCamera: new MinimapCamera(map),
    heroes: () => ({}) as Record<string, Hero>,
    getGameState: () => state,
    getTurnController: () => ({}) as unknown as TurnController,
    onPathChanged: () => {},
    onHudUpdate: () => {},
    onRedraw: () => {},
    getPathPreviewLock: () => null,
    setPathPreviewLock: () => {},
    onTileInspect: (tile) => {
      inspected.push(tile);
    },
    getLocalSeat: () => 0,
  });
  const harness = view as unknown as PointerHarness;
  return {
    inspected,
    inspect: (tile) => {
      current = tile;
      harness.pendingPointer = { x: 300, y: 240 };
      harness.flushPointerState();
    },
  };
}

test("hovering a hex inspects it through the same channel a click uses", async () => {
  const view = await makeView(() => ({ q: 9, r: 0 }));

  view.inspect({ q: 9, r: 0 });
  assert.deepEqual(view.inspected, [{ q: 9, r: 0 }], "the hex under the pointer is the inspected hex");

  view.inspect({ q: 5, r: 5 });
  assert.deepEqual(view.inspected, [{ q: 9, r: 0 }, { q: 5, r: 5 }], "the panel follows the pointer");
});

test("settling on the hex the panel already shows does not re-inspect it", async () => {
  const view = await makeView(() => ({ q: 4, r: 4 }));

  view.inspect({ q: 4, r: 4 });
  view.inspect({ q: 4, r: 4 });
  assert.equal(view.inspected.length, 1, "the pointer settling again is not a new inspection");

  view.inspect({ q: 4, r: 5 });
  assert.equal(view.inspected.length, 2, "a new hex is");
});

test("the pointer leaving the map keeps the last inspected hex, and inspects nothing", async () => {
  const view = await makeView(() => ({ q: 7, r: 7 }));

  view.inspect({ q: 7, r: 7 });
  assert.deepEqual(view.inspected, [{ q: 7, r: 7 }]);

  view.inspect(null);
  assert.deepEqual(view.inspected, [{ q: 7, r: 7 }], "off-map hover neither clears nor re-inspects");
});
