# Sprite Pipelines — Deep Dive (Usage + Creation)

**Status:** Deep-dive reference. Written 2026-10-10, read-only (nothing in this
document was implemented). Purpose: a single map of how sprite assets flow from
creation tools into rendered pixels, plus the findings (F1–F13) that motivate
upgrades to the creation tooling, consolidation, and structural constraints.

**Tree-state caveat:** this workspace is mid-refactor. A sibling session's
`remove-city-building-styles` work (plan `.plans/20261004-0627_remove-city-building-styles_UNCLAIMED.md`,
waves 1–2 `_COMPLETE`, wave 3 handed back `_UNCLAIMED` the same day this doc was
written) has already deleted `src/render/cityBuildingDraw/` and the five
procedural building styles. **City buildings are now sprite-only**: a missing
`building.pixel.*` sprite draws nothing. Several docs still describe the old
style system — see finding F6.

---

## 1. TL;DR

Two pipelines meet at one file:

```
CREATION (tools + kilo skill)                      USAGE (runtime resolution)
─────────────────────────────                      ──────────────────────────
procedural canvas ─┐
FLUX (DeepInfra)  ─┤→ src/resources/**/*.png ─→ generated keys ──→ assetDescriptors.ts ─→ SpriteProvider ─→ Paint2DDep
Gemini (OpenRouter)┘   (wiring: codegen)       (buildingSpriteKeys.ts) (keys + descriptors) (source chain)    (scene → paint2d)
unit-art waves ────┘                                    ▲                      ▲
                                                   tools/gen-building-       settings.ts
                                                   sprite-keys.mjs
```

- **Usage pipeline**: `assetDescriptors.ts` (key → descriptor) → `assets.ts`
  (`SpriteProvider` over an image/on-demand/procedural source chain) →
  `paint2dDefaults.ts` (`Paint2DDep` resolvers) → `scene/sceneBuilder/*` (what
  to draw) → `scene/paint2d/index.ts` (how to draw it). Enforced by
  `dependency-cruiser.cjs` + `test/render/paint2d.seam.test.ts` + a visual-
  baseline gate.
- **Creation pipelines**: one deterministic local pipeline (procedural canvas),
  one FLUX/DeepInfra pipeline (~21 one-off scripts), one Gemini/OpenRouter
  pipeline (the `building-sprite-gen` kilo skill, 4 scripts), one unit-art wave
  pipeline (`design/arena-unit-sprites`), one skybox pipeline. Wiring back into
  the game is **mostly manual** (two hand-maintained key lists, a hand-measured
  anchor table) except for three families that are `import.meta.glob`-driven.

---

## 2. Asset inventory & key namespaces

Files live under `src/resources/` (`tools/sprites/manifest.mjs:1` names the root
`ASSETS_DIR`):

| Folder | Contents |
|---|---|
| `resources/` (root) | `castle-l{1,2,3}.png`, `castle-l{1,2,3}-alt{,2,3}.png`, `{settlement,city,castle,hero-*}-banner.png`, `resource-*.png` (rune-stone + 7 style variants) |
| `resources/buildings/` | `building-pixel-<camelCaseKind>-<level>.png` (+ `-1-alt` plot variant) — the Gemini wave output |
| `resources/units/arena/` | `<unitTypeId>-{idle,attack,move}.png` — glob-registered |
| `resources/units/horse/commander-{1..9}/` | `<variant>-<dir>[-2].png` — glob-registered, 9 variants |
| `resources/units/icons/` | `<unitTypeId>.png` busts — hand-wired in `src/data/unitImages.ts` |
| `resources/factions/` | `faction-banner-<id>.png` — glob-registered |
| `resources/skybox/` | `cityView-background-variant<n>-layer<m>.png` |

`SpriteKey` (`src/render/assetDescriptors.ts:~150`) is the union of ten template
families:

```
castle.${1|2|3} · castle-alt.${…} · castle-alt2.${…} · castle-alt3.${…}
resource.${ResourceType} · resource-cart|illust|constellation|crest|pile|pile-smol|pile-bubbly.${…}
hero.${Faction} · hero.player.${Direction}
horse.${variant}.${Direction}[.2]
building.${style}.${kind}.${level}
unit.${unitTypeId}.${UnitArenaPose}
faction-banner.${FactionId}
```

---

## 3. The usage pipeline (how a key becomes pixels)

### 3.1 Descriptor registry — `src/render/assetDescriptors.ts` (1070 lines)

*Source of truth: `src/render/assetDescriptors.ts` itself (technical-spec §1.1/1.5 is the older description). Where they disagree, the code wins and this summary is stale.*

