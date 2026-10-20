# Changelog

All notable changes to this project are documented here. The app version is the
root `package.json` `version` field; release tags are `v<semver>`. Bump it with
`npm run version:bump -- patch|minor|major`. The in-game toolbar gear (⚙)
dropdown menu's build-info footer shows the version, commit hash and build time.

**minor** marks a real game addition — new content or capability. **patch** marks
a bug fix, a chore, or housekeeping (docs, tooling, tests). The pre-commit gate
chooses between them for you from the intended commit type, and only bumps when
the version has not already been bumped in that changeset.

## [0.28.0] - 2026-10-20

Farm plots: two model-refined styles join the per-cell rotation

- **`farmWheatAI` and `farmOrchardAI`** (`building-pixel-farm{Wheat,Orchard}AI-1.png`) are edits of the procedural wheat and orchard plots made with an OpenRouter image model (`google/gemini-2.5-flash-image`). The input carries a magenta guide line over the exact 2:1 footprint, which the model treats as a measuring guide and drops; the output is checkerboard-stripped and then edge-fitted to the grid. They are committed PNGs — no runtime model call.
- **The rotation is now seven styles.** `FARM_PLOT_VARIANTS` gained the two variants, so `farmPlotVariantAt` mixes them per cell with the five procedural plots. Still render-time only: nothing is persisted and no save migration is needed, though a settlement's fields can pick a different style than before because the hash length changed.
- **Why the fit step exists:** without the guide the model redraws the tile at 30-32 deg (a true isometric camera) against the city grid's 26.57 deg, so the ground diamond's lower edges were measured and scaled to exactly 0.5 slope — 0.2% correction for the orchard, 16% for the wheat, which is why the wheat variant reads flatter than its procedural counterpart. Pipeline and angle table: `docs/sprite-pipelines.md` §4.1, provenance in `docs/asset-provenance.md`.

## [0.27.0] - 2026-10-20

### Logistics hero block, iso-pile resource default, new-game defaults

**Logistics hero section, condensed.** The hero's five cargo resources were five full-width label rows plus a totals line (~318px). They are now one wrapping strip of icon chips
(the panel's iso-pile sprites, `icon + stored/cap`) with the purse, wagon and cart totals moved onto the section header, matching the settlement block. The section is ~128px and
the whole window nearly fits without scrolling. The two wagon-slot rows keep their -1/+1 buttons.

**Iso piles by default on the map.** `DEFAULT_RESOURCE_STYLE` is now `isometric-pile` (the iso resource piles) instead of `rune-stone`. Settings persist as one object, so a store
written before this change would have kept the old default forever: `loadFromStorage` now honours a `schemaVersion` (absent = v1), converts a v1 `rune-stone` to the new default
once, and every write stamps v2. The Settings "Reset to default" button uses the exported constant rather than a second hardcoded copy.

**New Game defaults.** Home's form and the toolbar dialog now open with 1 human player, 1 AI enemy, a Medium map, and Uncharted mode checked (previously 1 / 0 / Small / off).
The visual-regression fixture pins its own settings (small, 0 AI, revealed) so a future default change cannot rewrite the baselines.

Verified: test:unit, the browser suites, and visual baselines regenerated for the iso-pile sprites.

## [0.26.0] - 2026-10-20

### Click a hero or settlement again to put it down

A map click is a toggle. Clicking your hero selects it (the hero panel opens); clicking that same hero again clears the selection and closes the panel -- including after moving it, which is the
gesture the playtest asked for: select, move, click it once more. Same for a settlement: click to select, click again to deselect. Clicking a different hero or settlement switches selection, and
with only a settlement selected, a click on empty ground puts it down instead of toasting "Select a hero first".

The deselect goes through `TurnController.clearSelection()` / `clearSettlementSelection()` -- the same reducers the panels' own `onClose` runs -- so a click and a close cannot leave different state behind.
The resolver takes `clickCount` (`MouseEvent.detail`) and only toggles on the first click: the second click of a double-click must not deselect, because double-clicking a settlement is the city-entry gesture.

Tests: six cases in `test/screens/adventure/clickIntent.test.ts` (toggle, switch, double-click guard for both surfaces, empty-ground deselect); `makeState` gained a `selectedSettlementId` override.

## [0.25.0] - 2026-10-20

### Escape closes every panel, from one place

Every floating surface in the game is now a **panel** (`FloatingPanel`, `src/screens/shared/panel.ts`) and every centred
modal a **dialog** (`openDialog`, `src/screens/shared/dialog.ts`); "menu" now means an actual command list only. The old
`src/screens/shared/menu.ts` and `panelStack.ts` are gone, replaced by those two modules plus `src/screens/shared/panelManager.ts`.

`panelManager` holds the single window `keydown` listener (capture phase) and closes the topmost open panel on Escape, so a
surface is Escape-closable by existing. That covers Settings, New Game, Load Game, Logistics, Keyboard & Mouse, Battle
Results, Test Battle Setup, the hero and settlement panels and both rosters, tile info, the game log, and every city-view
panel (City Design, Workforce, Recruitment, build palette, building and selection menus). Previously Settings, Load Game
and Logistics had no Escape at all, and six modules each wired their own listener.

One Escape does one thing, in a fixed order: an in-flight worker drag or pending build placement cancels first, then the
topmost panel closes (a tooltip inside the Logistics window takes the first Escape, the window the next), then the city's
tile selection clears, then the view closes. The City Design box opts out (`escapeClosable: false`) because the city view
owns it and closing it would strand the player without Build/Back. Hidden long-lived panels are never targets, so a closed
panel cannot swallow the key.

Also fixed while consolidating: a long-lived panel's × destroyed DOM the game keeps re-showing (hero/settlement panels,
rosters, tile info now hide and stay reusable), and closing the build palette from its own × left the City Design button
reading *Close* until an unrelated refresh.

