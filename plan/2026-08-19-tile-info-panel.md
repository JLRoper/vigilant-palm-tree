# Clicked-tile info panel ("what's on this hex?")

**Date:** 2026-08-19
**Branch:** `claude/tile-info-display-73f059`
**Issue:** [#142](https://github.com/JLRoper/vigilant-palm-tree/issues/142)
**Status:** Planned, not yet implemented — this doc is the handoff for whoever builds it.

## Goal

Clicking a hex on the adventure map should tell the player what is on it: at minimum the terrain,
plus the resource deposit / settlement / hero / charter sitting there. The readout must be

- **sticky** — it stays on screen after the click, through hero movement, turn ends and saves,
- **dismissed only by inspecting another tile** (or an explicit ✕),
- **non-intrusive** — a small fixed-position panel, never a modal, never stealing the pointer,
  never covering the minimap or the existing panels.

## Current architecture (read before touching anything)

Everything below was confirmed by reading the code in this worktree.

### What a tile can hold

| Thing | Source of truth |
| --- | --- |
| Terrain (`grass \| dirt \| water \| forest \| desert \| mountain`) | `map.get(q, r)` — [gameMap.ts](../packages/engine/src/map/gameMap.ts) |
| Movement cost / passability | `TERRAIN_COST`, `isPassable` — [terrain.ts](../packages/engine/src/map/terrain.ts) (`water`/`mountain` are `Infinity`) |
| Resource deposit ("mine") | `map.resourceTileAt(q, r)` → `{ q, r, resource }` — [resourceTiles.ts](../packages/engine/src/map/resourceTiles.ts); base yield in `RESOURCE_YIELD` |
| Settlement | `gameState.settlements` (a `SettlementState` carries `q`/`r`, `name`, `ownerId`, `level`, `population`, `morale`) |
| Hero | `gameState.heroes` / the `Hero` mirror objects (`tile.q`/`tile.r`, `ownerId`, `troops`, `movementRemaining`) |
| In-flight charter | `gameState.activeCharters` — `{ targetQ, targetR, settlementName, phase, daysRemaining }` |

There is no per-tile "owner" field. **A deposit is worked when it falls inside some settlement's
rate radius**: [`computeSettlementRates`](../packages/engine/src/economy/settlementRates.ts:59)
sums `RESOURCE_YIELD` over every resource tile within `settlementRateRadius(level) = level - 1`
of the settlement, then multiplies by `level`. Territory (the drawn outline) is a *different*,
larger radius: `controlRange(level, buildings)` in [control.ts](../packages/engine/src/control.ts).
The panel should use the rate radius for "worked by", not the control radius.

### Fog of war

[`computeVision`](../src/render/fog.ts:8) builds the visible set fresh **every frame** inside
[`MapRenderer.draw`](../src/render/renderer.ts:55): hexes within `VISION_RANGE = 4` of one of the
view player's heroes, plus `controlRange(...)` of their settlements. Painter policy, which the
panel must mirror exactly so the text never contradicts the picture:

- **Terrain is always drawn** ([HexTerrainPainter](../src/render/painter/HexTerrainPainter.ts:19)),
  with a translucent fog hex on top of unseen tiles — terrain stays legible through fog.
- **Resource icons and charters are skipped entirely** when not visible
  ([resourceIcon.ts:17](../src/render/overlays/resourceIcon.ts:17), CharterPainter).
- **Heroes and castles** are drawn if visible **or** owned by the view player
  ([HeroPainter.ts:23](../src/render/painter/HeroPainter.ts:23),
  [CastlePainter.ts:17](../src/render/painter/CastlePainter.ts:17)).

Note `AdventureView.isPlayerTurn()` hardcodes player `0`, while the renderer uses the real
`viewPlayerId` (`getInMemoryLocalPlayerId(...) ?? 0`, [GameEngine.ts:346](../src/managers/GameEngine.ts:346)).
The panel must use the **renderer's** `viewPlayerId`, or fog in the text will disagree with fog on
the canvas in multiplayer.

### Click handling

[`AdventureView.onClick`](../src/screens/adventure/adventureView.ts:491) is bound to the canvas and
already does a lot: minimap navigate → charter placement → drag suppression → hero select → attack
→ settlement select → issue move. **A left click on the map is already an action** (usually "move
the selected hero here"), so tile inspection cannot be its own click gesture — see the decisions.

`GameEngine` binds a **second** `click` listener on the same canvas
([GameEngine.ts:169](../src/managers/GameEngine.ts:169)) that feeds the city view. Consequently
`AdventureView.onClick` still fires while the city view is open, which matters for the guard below.

### The per-frame trap

[`GameEngine.loop`](../src/managers/GameEngine.ts:330) calls `fullFrame()` → `refreshHud()` on
**every** rAF frame. Anything hung off `UIManager.refreshHud`
([UIManager.ts:219](../src/managers/UIManager.ts:219)) runs at ~60 fps, so the panel must not
rebuild or rewrite DOM unconditionally — see `setMinimapReserve`
([panelRail.ts:87](../src/screens/shared/panelRail.ts:87)) for the existing "guard the DOM write"
precedent in this codebase.

### Screen real estate (all `position: fixed`)

| Region | Occupant |
| --- | --- |
| Top, full width | `#toolbar` (variable height, measured into `--toolbar-h`) |
| Top-right, under toolbar | Heroes/Settlements rail, `z-index: 5` ([panelRail.ts](../src/screens/shared/panelRail.ts)) |
| Bottom-right | Minimap (canvas-drawn, 180px box) + toasts (`z-index: 10000`) |
| **Left edge, lower half** | **HeroInfoMenu at `x:16, y:innerHeight-280`; SettlementInfoMenu at `x:16, y:innerHeight-420`** — both `z-index: 60`, draggable |
| Bottom-center | Dev console footer, `z-index: 40` (only when enabled) |
| Free | **Left edge directly under the toolbar** |

So the bottom-left corner is *not* free — that is where the hero panel lives whenever a hero is
selected, which is most of the game.

## Decisions

1. **Inspection is a side effect of the click, not a new mode.** Every non-drag left click on the
   map canvas that resolves to an in-bounds hex sets the inspected tile — *in addition to* whatever
   the click already did (move, select, attack, charter). This matches the request ("stays until
   clicking on another tile") and adds no new gestures. Right-click is left alone.
2. **The panel stores only `{q, r}` and re-derives its contents from live state each refresh.** A
   hero walking onto or off the inspected tile updates the panel; the readout never goes stale.
3. **Placement: left edge, docked below the toolbar** (`top: var(--toolbar-h)` + 8px gap,
   `left: 8px`, width ~230px, `z-index: 40`). Under the info menus (60) so a dragged hero panel
   wins, above the rail (5). This is the only genuinely unoccupied anchor and it stays clear of
   both info menus, the minimap and the toasts.
4. **Fog policy mirrors the painters exactly** — terrain always, everything else only when visible
   or owned by the view player. A fogged tile reads "Unexplored" plus the terrain.
5. **The selection ring draws on fogged tiles too**, unlike the hover ring
   ([HexHoverPainter.ts:6](../src/render/painter/HexHoverPainter.ts:6)) — a click should always
   produce visible feedback about *which* hex was hit, and the panel itself already says the tile
   is unexplored.

## What to build

### 1. `src/screens/adventure/tileInfo.ts` — pure derivation (no DOM)

```ts
export interface TileInfo {
  q: number; r: number;
  fogged: boolean;                       // not visible to viewPlayerId
  terrain: { kind: Terrain; label: string; cost: number; passable: boolean };
  deposit: {
    resource: ResourceType;
    yield: number;
    workedBy: { name: string; ownerId: PlayerId | null } | null;
  } | null;
  settlement: {
    name: string; ownerName: string; ownerColor: string;
    level: 1 | 2 | 3; population: number; owned: boolean;
  } | null;
  heroes: Array<{
    name: string; ownerName: string; ownerColor: string;
    troops: number; movementRemaining: number | null; owned: boolean;
  }>;
  charter: { name: string; phase: CharterPhase; daysRemaining: number } | null;
  territory: { settlementName: string; ownerName: string } | null;   // within controlRange
}

export function describeTile(input: {
  map: GameMap;
  state: GameState;
  heroes: readonly Hero[];
  castles: readonly Castle[];
  viewPlayerId: PlayerId;
  tile: Axial;
}): TileInfo | null;   // null when out of bounds
```

Keep it a pure function so it is unit testable exactly like
[adventureScene.test.ts](../test/render/adventureScene.test.ts). Suppress `deposit` / `charter` on
fogged tiles, and suppress `settlement` / `heroes` unless visible **or** `ownerId === viewPlayerId`.

Wording for the deposit line (the user's "mine"):

- worked: `Iron deposit — worked by Ironhold (+8 iron/turn)`
- idle: `Iron deposit — unclaimed (a settlement within 1 hex would work it)`, where the radius hint
  comes from `settlementRateRadius(level)`.

### 2. A cheap single-tile visibility check in `src/render/fog.ts`

`computeVision` allocates a `Set` over every hero/castle ring; calling it per frame *again* just to
test one hex is waste. Add:

```ts
export function isTileVisibleTo(heroes, castles, viewPlayerId, q, r): boolean
```

using `hexDistance` against each owned hero (`VISION_RANGE`) and castle (`controlRange(level, buildings)`).
This is algebraically identical to `addRing`'s `|dq + dr| <= range` test — **add a unit test that
asserts equivalence with `computeVision` over a small map**, so the two cannot drift.

### 3. `src/screens/adventure/tileInfoPanel.ts` — the DOM panel

A small class in the style of the other `src/screens/shared` modules (raw DOM + inline styles from
`menuTheme`, no new dependency):

- Built once, `show()` / `hide()` / `update(info)`.
- **Guard every DOM write behind a signature comparison** (a compact string built from the
  `TileInfo`). `update()` runs 60×/sec; only touch the DOM when the signature changes.
- Header: `Tile 12, 7` plus a `✕` that clears the inspection.
- Body: one line per populated section, ordered terrain → deposit → settlement → heroes → charter →
  territory. Omit empty sections; an empty grass hex shows just `Grass · move cost 1`.
- Styling: `menuTheme.panel` background/border, 12–13px, `pointer-events: auto` on the panel only,
  `user-select: none`, no focus stealing, no animation.
- Optional (nice-to-have, not required): a collapse chevron persisted to `localStorage` the way
  [panelRail.ts](../src/screens/shared/panelRail.ts) persists its layout.

### 4. Wire the click → inspected tile

**[`adventureView.ts`](../src/screens/adventure/adventureView.ts):**

- New field `private inspectedTile: Axial | null`, plus `getInspectedTile()` and a new
  `onTileInspect?: (tile: Axial | null) => void` option.
- In `onClick`, hoist the `hoverFromScreen` call so the hex is resolved **once**: after the minimap
  and drag early-returns (a drag must not re-inspect), **before** the
  `if (!this.isPlayerTurn())` guard at [line 543](../src/screens/adventure/adventureView.ts:543) —
  inspection is read-only and should work during the AI's turn too. Then reuse that `t` in the
  charter branch ([line 518](../src/screens/adventure/adventureView.ts:518)) and the action branch
  ([line 547](../src/screens/adventure/adventureView.ts:547)) instead of resolving the hex twice
  more.
- `t === null` (click outside the map) **keeps** the current inspection — an off-map click is not
  "clicking another tile".
- Fire `onTileInspect` only when the tile actually changes.
- Clear the inspection in `setMap()` ([line 149](../src/screens/adventure/adventureView.ts:149)) so
  new-game / load-game does not strand a panel describing the old map.

**[`ViewManager`](../src/managers/ViewManager.ts):** add `onTileInspect` to the `Pick<...>` option
list in `initializeAdventureView`, and a `getInspectedTile()` passthrough for the renderer.

**[`GameEngine.initRendering`](../src/managers/GameEngine.ts:113):**

```ts
onTileInspect: (tile) => {
  if (this.ui.getCityView()?.isOpen()) return;   // city view shares the canvas; see below
  this.ui.setInspectedTile(tile);
  this.fullFrame();
},
```

The city-view guard is required: `GameEngine` binds its own canvas `click` listener, so
`AdventureView.onClick` still runs behind an open city view.

**[`UIManager`](../src/managers/UIManager.ts):** own the `TileInfoPanel` (`initTileInfo()`,
`setInspectedTile(tile)`), and refresh it from `refreshHud`
([line 219](../src/managers/UIManager.ts:219)) next to `refreshSettlementInfoMenu`. It already has
everything needed: `gameStateManager.getGameMap()` / `.getSettlements()`, the `heroes` map, and
`localPlayerId`. Hide the panel while the city view is open, mirroring
[refreshSettlementInfoMenu](../src/managers/UIManager.ts:263).

### 5. The persistent selection ring

Add `SelectedTilePainter` alongside [HexHoverPainter](../src/render/painter/HexHoverPainter.ts) —
same corner math, a visually distinct stroke (the hover ring is solid `#ffcc00`, so use e.g. a
white dashed ring so hover-over-selection stays readable), drawn **before** the hover painter in
[`MapRenderer.draw`](../src/render/renderer.ts:71). Feed it through `RenderOptions`
(`inspectedTile?: Axial`, filled in [`GameEngine.draw`](../src/managers/GameEngine.ts:346) from
`this.view.getInspectedTile()`), which is how `selectedHeroTile` already travels. No fog check.

**Keep the scene-graph transcription in sync.** `src/render/scene/` is a parallel, not-yet-wired
faithful transcription of `MapRenderer.draw` (phase 5 track B). Adding the ring means also adding a
`SelectedTileHighlightNode` to [types.ts](../src/render/scene/types.ts), emitting it from
[adventureScene.ts](../src/render/scene/sceneBuilder/adventureScene.ts) next to `hoverHighlight`,
handling it in [paint2d/index.ts](../src/render/scene/paint2d/index.ts:219), and covering it in
`test/render/adventureScene.test.ts`. Skipping this leaves the transcription unfaithful — flag it
rather than silently diverge.

## Lifecycle rules

| Event | Panel |
| --- | --- |
| Click another in-bounds hex | Re-targets |
| Click the same hex again | Unchanged (no toggle — a toggle would fight the move order the same click issues) |
| Click off-map, or drag-pan | Unchanged |
| Minimap click / drag / pinch | Unchanged (minimap clicks navigate, they do not inspect) |
| Hero moves onto/off the tile, turn ends, round advances | Contents update live |
| `✕` | Cleared |
| New game / load game (`setMap`) | Cleared |
| City view opens | Hidden; restored on close |

## Tests

`npm run test:unit` already globs `test/screens/**/*.test.ts`, so add
`test/screens/adventure/tileInfo.test.ts` (`node:test` + `assert/strict`, same shape as the
`test/render` suites):

- empty grass tile → terrain line only, `passable: true`, cost 1;
- water / mountain → `passable: false`;
- deposit inside a level-2 settlement's rate radius → `workedBy` set; the same deposit one hex
  outside it → `workedBy: null`;
- fogged tile → terrain present, `deposit` / `charter` null, enemy hero and settlement suppressed;
- own hero on a fogged tile → still reported (mirrors `HeroPainter`);
- out-of-bounds `(q, r)` → `null`;
- `isTileVisibleTo` ≡ `computeVision(...).has(...)` across a small map.

Then the usual gate: `npm run build` + `npm run test:all` via the `precommit-checker` subagent.

## Manual verification

Start the dev env (`/dev start`), then in a fresh Large game:

1. Click empty grass → panel appears under the toolbar, reads `Grass · move cost 1`.
2. Click a hex with a resource icon → deposit line with yield and worked/unclaimed status.
3. Click your castle → settlement line; click your hero → hero line with movement.
4. Click a fogged hex → `Unexplored` plus terrain, nothing else.
5. Move the hero onto the inspected tile → the hero line appears without re-clicking.
6. End turn, save, open/close the Heroes rail → panel still there, nothing overlapping.
7. Open the city view → panel hides; close it → panel returns.
8. Drag-pan the map and click-drag the minimap → panel unchanged.

## Out of scope

- Hover tooltips (this is click-only, deliberately — hover already drives the path preview).
- Any new tile data in the DB or `GameState`. The inspected tile is **client-only view state**;
  putting it in `GameState` would dirty the save and round-trip through persistence for nothing.
- Anything beyond what `viewPlayerId` already gives for hot-seat/multiplayer fog.