A `SpriteDescriptor` is `{ key, url, anchor: "bottom"|"center", sizing, naturalSize?, anchorOffsetY? }`
where `sizing` is `abs(size) | fitHeight(hexSizeMul) | fitWidth(hexSizeMul)`.

Descriptor maps and how they are populated:

| Map | Registration | Count | Notes |
|---|---|---|---|
| `CASTLE_DESCRIPTORS`, `CASTLE_ALT{,2,3}_DESCRIPTORS` | hand-written | 12 | `fitHeight` 1.5/2.2/3.0, `anchorOffsetY` 8/16 |
| `RESOURCE_*_DESCRIPTORS` (8 styles) | generated from `RESOURCES` | 48 | per-style `hexSizeMul` varies: 0.9 (default/cart/illust/constellation/crest), 0.95 (pile), 0.475 (smol), 0.71 (bubbly); all `anchor: "center"` |
| `HERO_PLAYER_DESCRIPTORS` | **glob** `units/horse/commander-1/*.png` | 8 dirs (+ frame-2) | `fitHeight` 1.8, `naturalSize` 512 |
| `HORSE_VARIANT_DESCRIPTORS` | **glob** `units/horse/commander-*/*.png`, filtered per `HORSE_VARIANT_REGISTRY` | 9 variants × 4–8 dirs | diagonal→cardinal fallbacks per variant; optional `-2` run frames; bubbly `naturalSize` 64 |
| `BUILDING_DESCRIPTORS` | generated from `BUILDING_SPRITES` | 114 | defaults `anchor:"bottom"`, `anchorOffsetY:-12`, `fitWidth 0.9`, then per-key `BUILDING_ANCHOR_OVERRIDES` |
| `UNIT_ARENA_DESCRIPTORS` | **glob** `units/arena/*.png` | 36 ids × 3 poses (mage gap) | `bottom`, `fitHeight 1.3`, `naturalSize 128` |
| `FACTION_BANNERS` | **glob** `factions/faction-banner-*.png` | 4 | a URL map, not descriptors |

Key helpers: `castleKey(level, variant)` (variant 2/3 supported),
`resourceStyleKey(type, style)` (8 styles), `heroDirectionKey`,
`horseVariantKey(variant, dir, frame?)` (`frame === 1` appends `.2`),
`buildingKey(style, kind, level)`, `unitArenaKey`, `factionBannerKey`.

**The anchor math** (`BUILDING_ANCHOR_OVERRIDES`, 114 rows, one per sprite key)
cancels the universal `anchorOffsetY: -12` default so each sprite's visible base
lands on the cell's south vertex:

```
visibleBase = y + td*0.5 + anchorOffsetY − bottomPad*(sh/dh)   ⇒   anchorOffsetY = bottomPad*(sh/dh)
```

The in-file comment is explicit that `sh = tw*0.9 = 86.4` is "an eyeballed
baseline, not a strict geometric solve", and that the divisor must be the PNG's
**actual canvas height (1024)**, not a nominal 128. The 2×2 `farmField` plots
deliberately use a second convention (`172.8/1024`); everything else uses 86.4.

### 3.2 Provider & source chain — `assets.ts`, `assetSource.ts`

*Source of truth: `src/render/assets.ts` + `src/render/assetSource.ts` (technical-spec §1.3/1.4 omits the `OnDemandSpriteSource`/`ApiSpriteSource`/`VariantAwareSource` classes). Where they disagree, the code wins.*

`createDefaultProvider(HERO_PROCEDURAL_DRAWERS)` (single production call site:
`src/managers/GameEngine.ts:46`) partitions `ALL_DESCRIPTORS`:

1. `castle.*` → **eager** `ImageSpriteSource` (preloaded)
2. everything else URL-backed → `OnDemandSpriteSource` (loads on first resolve;
   first frame after a resolve is `ready: false`)
3. `url === null` → `ProceduralSpriteSource` (4× offscreen canvas, image smoothing off)
4. all three composed by `CompositeSpriteSource`; wrapped by `VariantAwareSource`
   (`settings().spriteVariant`)

`SpriteProvider.resolve(key)` returns `{drawable, descriptor, ready}` or
`undefined`. **`ApiSpriteSource` exists but is wired into nothing** (finding F8).

### 3.3 The painter seam — `paint2d/deps.ts` + `paint2dDefaults.ts`

*Source of truth: `src/render/scene/paint2d/README.md` (boundary contract) over `deps.ts` (interface) and `src/render/paint2dDefaults.ts` (wiring). Where they disagree, the code wins — the README still whitelists the deleted style leaves.*