Deleted as duplicates: the per-modal Escape listeners in `charterModal` and `assaultConfirmModal` (now `setOnEscape`
hooks) and `hotkeysModal`, the `escape` option on the dialog dismiss options, `UIManager`'s global Escape handler, the city
view's Escape branches naming each panel, and the hand-built modal backdrop in `confirmDialog`/`leaveBehind` (both now use
`openDialog`). Creation boilerplate collapsed into `createPanel({ key, defaultPosition, ... })`.

The toolbar's gear dropdown closes on Escape as well; it is a menu rather than a panel, so it keeps its own listener.

## [0.24.0] - 2026-10-20

The City Design panel is a normal floating menu, and every floating panel/menu can now be resized.

- **City Design is a movable floating panel** — the city view's Build / Workforce / Recruit / Back box was a hand-styled fixed div at a hardcoded z-index; it is now a `PopupMenu` like the workforce and recruitment panels: drag it by its title bar and it stays where you put it (position remembered between sessions under the `cityDesign` key), it joins the panel click-to-front stack, it carries the shared corner resize grip, and its first open still runs the collision solve so it cannot bury another panel. It has no close button on purpose — the city view owns its lifetime and nothing else reopens it, so an × would strand the player without Build or Back.
- **Every floating panel and menu is resizeable** — the recruitment panel's corner grip is now the shared default: hero and settlement panels, the Heroes/Settlements rail rosters (the grip hides while a roster is docked in the rail and the remembered size returns when you pop it out), City Design, Workforce, Recruitment, the build palette, building and selection menus, the adventure map's tile info, the game log, and the Keyboard & Mouse, Logistics, Battle Results and Test Battle Setup windows. Each panel remembers its own size (`heroesJs.panelSize.v1`), separate from its position. Confirm prompts and small forms (New Game, Load Game, Sign In, Settings, Multiplayer Lobby, Assault confirm) keep their fixed layout.
- Resizing now measures and applies the bordered box, so reopening a resized panel no longer creeps it 2px wider each time.
- **Two new mounted hero variants: Black Dragon Rider and Red Dragon Rider.** Both are repaints of the existing Drake Rider's chunky pixel-art dragon and rider — an obsidian-black dragon with indigo-violet sheen and a black/silver rider, and a crimson-scarlet dragon with ember-orange membranes and a black/brass rider. They appear in the recruit picker with no UI change and have their own 320×100 roster banners (stormy twilight and volcanic sunset).
- Both variants ship all eight headings. The `se`/`sw` diagonals were regenerated from the front view after the side-profile versions measured too close to `e`/`w` at map size; they now read as genuine three-quarter views, head-right and head-left respectively. Base frames only (no `-2` gallop files), so both run frames render the base sprite.
- `gemini-hero-sprite.mjs` gained `--subject <noun>` (dragon-facing wording instead of "horse and rider") and a `{{HEAD_SIDE}}` prompt placeholder for the explicit three-quarter composition rule. `test/render/dragonRiderArt.test.ts` pins both 8-way 512px file sets, and `test/heroVariants.e2e.ts` now A/B diffs both riders against the drake (`darkened` / `reddened` signals).
- The starter-variant draw now ranges over 16 variants, so the three adventure visual baselines were regenerated; the churn is the hero sprite and panel banner only.