`paint2d/` must stay importable under bare `node:test` (Node cannot resolve Vite
`?url` PNG specifiers). Therefore it declares `Paint2DDep` — every external
concern is a prop, never an import:

```ts
interface Paint2DSpriteResolver {
  resolveSpriteForResource(resource): ResolvedSprite | undefined
  resolveSpriteForHero(faction, dir, variant, frame?: 0 | 1): …
  resolveSpriteForBuilding(kind, level): …              // hardcodes the "pixel" style
  resolveSpriteForCastle(level, variant): …
  resolveSpriteForUnit(unitTypeId, pose): …             // arena art; undefined until loaded
  resolveSprite(key): …                                 // escape hatch
}
// + SkyboxProvider + decision getters (resourceStyle, spriteVariant, parallax*,
//   bgOffset*, territoryBorderWidth) + colorForOwner + battleAccent + fontFamily + charter styles
```

`src/render/paint2dDefaults.ts` is **the only file allowed to touch
`assetDescriptors.ts` / `assets.ts` / `sprites.ts`** (enforced by dep-cruiser and
the seam test). It:

- wraps every `*Key` constructor (the painter never names a key string),
- implements the **run-frame fallback** (frame 1 → `horse.{v}.{d}.2`, missing →
  base sprite) and `warmHorseRunFrameCache()` (frame sprites are on-demand; the
  warm-up prevents one blank frame),
- owns a **process-lifetime arena provider** (`UNIT_ARENA_DESCRIPTORS` only,
  `ImageSpriteSource`), returning `undefined` until images are ready so the
  battle painter keeps its circle fallback,
- offers `createDefaultPaint2DDep` (async; lazily dynamic-imports `skybox.ts`)
  and `createPaint2DDep` (sync; `MapRenderer` passes `skybox: null`, `CityView`
  holds one provider for the view's life — per-frame rebuild is a documented bug,
  not a style choice).

### 3.4 Scene builders — what to draw

*Source of truth: `src/render/scene/sceneBuilder/{adventure,city,battle}Scene.ts` (line numbers below are as of 2026-10-10 and will drift).*

| Builder | Sprite-relevant decisions |
|---|---|
| `adventureScene.ts` | hero `runFrame` from `hero.moving && floor(moveProgress*2)%2` (:156); bob/scaleY from `moveProgress` (:152–155); per-hero fade `alpha` for non-own sightings (:157, fed by `renderer.ts`'s `heroSpotted` tracker); `caravanMarker` nodes from pre-resolved `opts.caravans` (:134–145), fog-gated like heroes; trail/path own-seat gating |
| `cityScene.ts` | per-building `farmStyle` from engine `farmFieldStyleAt(settlementName, gx, gy)` (:146–148); `constructionStage` from `constructionStageFor(buildingConstructionProgress(b))` (:150–152); painter's-algorithm `gx+gy` sort |
| `battleScene.ts` | `dominantUnitTypeId(entries)` — highest count, first stored wins ties (:91–99); `pose = move \| attack \| idle` from the mover/attacker window (:253); `mirror` for defenders (art authored facing right once, :255); `hexSize` per node |

### 3.5 Painters — `src/render/scene/paint2d/index.ts` (1189 lines, single file + `colors.ts`/`geometry.ts`/`deps.ts`)

*Source of truth: `src/render/scene/paint2d/index.ts` (technical-spec §7.3 describes this layer; its file table still lists the deleted `paint2d/buildings.ts`). Where they disagree, the code wins.*

`paintScene` (:184) switches on `node.kind`; 27 kinds; two are run-batched
(`territoryOutlineEdge` strokes as one path per same-owner run — anti-beading at
`globalAlpha 0.45`; `cityBuilding` bodies then selection rings). Sprite-first
painters: `paintResourceIcon` (:438), `paintCastle` (:445), `paintHero` (:694),
`paintCityResourceSpot` (:826), `paintCityMine` (:857), `paintBattleCombatant`
(:1102), `paintCityBuilding` (:957).

`paintCityBuilding` resolves, in order: `building.pixel.underConstruction.{stage}`
→ `building.{farmStyle}.{kind}.{level}` → `resolveSpriteForBuilding(kind, level)`.
Its `drawCitySpriteInto` (:921) is **sprite-only with no fallback** — "a resolver
miss draws nothing" (the blank-tile bug class that the 2026-10-04 wiring wave
closed for crypt/gunnersRedoubt/worldrootGrove L2).

### 3.6 Entry points

- `MapRenderer.draw()` (`renderer.ts:48`) — background fill, vision, heroSpotted
  fade, `buildAdventureScene`, camera transform + `paintScene`, then the minimap
  outside the transform. Reads entities from an injected `EntityMirror`.
- `drawCityView()` (`cityRenderer.ts:15`) — 28 lines of canvas framing
  (`lineJoin = "miter"`) around one `paintScene` call; owns nothing else.
- The battle arena (`src/screens/combat/arena/paint.ts`, `paintSceneForArena`) —
  same painter, `?paint=legacy` escape hatch.

### 3.7 Settings that steer sprite choice

`src/state/settings.ts`: `resourceStyle` (8 styles), `spriteVariant` (1–5),
`parallaxEnabled`, `parallaxLayerCount`, `cityBgOffsetX/Y`,
`territoryBorderWidth`, `moveDurationMs` / `enemyMoveDurationMs` (per-seat move
pace → run-frame flip rate).

---

## 4. The creation pipelines

### 4.1 Pipeline A — procedural, deterministic, local (no API)

`tools/sprites/pixel-art.html` (13 canvases with hand-coded draw functions) +
`tools/sprites/pixel-gen.mjs` (Playwright → `canvas.toDataURL` → `src/resources/`)
+ `manifest.mjs` (the file registry + `SPRITE_FILES`) + `pixel-gen-pure.mjs`
(pure-Node PNG encoder, no browser) + `generate-preview.mjs` (writes
`sprite-preview.html`). `docs/art-style.md` is the canonical spec — including a
6-step "adding a new resource" recipe that touches `palettes.ts`, `pixel-art.html`
(twice) and `pixel-gen.mjs`. Output: `castle-l*.png`, `resource-*.png`.

### 4.2 Pipeline B — FLUX via DeepInfra (`tools/sprites/flux-*.mjs`, 25 scripts)

One-off scripts (`flux-gen`, `flux-regen`, `flux-regen3`, `flux-piles`,
`flux-pile-smol`, `flux-bubbly`, `flux-buildings`, `flux-buildings-classic-remaining`,
`flux-castles`, `flux-hero-diagonals`, `flux-skybox`, `flux-farmField-*`,
`flux-farm-variant{2..5}`, `flux-house-l1`, `flux-market-{l2,variant2..5}`,
`flux-tower-l2`, `flux-townHall-l2`) each embed their own prompts and the same
post-process: 1024² generate via `https://api.deepinfra.com/v1/inference/black-forest-labs/FLUX-2-klein-4b`
→ Playwright downscale → white→alpha + 2px outline dilation → `src/resources/`.
Requires `DEEPINFRA_API_KEY`. `outline-apply.mjs` is a standalone outline preview
tool. Skybox: `flux-skybox.mjs` (1024×576) → `npm run skybox:split`
(`scripts/split-skybox-layers.ts`) → `src/resources/skybox/`.

### 4.3 Pipeline C — Gemini via OpenRouter (the kilo skill)

`.kilo/skills/building-sprite-gen/SKILL.md` + four scripts:

| Script | Role |
|---|---|
| `gemini-buildings.mjs` | image-in → image-out via `https://openrouter.ai/api/v1/chat/completions`, model `google/gemini-2.5-flash-image`; default style ref `src/resources/buildings/building-pixel-granary-1.png`; writes to `src/resources/buildings/`; warns if the name breaks `building-pixel-<camelCaseName>-<level>.png`; **auto-runs strip + repair**; flags `--name/--prompt/--prompt-file/--ref/--model/--no-strip/--no-repair/--dry-run/--help`; **stores no prompts** (concurrency-safe: agents never edit a shared prompt file) |
| `strip-checkerboard.mjs` | samples the two checker colors from the top border, flood-fills from the borders (enclosed grays survive), erodes grayish neighbors → real alpha, in place |
| `remove-specks.mjs` | connected-component pass; deletes only non-main, ≤600px, low-saturation islands |
| `repair-alpha.mjs` | seals ≤3px transparent seams the stripper over-erodes (the drake commander sprites shattered into 95 fragments), re-opens enclosed background pockets, fills holes above the under-belly line, snaps interior partial alpha; idempotent; **`--check` is a CI-able gate** (exit 1 on defects) |

Skill discipline worth keeping: **always `--dry-run` first** (every generate is a
billed call), write the prompt to a temp file to dodge shell quoting, and verify
visually. The wave record `design/building-pixel-wave/README.md` adds hard-won
prompt knowledge — replace the "transparent background" clause with "plain
uniform solid light-gray background with absolutely no checkerboard pattern
anywhere", and append "no checkerboard pattern anywhere on the canvas" — plus the
full **wiring recipe** (§4.6).