## [0.23.0] - 2026-10-20

Trade-route carts that meet a hero no longer idle out the rest of the day, and a hovered cart's route preview follows a moving hero.

- **Meeting a hero now costs nothing** — a hero destination delivers the wrap the cart lands on the hero's tile and the flip spends whatever movement is left walking the fresh return leg in that SAME wrap, so a cart that catches its hero mid-wrap turns around and heads back immediately instead of parking until the next daily tick. When the origin is within that leftover walk it arrives and unloads the same wrap (the dead-hero and foreign-owner flips turn around the same way). Settlement destinations keep their existing arrival cadence.
- **The hovered cart's route line updates as the hero moves** — the preview's tiles came from a snapshot taken at the last daily advance, so it froze on the tile the hero stood on then. A leg whose goal is a hero (`CaravanMarkerSpec.goalHeroId`) now re-projects the line onto the hero's CURRENT tile every frame while the pointer rests on the cart, using the same A* the engine's pre-walk re-target runs at turn end. Settlement legs keep the stored path, a foreign goal hero never moves an own-seat line, and a hero standing on the cart's tile draws no line at all (that meeting is instant).
Farm fields: five grid-exact plot styles, mixed per cell
- **New farm-field art family** (`building-pixel-farm{Wheat,Veg,Orchard,Paddock,Vines}-1.png`) drawn by the deterministic `tools/sprites/gen-farm-sprites.mjs`: a 128x64 logical ground diamond (true 2:1, south vertex on the bottom canvas row) upscaled 8x to the 1024 family size. It carries no side plinth — a 1px outline plus a 2-3px verge — and every prop is trimmed to its own diamond (`clipToPlot`), so a plot sits flush in its 2x2 cells and adjacent fields meet edge-to-edge instead of being sliced by a neighbour's ground.
- **Exact-fit descriptor for the new family:** `hexSizeMul 1.0` (the universal building inset is 0.9) and a generated `anchorOffsetY 0`, so the ground diamond lands on the footprint's cell corners. The legacy `farmField` art keeps the 0.9 convention and stays on disk for comparison.
- **Per-cell variety:** `farmPlotVariantAt(settlement, gx, gy)` (FNV-1a over the cell) picks one of `FARM_PLOT_VARIANTS` at render time, so a settlement's fields mix styles and a reload never reshuffles them. Nothing is persisted, so no save migration; each variant is already its own keyed sprite, which is what a later split into player-chosen, goods-producing farm kinds will build on. `?farm=<variant>` (or `farmField` for the legacy art) still forces one style for review.

## [0.22.1] - 2026-10-20