### 4.4 Pipeline D — unit arena art waves (`design/arena-unit-sprites/`)

Per-wave layout: 1024px masters (gitignored by `design/arena-unit-sprites/*-1024/`),
prompt folders (`prompts/`, `pose-prompts/`, `ashen-prompts/`, `ironmark-prompts/`,
`verdant-prompts/`), and 29 one-off helpers (27 top-level + 2 under `pose-fix/`):
`downscale-{icons,poses,one,arena}.mjs`,
`wave3-*`, `{ashen,ironmark,verdant}-downscale-{icons,poses}.mjs`, `crop.mjs`,
`pad-center.mjs`, `edge-dist.mjs`, `fix-erase.mjs`, `flat-color-clean.mjs`,
`icon-hole-fill.mjs`, `scan-light-px.mjs`, `verify-masters.mjs`, `wand-erase.mjs`,
`wave3-{probe-alpha,open-pocket,sample,scrub-floaters}.mjs`,
`ashen-probe-alpha.mjs`, `ironmark-{probe-pockets,measure-bottom-pad}.mjs`,
`pose-fix/{dark-speck,keep-main}.mjs`. Documented acceptance gates (technical-spec
§5.4 + architecture.md): 128×128, fully-transparent 2px ring — "local helper
scripts … not repo tooling". Output drops into `src/resources/units/arena/` or
`icons/`; arena files resolve with **zero descriptor code** via the glob.

### 4.5 Pipeline E — skybox

See §4.2: `flux-skybox.mjs` → `npm run skybox:split` → `src/resources/skybox/`;
only `src/render/skybox.ts` may import them (`?url`).

### 4.6 The wiring step (manual vs automatic)

| Asset family | Wiring |
|---|---|
| `building.pixel.*` | **Generated + glob** (landed 2026-10-10, see §4.8): filename grammar → `packages/engine/src/generated/buildingSpriteKeys.ts` (regenerate with `npm run gen:sprite-keys`) → URLs from one `import.meta.glob`. The measured `BUILDING_ANCHOR_OVERRIDES` row is still hand-written per sprite (finding F2) |
| `unit.<id>.<pose>` | **Automatic** (glob). Pose art for a new catalog id just drops in |
| `horse.<variant>.<dir>` | **Automatic** (glob) for files; a *new variant* needs a `HORSE_VARIANT_REGISTRY` entry (engine) + a `commander-<N>/` folder (+ optional banner in `unitImages`-style maps) |
| `faction-banner.<id>` | **Automatic** (glob); parity test asserts the file exists once a roster ships |
| unit icons | **Manual**: `src/data/unitImages.ts` `KNOWN` map (37 imports), guarded by `test/data/unitIcons.coverage.test.ts` |

The canonical wiring recipe is `design/building-pixel-wave/README.md`: measure
each PNG's transparent bottom-pad rows, `offsetY = round(padRows × 86.4 / 1024)`,
validate the method against known-good anchors first, and never reuse another
sprite's number.

### 4.7 The uncommitted toolbox (`local/`, gitignored)

`local/measure-building-bottom-pad.mjs` (the measurement tool the recipe depends
on), `local/farm-tools/` (`analyze-edges`, `clean-bg`, `inspect-islands`,
`measure-sprite`, `render-preview`, `zoom-preview`), plus prompt caches
(`local/sprite-prompts/`, `local/prompts/`, `local/farm-prompts/`) and wave logs.
**Tooling the documented recipe requires is not in version control.**

### 4.8 Sprite-key codegen (landed 2026-10-10)

The first code generator in this repo. It exists because the building family was
the last hand-wired one, and its two lists were exact duplicates:

```
src/resources/buildings/building-pixel-*.png
        │  filename grammar: building-pixel-<kind>-<level>[-alt].png
        ▼
tools/sprites/gen-building-sprite-keys.mjs        (plain node, no deps)
        │  default: write  ·  --check: drift gate  ·  --dry-run
        ▼
packages/engine/src/generated/buildingSpriteKeys.ts        (committed)
        ├── BUILDING_SPRITE_FILES   key → filename, 106 entries
        ├── BUILDING_SPRITE_ALIASES alias → target key, 8 entries
        │     (legacy `mine` kind → stoneMine art, farmField L2/L3 → L1,
        │      woodcutterHut-3 → -2 art)
        └── BUILDING_SPRITE_KEYS    the union, 114, sorted
        │
        ├── packages/engine/src/styleResolver.ts   imports it (re-exports the name)
        └── src/render/assetDescriptors.ts         resolves each key's URL through
            import.meta.glob("../resources/buildings/building-pixel-*.png")
```

Consequences worth knowing:

- **New sprite = zero code edits** (drop the PNG in, `npm run gen:sprite-keys`).
  `gemini-buildings.mjs` chains the regeneration after each generation
  (`--no-regen-keys` to skip), so the art-wave workflow needs no manual step.
- **Only `building-pixel-*` registers.** The legacy `building-classic-*`,
  `building-blocky-*`, `-raw`, `-variant*` files in the same folder are excluded
  by the glob pattern and the filename grammar, not by an allowlist.
- **`assetDescriptors.ts` lost 106 `?url` imports and the 114-row record**; the
  missing-PNG failure mode those static imports used to give `tsc` is now a
  `console.warn` at module load plus the guard test.
- **The stale two-list duplication (F1) is gone**, but `BUILDING_ANCHOR_OVERRIDES`
  (F2) remains hand-measured — generating keys is not generating anchors.
- The engine's `pickStyleForBuilding` fall-through was made **order-independent**
  in the same change: a sorted key list would otherwise let the `pixel-alt`
  farm-plot art win the fall-through for `farmField`, because
  `"pixel-alt.farmField.1"` sorts before `"pixel.farmField.1"`. The old
  hand-written order avoided it by luck; the docs always claimed the invariant
  and `test/engine/styleResolver.test.ts` pins it.
- Drift gate: `npm run gen:sprite-keys:check` (also run by
  `npm run validate-assets`), plus `test/render/buildingSpriteKeys.test.ts`.

---

## 5. Structural constraints that exist today

| Constraint | Mechanism | Covers |
|---|---|---|
| Layer rules | `dependency-cruiser.cjs` via `npm run lint:deps` | `no-circular` (error), `core/` leaf-only, no `render → systems/screens`, no value-import `state → render/screens`, `screens → managers`, `server → src`, `entities → render/screens`, contracts leaf, engine→contracts only, persistence-repo funnel, `paint2d-cannot-import-asset-descriptors`, `paint2d-cannot-value-import-state` |
| Painter seam | `test/render/paint2d.seam.test.ts` | source-scans `paint2d/` for forbidden imports + `?url` specifiers + settings value-imports, and actually `import()`s the painter under `node:test` |
| Lint-rule regression | `test/render/paint2d.adversarial.test.ts` | writes a probe file that imports `assetDescriptors` from inside `paint2d/` and asserts dep-cruiser fires (caught a real regex bug) |
| Arena art coverage | `test/render/unitArenaDescriptors.test.ts` | FS checks (every catalog id has idle art; every file matches `<id>-<pose>.png` with a known pose/id) + **static source-scan** of `assetDescriptors.ts` (glob, key template, `unitArenaKey`, ALL_DESCRIPTORS aggregation, `bottom`/`1.3`/`128` contract) |
| Icon coverage | `test/data/unitIcons.coverage.test.ts` | every catalog id has a non-empty valid PNG + appears in `unitImages.ts`'s KNOWN map (source-scan) |
| Roster/banner parity | `test/data/unitCatalogParity.test.ts` | rosters ↔ `UNIT_CATALOG_IDS` ↔ `unit_types.faction_id` (DB) + **every shipped faction has a banner file** |
| Legacy manifest + building keys | `npm run validate-assets` → `tools/sprites/validate-assets.mjs` | `SPRITE_FILES` (31 legacy files) exist; horse run-frame alignment (`tune-run-frames.mjs --check`, ≤2px drift); **the generated building-sprite key list is in sync with disk (`gen-building-sprite-keys.mjs --check`)** |
| Pixels | `npm run test:visual` → `tools/run-test.mjs visual` → `test/visualRegression.test.ts` | 9 fixed scenes diffed against `test/visual-baselines/` (`adventure-overview`, `charter-traveling`, `charter-constructing`, `city-view-parallax-on/-off`, plus the 4 battle-arena scenes added with the 2026-09-29 arena sprites); `--update-baselines` script for deliberate churn |
| Pre-commit | `precommit-checker` agent (`.kilo/agents/precommit-checker.md`) | `npm run build` + `lint:deps` + `test:all` |
| Alpha damage | `repair-alpha.mjs --check` | available as a gate but **not wired into any npm script or the precommit gate** |

---

## 6. Findings (the upgrade input)

**Consolidation**