- **Light unicorn rework:** the old 64px `bubbly` slot is now the dark unicorn's radiant counterpart — a 512px pearl-white unicorn with a gold horn, a silver-gold mane and a dawn roster banner — and its recruit label reads **Light Unicorn**. Six adventure-map headings plus gallop frames.
- **Dark unicorn completes its turnaround:** `ne/nw/se/sw` were generated from the east/west profiles instead of re-posed from the rear/front views (which produced a mirrored `nw` and two straight-on duplicates), so both unicorns now face every map heading rather than falling back to a cardinal.
- `gemini-hero-sprite.mjs` gained `--riderless` (mount-only facing wording), `--pose-ref` (the reference's actual heading for a diagonal repaint) and `--suffix` (run-frame output names); `test/render/unicornArt.test.ts` pins the two unicorns' 512px base/run-frame file sets on disk.

## [0.22.0] - 2026-10-19

- **Dense forest biome** (new `denseForest` terrain, map-gen **v4**): a rarer, **impassable** second forest — `TERRAIN_COST` is `Infinity`, so heroes path around it exactly like mountains and water. It is generated last, seeded on a non-forest neighbour of a forest tile and grown with a 0.75 bias toward frontier tiles that still touch normal forest, so it usually borders the forest it grew out of while its outer rim still meets the surrounding biomes. `DENSE_FOREST_FRACTION` is 0.06 against forest's 0.15; it never overwrites forest, water or mountain and never carries a resource deposit.
- **Map-gen v4 keeps v1–v3 maps intact** — `MapGenVersion` gained `4` and `CURRENT_MAP_GEN_VERSION` is the single source for "new game", so a fresh game is built on the grid a reload regenerates while saved v3 games keep their exact terrain. v4 only *adds* dense forest on top of the identical v3 grid.
- **Forest-edge wood bonus in the district city view:** a `forest` hex that touches a `denseForest` hex gains one extra `wood` spot (`DENSE_FOREST_BONUS_SPOT`, `vein: "dense"`) on its 5×5 district grid — 4 spots instead of 3, alongside the spots it already had. Wired through the client `GameEngine`/`UIManager`, the server `PlaceBuildings` handler and startup districts, so optimistic and authoritative grids agree.
- Dense forest gets its own map art (a three-crown thicket over a near-black floor, denser than a forest tile), its own `TERRAIN_COLORS` entry, and a city-backdrop palette so settlements beside one render correctly. Districts cannot be placed on it (`isForbiddenDistrictTerrain`, shared by the city view's open gate and the reducer).

## [0.21.0] - 2026-10-19

Recruitment panel: unit rows accordion their buildings and bulk buy/staff

- The unit row (its image) is now the panel's parent: clicking it accordions down one row per building that trains that unit, collapsed by default. The parent never opens an individual building's menu; only the nested building rows do, exactly as an iso-grid click does.
- The parent row buys across every one of those buildings (shift-click takes the pooled maximum) and its worker stepper staffs them all at once (`−`/`+` = one worker per building, emptiest-first for add / fullest-first for remove, capped by the idle pool; a legacy auto-staffed settlement stays a single explicit step so the engine's auto-crew is not double-spent). Its `−`/`+` sit right-aligned, directly above the nested rows' steppers.
- `RecruitmentSource` now carries its own `workers`/`maxWorkers`, so the same stepper helpers serve a source and a building row; `test/cityView.test.ts`'s `testRecruitmentPanelAccordion` drives the real panel (collapsed default, expand without a menu or recruit, nested row opens the building menu at the building, parent staffs both farmhouses server-verified, shift-click drains both draft pools for 6 peasants).

## [0.20.0] - 2026-10-19

- Three new map tiers above `epic`: **Colossal** (180×135, 24,300 hexes), **Titanic** (240×180, 43,200 hexes) and **Gigantic** (300×225, 67,500 hexes), keeping the 4:3 aspect ratio every renderer, minimap and camera path assumes.
- The ladder is now one ordered array: `MAP_SIZE_ORDER` in `packages/engine/src/map/gameMap.ts`, with `MapSize` derived from it and `MAP_SIZES` keyed by the same type, so a further tier is one array entry plus its size row.
- Every size selector reads the registry (`MAP_SIZE_ORDER` + `mapSizeLabel`): the full-screen New Game form and the shared New Game modal both list all eight tiers in ladder order, so a new tier needs no selector edit. Both surfaces now print the same `×` separator (the modal previously used `x`).
- `isMapSize()` is the single size predicate — `POST /games`'s `storedMapSize` and the AI driver's persisted-size read use it instead of their own literal name lists — and every client/server signature that spelled out the five-name union now uses `MapSize`.
- Existing names (`small` … `epic`) are unchanged so saved games keep their `map_size`; no scaling rule needed per-tier branching because terrain blob counts, castle counts/spacing, AI target reach and the minimap mist LOD all derive from `width × height`.
- `test/engine/mapSizeLadder.test.ts` pins the ladder (ordering, 4:3, generated dimensions and tile counts, `isMapSize` rejecting prototype keys, label formatting), and the map-reconstruction test now iterates `MAP_SIZE_ORDER` instead of a hard-coded list.
- Verified end-to-end on a worktree dev instance with Playwright: each new tier created through the New Game form, `map_size` persisted, the `/tiles` grid matching `width × height` (24,300 / 43,200 / 67,500 rows), and the client rendering the map. Full unit suite: 2,118 passing.

## [0.19.0] - 2026-10-19

- Three new mounted hero variants, each a full repaint of an existing one and all shipping **eight** directions (no diagonal→cardinal fallback), base frames only, plus a 320x100 roster banner:
  - **Frost Warden** (`frostwarden`, commander-12, from `paladin`): ice-white roan horse, silver-white mane, silver plate with a white fur collar, pale-cyan cape, frosted helm.
  - **Grave Warden** (`gravewarden`, commander-13, from `shadow`): near-black horse with a violet sheen, blackened iron-and-bone plate, tattered dark-green cloak, horned helm with a necrotic green visor glow.
  - **Storm Rider** (`stormrider`, commander-14, from `ranger`): dappled blue-grey horse, blue-grey leather over bronze-studded mail, storm-ochre cloak with a lightning hem, navy hood, lightning-etched yew bow.
- Art generated with `google/gemini-3.1-flash-image` via OpenRouter (`google-vertex/global`) through `tools/sprites/gemini-hero-sprite.mjs`; prompts, override prompts, reference hashes and per-file alpha bounds are committed under `design/hero-variants/{frostwarden,gravewarden,stormrider}/` (1024² masters gitignored). Three `ne`/`nw` sprites were regenerated after the first pass came out mirrored, and the manifests record the exact override used.
- `test/heroVariants.e2e.ts` is now table-driven (`VARIANTS`): for each generated variant it seeds the variant into a real game, asserts the client holds it, resolves all eight `horse.<variant>.*` descriptors plus its banner as real PNGs, asserts the recruit-picker entry and the paladin's unchanged 16-key descriptor set, and A/B diffs the same map tile against the variant it was repainted from — requiring the palette shift the art was made for (reddened capes, darkened/greened undead horse, cooled frost/storm palettes).
- The three adventure visual baselines were regenerated for the usual reason: a new registry entry shifts the seeded starter-hero variant draw, so several heroes and one hero-panel banner change. City-view and battle-arena baselines are byte-identical.

## [0.18.0] - 2026-10-19

feat(recruitment): consolidated recruitment panel with a shared drag-and-drop garrison grid

The city view gains a **recruitment panel** (⚔ Recruit in the City Design box, or `r`): every recruit source in a settlement and its districts collapses into one block per building kind, with ready/capacity totals, live `+N/wk` refill recomputed from actual staffing, resource-pile cost icons, per-building worker steppers (peasant sprite, `n/max`/`Auto`, `−`/`+` committing `AssignWorkers` district-true), a per-kind **Buy all** that takes from the most-stocked building first and then round-robins, `+` for one and shift-click for the affordable maximum, and hover tooltips instead of prose. Each commit rides the existing `RecruitUnits` with the source building's own coords + district, so a district barracks works without that district being open. Its building list scrolls inside the panel and the panel is resizeable (corner grip, size remembered) — the resize grip is a shared `panelResize.ts` any panel can adopt with one option.

Armies and garrisons become one drag-and-drop representation: `src/screens/shared/squadGrid.ts` (4×2 square tiles, unit PNG + count badge) backs the hero panel's Army section and both garrison surfaces, so the settlement panel and the recruitment panel mount one `GarrisonView` and a drag on either re-renders both. Within a grid a drag swaps two slots (new `ReorderGarrison` command); between the garrison grid and the hero's army grid it moves troops through `TransferUnits` into the dropped slot.

Clicking a building's row in the recruitment panel — the kind's heading, a per-building line, or a unit's own row (the unit art), anywhere but on a button — opens that building's own menu: the same one an iso-grid click opens, placed at the building and ringing it until the menu closes. A unit row opens the building it recruits from (its fullest source, the one `+` draws on); a row in another district switches the city view there first through the engine's own district door.

## [0.17.0] - 2026-10-19

- Caravans are now eight-directional: supply wagons and treasury carts each have their own sprite for every compass heading and turn to face the way they are walking, like heroes, instead of one side view with a horizontal flip.
- The diagonal and rear headings are genuinely distinct, not repeated side views: `n` shows the cart from behind with the horse's hindquarters beyond it, and the generated `nw`/`sw` rear-quarter sprites are mirrored into `ne`/`se` so both diagonal pairs read correctly at map scale.
- Treasure carts now read as a distinct vehicle: a two-wheeled, red-bannered cart with a pale horse and gold cargo, visibly different from the brown four-wheel supply wagon.
- Own caravans reveal a 2-tile vision ring (a hero sees 4), so a wagon on the road lifts the fog around itself.
- Hovering a caravan rings it and, for your own caravan, draws its remaining route to the destination as a dashed line with a destination ring. Enemy caravans ring only, so their destination is not revealed.
- New art pipeline `tools/sprites/gen-caravan-sprites.mjs` redraws the existing wagon/cart from six camera headings via FLUX-2-klein image editing, then derives the opposite diagonals by mirroring and downscales all eight by one shared scale.

## [0.16.0] - 2026-10-19

- New mounted hero variant **Paladin 2** (`paladin2`, commander-11, label "Paladin 2"): a darker gilded "Paladin of the Ember Oath" repaint of the existing paladin — charcoal dappled warhorse with a silver-white mane, blackened-steel plate with gold filigree, crimson tabard and cape. All **eight** directions ship (no diagonal→cardinal fallback), base frames only, plus its 320×100 roster banner.
- The original `paladin` is untouched: same registry entry, same four cardinal sprites, same 16 descriptor keys (8 directions incl. fallbacks × base/frame-2). A Playwright assertion pins that set.
- Added `tools/sprites/gemini-hero-sprite.mjs`: an OpenRouter Gemini image-in → image-out generator for hero variants that keys the model's flat grey background with a border flood fill, then frames the result to the reference sprite's alpha bounding box (same content height, bottom edge and centre) so generated art lands in `commander-<N>/` at the original's scale.
- Art generated with `google/gemini-3.1-flash-image` pinned to `google-vertex/global`; prompts, reference hashes and per-file alpha bounds are committed under `design/hero-variants/paladin-2/` (1024² masters gitignored).
- New `test/heroVariants.e2e.ts` (`npm run test:heroVariants`, part of `test:all`): recruits the variant into a real game, asserts the persisted `horseVariant` reaches the client, resolves all eight `horse.paladin2.*` descriptors and the banner as real PNGs, and A/B diffs the same map tile against the original paladin to prove the new sprite actually paints (726 changed px, 114 reddened by the cape, 395 darkened by the charcoal horse).

## [0.15.0] - 2026-10-19

- Settlement panel: the settlement's own name is now the panel's first text (the header), with its owner beside it; the line under the banner labels the holding and its tier (`SETTLEMENT L1`) instead of repeating the name.
- The **⌂ Settlements** roster rows take the same double-click as the panel banner: the map centres on that settlement and its city view opens, through the same own-settlement/own-turn gate.

## [0.14.0] - 2026-10-19

- Settlement panel: the settlement's own name and tier now render at the top (the name was written into the level badge and immediately overwritten, so it never appeared).
- Double-clicking the panel banner enters that settlement's city view, through the same own-settlement/own-turn gate the map's double-click uses.
- Warehouse section is a vertical list: 16px icons, stock, and a signed per-day rate per resource (production minus building upkeep / population food), amber while a stock drains, with the produced/spent split in each row's tooltip.
- Food row reads `stock +/-net/day` with a made-vs-eaten tooltip instead of `stock / required`.
- Treasury row shows `gold / cap`; the separate "Treasury capacity" row is gone.
- Settlement banners resolve through `settlementBannerUrl()` with a tier-1 fallback, so an out-of-range level cannot blank the panel or drop the roster row's background.

## [0.13.0] - 2026-10-18

Startup districts: tier-2 settlements are born with 1 district and tier-3 with 2 (a couple of level-1 buildings each), every district must join the settlement's cluster (no floating districts, bridged across water only by a water district holding a shipyard), and the new water-only shipyard building + art.

## [0.12.0] - 2026-10-18

City view: per-settlement biome settlement diorama backdrop (default, with a watercolor-skybox fallback), a see-through outline-only grid with a City grid lines toggle, and a diorama plate sized from the measured grid footprint for 10x10/15x15 cities.

## [0.11.0] - 2026-10-18

Logistics panel: icon stockpiles with floating tooltips, inline wagon/cart purchases with price tooltips, and one-row compact route visualization

## [0.10.0] - 2026-10-18

Workforce staffing system: per-100-pop worker pool, assignable staffing scaling production/draft recharge/upgrade speed. The first assignment auto-crews the remaining pool (jobs first by kind, then houses), workers/draft survive the city-view round-trip, and drag/panel lifecycle fixes land with it (drops over UI cancel, the panel closes with the city, Escape closes it first).

## [0.9.1] - 2026-10-17

Move game version/build info from the settings panel footer into the toolbar gear dropdown
fix(economy): round stored settlement gold and warehouse quantities half-up to whole integers at the write points

## [0.9.0] - 2026-10-17

feat: uncharted fog-of-war mode

## [0.8.0] - 2026-10-17

feat(districts): add city districts on controlled territory hexes (5x5 district grids, adventure map district sprites, economy/storage pooling, and enemy hero occupation blocking) and 20 new Tier 1 settlement sprites (`4 variants × 5 building-count fullness stages`)

## [0.7.0] - 2026-10-17

feat(hud): isometric resource icons and a population capsule in the header bar

## [0.6.0] - 2026-10-16

Tier 4 large-map scaling (v3 mapGenVersion, proportional blobs/settlements, mandatory castle connectivity, AI reach scaling), charter/sprite optimizations, dirty-entity persistence, and nginx web-runtime

## [0.5.2] - 2026-10-12

chore: enable default worktree-first workflow in heroes-js; align AGENTS.md, agents, commands, skills; Phase 05 concurrency+recovery drill merged

## [0.5.1] - 2026-10-12

test: add tsconfig.test.json (ambient Vite types in scope) and a test:types script, gate unwired

## [0.5.0] - 2026-10-11

feat(heroes): add the lionheart mounted hero variant with banner, names and directional sprites

## [0.4.0] - 2026-10-11

feat(ui): restyle the toolbar with a two-row layout and selectable modern/classic-blue themes

## [0.3.8] - 2026-10-11

test(visual): classify the real target-close message in isReloadRace

## [0.3.7] - 2026-10-11

test(visual): harden the visual-regression gate against reload races

## [0.3.6] - 2026-10-11

chore(sprites): computed building-anchor offsets with drift gate

## [0.3.5] - 2026-10-11

nginx cache gateway in front of vite preview: immutable hashed /assets, no-cache index.html, no-store and unbuffered /api so the SSE event stream is never stalled

## [0.3.4] - 2026-10-11

fix(upkeep): suppress unfed-troops warnings while the entity is currently affordable (pure read-side evaluators, panel badge gates, weekly-charge cadence tooltips); the weekly charge itself is unchanged

## [0.3.3] - 2026-10-11

Make building-sprite coverage exhaustive over BuildingKind, so a new kind cannot ship a blank tile.

## [0.3.2] - 2026-10-11

Anchor the version gate's already-bumped check to the newest release tag so it stops going blind once another commit lands on top of a release.

## [0.3.1] - 2026-10-10

### Added

- **`npm run version:bump -- patch|minor|major|X.Y.Z`** — the app's version-bump
  routine. Rewrites the root `package.json` version in place (formatting
  preserved), prepends a `CHANGELOG.md` entry, and optionally commits, tags and
  pushes (`--commit` / `--tag` / `--push`). `--dry-run` previews without
  writing, and `-m "..."` overrides the default git-log summary.
- **`CHANGELOG.md`** — baseline entry for 0.3.0 (the contents of the current
  release) plus the versioning policy.
- **A Versioning section in `AGENTS.md`** — declares the root `package.json`
  version the single source of truth, the tag format `v<semver>`, and the
  semver meanings while the major is `0`.
- **Guard tests** (`test/core/version.test.ts`) — the app version must be valid
  semver, and `vite.config.ts` must keep stamping version, commit hash and build
  time from `package.json`, so the chain
  `package.json → define → core/version.ts → settings footer` cannot silently
  break.

### Fixed

- **Docker builds now stamp a real commit hash.** `.git` is excluded from the
  build context (179 MB of PNG art history; copying it in would grow the 340 MB
  context to ~520 MB), so the container could never resolve a commit and every
  deployed build reported the literal fallback — the settings panel's build info
  read `v0.3.0 (dev)`. `docker/Dockerfile` now takes
  `ARG VITE_COMMIT_HASH`, compose passes it to both `api` and `web`, and
  **`npm run docker:build`** resolves it on the host and forwards it. A bare
  `docker compose build` still defaults to `dev`, which is why `AGENTS.md` now
  routes Docker builds through the wrapper.
- **`.dockerignore` tightened** — `local/` (115 MB, and `AGENTS.md` forbids
  committing anything under it), `design/` (86 MB) and a bare `.env` now excluded.
  All three were shipping into every build context.

## [0.3.0] - 2026-10-10

Baseline entry, added when the changelog and the version-bump routine were
introduced. The version field had never been changed since the initial commit,
so the history before this entry is not itemized here — see `git log` for the
345 commits that precede it.

### What 0.3.0 contains

- **Rendering**: the whole draw path rebuilt around the SceneGraph seam
  (`buildAdventureScene`/`buildCityScene`/`buildBattleScene` → `paintScene`),
  entity rendering through `EntityMirror`, and the per-kind painter set
  consolidated to one implementation.
- **Sprites**: registry-driven arena unit art, horse run-cycle frames, four
  faction rosters (human, ashen, ironmark, verdant) with icons, banners and
  buildings, and a code generator that derives the building-sprite key list
  from the art folder (`npm run gen:sprite-keys`).
- **Gameplay**: AI enemy seats (client- and server-driven), settlement capture
  and garrison battles, per-hero battle verdicts, the trade-route/caravan
  logistics rework with no shared storage, bank pots, and per-settlement farms.
- **Multiplayer**: SSE event push alongside the poll fallback, presence-aware
  seat drop policy, and the log message panel.
- **Tooling**: Playwright visual-baseline gate, dependency-cruiser layer rules,
  Docker deployment stack, and a build-info footer in the settings panel.