- **F1 — Two identical hand-maintained building-sprite key lists.**
  ~~`BUILDING_SPRITES` (`assetDescriptors.ts`, 114 keys) and
  `BUILDING_SPRITE_KEYS` (`packages/engine/src/styleResolver.ts`, the same 114
  keys) had to stay in sync manually — exact duplicates, i.e. the worst case for
  drift: a key in one but not the other is a blank tile or dead art.~~
  **RESOLVED 2026-10-10** — the repo's first codegen
  (`tools/sprites/gen-building-sprite-keys.mjs` →
  `packages/engine/src/generated/buildingSpriteKeys.ts`) is now the single
  source; the client consumes `BUILDING_SPRITE_FILES`/`BUILDING_SPRITE_ALIASES`
  from `@heroes/engine` and resolves URLs through one glob. Guarded by
  `test/render/buildingSpriteKeys.test.ts` plus `npm run validate-assets`.
- **F2 — The anchor table is hand-measured and half-documented.** 114 rows of
  `BUILDING_ANCHOR_OVERRIDES`, admitted in-file to be "an eyeballed baseline,
  not a strict geometric solve", two formulas in play (86.4 vs farmField's
  172.8), and the measurement tool lives in gitignored `local/`.
- **F3 — `assetDescriptors.ts` had grown to 1070 lines with 167 hand-written
  `?url` imports**, while the same file already proved the glob pattern for three
  families (horse, arena, banners). ~~Buildings were the last hand-wired
  family~~ — **RESOLVED 2026-10-10** by the codegen (§4.8); the building imports
  and the 114-row record are gone. The remaining hand-written volume in that
  file is the anchor table (F2) plus the castle/resource descriptor sets.
- **F4 — `tools/sprites/` holds 34 files**, 25 of them one-off FLUX scripts
  (`flux-farm-variant2..5`, `flux-market-variant2..5`, …) with prompts embedded
  in code and each carrying its own copy of the downscale/outline HTML.
- **F5 — `design/arena-unit-sprites/` holds 29 helper scripts (27 top-level + 2
  under `pose-fix/`) and 5 prompt dirs** with inconsistent naming (`icon-`,
  `idle-`, `pose-`, `styleA/B-`, `wave3-`, `.regen`, `.retry`, `-v3`). The 1024
  masters are gitignored, so reproducibility depends on that scattered prompt
  set being complete.
- **F6 — Documentation drift.** The skill header says "Two project scripts" and
  lists four; technical-spec §5.4 lists three (omits `repair-alpha.mjs`) and its
  file table still lists `cityBuildingDraw.ts` (1392 lines, deleted) and
  `paint2d/buildings.ts` (deleted); `paint2d/README.md` still whitelists the
  deleted style leaves and calls the deps builder "forthcoming"; the
  dep-cruiser rule comment and the seam test still name `cityBuildingDraw`.
- **F7 — Dead legacy draw path.** `sprites.ts`'s `drawCastleSprite` /
  `drawResourceIcon` / `drawHeroSprite` / `drawHorseSprite` have no production
  caller (only `HERO_PROCEDURAL_DRAWERS` is imported, by `GameEngine.ts:3`), and
  `drawWithDescriptor` is implemented twice (`sprites.ts:112` and
  `paint2d/index.ts:120`) with subtly different signatures.
- **F8 — Vestigial machinery.** `ApiSpriteSource` is wired into nothing;
  `VariantAwareSource`'s `_variant${n}` key protocol matches no descriptor
  (`castleKey` handles variants instead); `castle-alt2/alt3` alias rows exist
  only to keep L2/L3 keys resolvable.

**Structural constraints that are missing**

- **F9 — `validate-assets` covers only the 31-file legacy manifest.** Nothing
  cross-checks `BUILDING_SPRITES` keys ↔ files on disk ↔ engine keys; the
  arena/icon/banner guards are bespoke per-family tests rather than one shared
  "registry ↔ disk" gate.
- **F10 — No exhaustiveness constraint for buildings.** `BuildingKind` (36) ×
  levels 1–3 has no compile-time or test-time completeness requirement; the
  blank-tile bug class (crypt-2 / gunnersRedoubt-2 / worldrootGrove-2) is
  exactly this gap. Since drawing is now sprite-only, a missing key is a
  visible hole.
- **F11 — Icon wiring is hand-maintained** (`unitImages.ts`, 37 imports) even
  though `icons/` follows the same `<id>.png` convention the arena glob uses.
- **F12 — No provenance index.** Asset → prompt → script invocation is not
  recorded anywhere committed; prompts are split across five `design/` folders
  and gitignored `local/`.
- **F13 — The alpha/run-frame gates aren't in the standard gate.**
  `repair-alpha.mjs --check` and `tune-run-frames.mjs --check` are powerful
  CI-able gates, but only the latter runs (inside `validate-assets`), and
  `validate-assets` itself is not part of `test:all` / the precommit-checker
  flow.

### Suggested upgrade directions (not implemented)

1. ~~**Single source of truth for building sprites**: make `BUILDING_SPRITES`
   glob-driven and derive the engine's `BUILDING_SPRITE_KEYS` from it, with a
   parity test (F1, F3).~~ **DONE 2026-10-10** — codegen landed; see §4.8.
2. **Computed anchors**: move `BUILDING_ANCHOR_OVERRIDES` to a generated table
   produced by a committed measurement script (promote `local/measure-building-bottom-pad.mjs`
   into `tools/sprites/`), with the 2×2 farmField convention as the documented
   default (F2).
3. **One post-process module**: factor the shared strip/repair/specks/outline
   passes into a single `tools/sprites/postprocess.mjs` used by the skill, the
   FLUX scripts, and the wave downscalers (F4, F5).
4. **One prompt registry**: consolidate `design/**/prompts` + `local/*prompts*`
   into `design/sprites/prompts/<family>/<asset>.txt` with a naming convention
   and an index (F12).
5. **One shared registry↔disk gate**: a single `npm run validate-assets`
   extension that walks every family (buildings, arena, icons, banners, horse
   frames) and cross-checks keys ↔ files ↔ (engine list), plus wire
   `repair-alpha --check` into `test:all` (F9, F13).
6. **Compile-enforced building completeness**: an exhaustive
   `Record<BuildingKind, Record<1|2|3, string>>` (or a test) so a missing level
   fails the build (F10).
7. **Delete the dead path**: retire `sprites.ts`'s draw helpers to one
   `drawWithDescriptor` implementation (F7), and drop `ApiSpriteSource` /
   `VariantAwareSource` or give them real callers (F8).
8. **Doc refresh** as part of any of the above: SKILL.md header count,
   technical-spec §5.4 + file table, `paint2d/README.md` (F6).

---

## 7. Appendix — file quick reference

| Path | Role |
|---|---|
| `src/render/assetDescriptors.ts` | keys, descriptors, globs, `BUILDING_SPRITES` (glob-resolved), `BUILDING_ANCHOR_OVERRIDES` |
| `src/render/assets.ts`, `assetSource.ts` | `SpriteProvider` + source chain |
| `src/render/paint2dDefaults.ts` | the only legal bridge to the Vite-`?url` layer; run-frame + arena resolvers |
| `src/render/scene/paint2d/{index,deps,colors,geometry}.ts` | painter (single-file dispatcher) |
| `src/render/scene/sceneBuilder/{adventure,city,battle}Scene.ts` | scene decisions |
| `src/render/renderer.ts`, `cityRenderer.ts`, `src/screens/combat/arena/paint.ts` | entry points |
| `src/state/settings.ts` | user-facing sprite/style settings |
| `src/data/unitImages.ts` | unit icon wiring (hand-maintained) |
| `packages/engine/src/generated/buildingSpriteKeys.ts` | **generated** building-sprite keys (`BUILDING_SPRITE_FILES` / `_ALIASES` / `BUILDING_SPRITE_KEYS`) |
| `tools/sprites/gen-building-sprite-keys.mjs` | the codegen: `npm run gen:sprite-keys` / `:check` |
| `packages/engine/src/styleResolver.ts` | consumes the generated list; `pickStyleForBuilding` (order-independent fall-through), `farmFieldStyleAt` |
| `.kilo/skills/building-sprite-gen/` | skill + 4 Gemini/alpha scripts (auto-regenerates keys) |
| `tools/sprites/` (35 files) | procedural gen, FLUX scripts, the key codegen, validation, run-frame tuning |
| `design/arena-unit-sprites/`, `design/building-pixel-wave/` | wave masters/prompts/helpers, wiring recipe |
| `local/` (gitignored) | measurement + probe tools, prompt caches, logs |
| `dependency-cruiser.cjs`, `test/render/paint2d.*.test.ts` | structural constraints |
| `test/data/unitIcons.coverage.test.ts`, `unitCatalogParity.test.ts`, `test/helpers/unitIds.ts` | coverage guards |
| `test/render/buildingSpriteKeys.test.ts` | generated-keys ↔ disk ↔ engine parity + no-hand-wired-imports scan |
| `test/visualRegression.test.ts`, `test/visual-baselines/` | pixel gate |
| `docs/art-style.md` | canonical art direction + procedural extend recipe |
| `src/render/docs/technical-spec.md` | render-module spec (partly stale — F6) |
