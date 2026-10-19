# Sprite Pipelines — Deep Dive (Usage + Creation)

<!-- docs:verified 2026-10-16 -->

**Status:** Maintained as-built deep dive, updated 2026-10-14. It maps sprite
assets from creation tools to rendered pixels and tracks findings F1–F13 with
their current resolution status. Code and `npm run validate-assets` are the
source of truth.

**Current source note:** The former city-building draw/generation modules and style folder are absent. `cityRenderer.ts` remains the
thin wrapper; city decisions are in `sceneBuilder/cityScene.ts`, and per-kind
painting (including city buildings) is in `scene/paint2d/index.ts`. Pixel
buildings are sprite-only; a missing pixel key draws nothing. The remaining
building-style metadata cleanup is tracked separately from rendering.

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
- **Creation pipelines**: procedural canvas, FLUX/DeepInfra, Gemini/OpenRouter
  (`building-sprite-gen` skill), unit-art waves, and skybox assets. Pixel building
  keys and anchor offsets are generated with drift checks; the exhaustive
  per-kind/per-level coverage declaration remains manual and is guarded by a
  compile-time type plus a unit test. Other families retain their own glob or
  test-based coverage rules.

---

## 2. Asset inventory & key namespaces

Files live under `src/resources/` (`tools/sprites/manifest.mjs:1` names the root
`ASSETS_DIR`):

| Folder | Contents |
|---|---|
| `resources/` (root) | `castle-l{1,2,3}.png`, `castle-l{1,2,3}-alt{,2,3}.png`, `{settlement,city,castle}-banner.png`, `hero-banner-<id>.png`, `resource-*.png` (rune-stone + 7 style variants) |
| `resources/buildings/` | `building-pixel-<camelCaseKind>-<level>.png` (+ `-1-alt` plot variant) — the Gemini wave output |
| `resources/units/arena/` | `<unitTypeId>-{idle,attack,move}.png` — glob-registered |
| `resources/units/horse/commander-{1..14}/` | `<variant>-<dir>[-2].png` — glob-registered, 14 variants |
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

### 3.1 Descriptor registry — `src/render/assetDescriptors.ts`

*Source of truth: `src/render/assetDescriptors.ts` itself (technical-spec §1.1/1.5 is the older description). Where they disagree, the code wins and this summary is stale.*

A `SpriteDescriptor` is `{ key, url, anchor: "bottom"|"center", sizing, naturalSize?, anchorOffsetY? }`
where `sizing` is `abs(size) | fitHeight(hexSizeMul) | fitWidth(hexSizeMul)`.

Descriptor maps and how they are populated:

| Map | Registration | Count | Notes |
|---|---|---|---|
| `CASTLE_DESCRIPTORS`, `CASTLE_ALT{,2,3}_DESCRIPTORS` | hand-written | 12 | `fitHeight` 1.5/2.2/3.0, `anchorOffsetY` 8/16 |
| `RESOURCE_*_DESCRIPTORS` (8 styles) | generated from `RESOURCES` | 48 | per-style `hexSizeMul` varies: 0.9 (default/cart/illust/constellation/crest), 0.95 (pile), 0.475 (smol), 0.71 (bubbly); all `anchor: "center"` |
| `HERO_PLAYER_DESCRIPTORS` | **glob** `units/horse/commander-1/*.png` | 8 dirs (+ frame-2) | `fitHeight` 1.8, `naturalSize` 512 |
| `HORSE_VARIANT_DESCRIPTORS` | **glob** `units/horse/commander-*/*.png`, filtered per `HORSE_VARIANT_REGISTRY` | 14 variants × 4–8 dirs | diagonal→cardinal fallbacks per variant; optional `-2` run frames; bubbly `naturalSize` 64 |
| `BUILDING_DESCRIPTORS` | generated building keys + glob-resolved files | 114 | bottom-anchored pixel assets; offsets come from the generated anchor map |
| `UNIT_ARENA_DESCRIPTORS` | **glob** `units/arena/*.png` | 36 ids × 3 poses (mage gap) | `bottom`, `fitHeight 1.3`, `naturalSize 128` |
| `CARAVAN_DESCRIPTORS` | hand-written legacy pair (`caravan-supply.png`, `caravan-treasury.png`) + **glob** `caravans/{supply,treasury}-<dir>.png` | 2 legacy + 16 directional | `bottom`, `fitHeight 1.45`, `naturalSize 256`; legacy pair stays eager (logistics modal `<img>`), directional sprites load on demand like horse variants |
| `FACTION_BANNERS` | **glob** `factions/faction-banner-*.png` | 4 | a URL map, not descriptors |

Key helpers: `castleKey(level, variant)` (variant 2/3 supported),
`resourceStyleKey(type, style)` (8 styles), `heroDirectionKey`,
`horseVariantKey(variant, dir, frame?)` (`frame === 1` appends `.2`),
`buildingKey(style, kind, level)`, `unitArenaKey`, `factionBannerKey`,
`caravanKey(kind, dir?)` (omitting `dir` returns the legacy pair's key).

**Generated anchor map:** `tools/sprites/gen-building-anchors.mjs` reads each PNG's alpha bounds and emits 114 offsets to `src/render/generated/buildingAnchorOverrides.ts`. It uses the actual canvas height (1024) and a separate 2×2 footprint scale for `farmField`. Run `npm run gen:building-anchors:check` to detect drift; do not hand-edit the generated map.

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

*Source of truth: `src/render/scene/paint2d/README.md` (boundary contract) over `deps.ts` (interface) and `src/render/paint2dDefaults.ts` (wiring). The README boundary contract was refreshed on 2026-10-11 to match the current painter seam.*

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

*Source of truth: `src/render/scene/paint2d/index.ts` (technical-spec §7.3 describes the painter). Where they disagree, current source wins.*

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

`tools/sprites/gen-shipyard-sprite.mjs` is the same idea applied to a
**building**: it rasterises `building-pixel-shipyard-{1,2,3}.png` (64×64 logical
pixels, 16× nearest-neighbour upscale, dark-outline/mid/highlight ramps) with
its own pure-Node PNG encoder and no browser, no API. It exists because every
other `building-pixel-*` sprite came from an illustrated pipeline whose output
cannot be reproduced from source, and the shipyard needs the registry's normal
treatment: `npm run gen:sprite-keys` (key map) + `npm run gen:building-anchors`
(measured bottom pad) pick it up like any other sprite. Verify on disk with
`node tools/sprites/gen-shipyard-sprite.mjs --check`; the output is byte-stable,
so a re-run is a no-op.

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

`tools/sprites/gen-caravan-sprites.mjs` is the image-in variant of the same
pipeline: it sends the existing caravan PNG as a reference and asks FLUX-2-klein
to redraw it from six camera headings (e, s, sw, w, nw, n), so the wagon, horse,
cargo and palette stay recognisably the same sprite across views. `se` and `ne`
are then written as exact horizontal mirrors of `sw`/`nw` — mirroring the
isometric image is geometrically the opposite diagonal, and FLUX produced the
rear-quarter views cleanly but would not reliably rotate a connected horse+cart
further. Masters land in `design/caravan-directions/masters/` (generated
headings only); one Playwright pass trims, removes the flat gray
background/ground shadow with a border flood-fill, downscales the six by one
shared factor, and writes the two mirrored files. Re-run the post-pass without
API calls with `--process-only`.

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

`tools/sprites/gemini-hero-sprite.mjs` (2026-10-18, first used for `paladin2`) is
the mounted-hero counterpart: image-in → image-out with the existing variant's
per-direction sprite as the pose/style reference, then a border-connected flood
fill of the model's flat grey background (only background connected to the canvas
edge is cleared, so a silver-white mane or steel armour survives), a soft 2px
boundary matte, and a trim/resize that copies the **reference sprite's** alpha
bounding box — same content height, same bottom edge, same centre x on the 512²
canvas — so a generated variant slots into `commander-<N>/` with the original's
framing instead of the model's. `--kind banner` cover-crops to the 320×100 roster
banner. Prompts, reference hashes and per-file bounds live with the wave
(`design/hero-variants/<id>/`), which is what `docs/asset-provenance.md` asks a
new art wave to commit.

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
| `building.pixel.*` | **Generated + glob**: filename grammar → `packages/engine/src/generated/buildingSpriteKeys.ts`; alpha bounds → `src/render/generated/buildingAnchorOverrides.ts`. Key/anchor drift is checked by `npm run validate-assets`; per-kind/per-level expected coverage remains manual and unit-tested. |
| `unit.<id>.<pose>` | **Automatic** (glob). Pose art for a new catalog id just drops in |
| `horse.<variant>.<dir>` | **Automatic** (glob) for files; a *new variant* needs a `HORSE_VARIANT_REGISTRY` entry (engine), the contracts `HorseVariantId` literal, a `commander-<N>/` folder, and a `hero-banner-<id>.png` with its `HERO_BANNERS` import + entry; optional `-2` run frames |
| `caravan.<kind>.<dir>` | **Automatic** (glob) over `caravans/supply-<dir>.png` / `caravans/treasury-<dir>.png`; regenerate art with `tools/sprites/gen-caravan-sprites.mjs`. Missing directions fall back to the nearest diagonal |
| `faction-banner.<id>` | **Automatic** (glob); parity test asserts the file exists once a roster ships |
| unit icons | **Manual**: `src/data/unitImages.ts` `KNOWN` map (37 imports), guarded by `test/data/unitIcons.coverage.test.ts` |

The current anchor recipe is `tools/sprites/gen-building-anchors.mjs`, which
computes offsets from image alpha bounds and distinguishes 1×1 from `farmField`'s
2×2 footprint. [`design/building-pixel-wave/README.md`](../design/building-pixel-wave/README.md)
preserves the original manual measurement workflow.

### 4.7 The uncommitted toolbox (`local/`, gitignored)

`local/measure-building-bottom-pad.mjs` (the old manual measurement tool; no
longer required by the generated anchor workflow), `local/farm-tools/` (`analyze-edges`, `clean-bg`, `inspect-islands`,
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
- **`assetDescriptors.ts` lost 106 `?url` imports and the generated key list**; the
  missing-PNG failure mode those static imports used to give `tsc` is now a
  `console.warn` at module load plus the guard test.
- **The stale two-list duplication (F1) is gone**, and F2's hand-measured anchor
  table was replaced by generated alpha-bound offsets; see §4.9.
- The engine's `pickStyleForBuilding` fall-through was made **order-independent**
  in the same change: a sorted key list would otherwise let the `pixel-alt`
  farm-plot art win the fall-through for `farmField`, because
  `"pixel-alt.farmField.1"` sorts before `"pixel.farmField.1"`. The old
  hand-written order avoided it by luck; the docs always claimed the invariant
  and `test/engine/styleResolver.test.ts` pins it.
- Drift gate: `npm run gen:sprite-keys:check` (also run by
  `npm run validate-assets`), plus `test/render/buildingSpriteKeys.test.ts`.

### 4.9 Anchor codegen and exhaustive building coverage (2026-10-11)

`tools/sprites/gen-building-anchors.mjs` scans `building-pixel-*.png` alpha
bounds and writes the sorted 114-key
`src/render/generated/buildingAnchorOverrides.ts`. `npm run
gen:building-anchors:check` compares the generated values with the checked-in
file. The `farmField` 2×2 plots use their own footprint scale; all other pixel
buildings use the 1×1 scale.

This codegen does not replace the manual coverage declaration:
`packages/engine/src/buildingSpriteCoverage.ts` is an exhaustive
`Record<BuildingKind, ...>` for levels 1–3, including a reason for every
deliberately absent level. A missing BuildingKind therefore fails the type
check, and `test/engine/buildingSpriteCoverage.test.ts` verifies declared keys
against generated keys. `npm run validate-assets` checks key/anchor drift plus
the legacy manifest and horse-frame gates; the BuildingKind coverage test runs
separately in `npm run test:unit`.

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
| Asset drift gates | `npm run validate-assets` → `tools/sprites/validate-assets.mjs` | 31 legacy manifest files exist; generated building keys and anchors match disk; horse run-frame base/existence/alignment checks pass |
| Building-kind sprite coverage | `test/engine/buildingSpriteCoverage.test.ts` in `npm run test:unit` | Exhaustive manual `Record<BuildingKind, levels 1–3>` declarations match generated keys; intentional absences require reasons |
| Pixels | `npm run test:visual` → `tools/run-test.mjs visual` → `test/visualRegression.test.ts` | 9 fixed scenes diffed against `test/visual-baselines/` (`adventure-overview`, `charter-traveling`, `charter-constructing`, `city-view-parallax-on/-off`, plus the 4 battle-arena scenes added with the 2026-09-29 arena sprites); `--update-baselines` script for deliberate churn |
| Pre-commit | `precommit-checker` agent (`.kilo/agent/precommit-checker.md`) | `npm run build` + `lint:deps` + `docs:check` (selective, scoped to changed modules) + `test:all` |
| Alpha damage | `repair-alpha.mjs --check` | available as a gate but **not wired into any npm script or the precommit gate** |

---

## 6. Findings (the upgrade input)

F4/F5 retain 2026-10-10 inventory counts as historical snapshots; the status below records which structural gaps have since closed.

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
- **F2 — The anchor table was hand-measured and half-documented. RESOLVED 2026-10-11.**
  `gen-building-anchors.mjs` now generates all 114 alpha-bound offsets into
  `src/render/generated/buildingAnchorOverrides.ts`; `--check` detects drift.
  The 1×1 and `farmField` 2×2 conventions are documented in §4.9.
- **F3 — Building registration was hand-wired. RESOLVED 2026-10-10/11.**
  Building keys and anchor offsets are now code-generated; `assetDescriptors.ts`
  resolves the files through one glob. Castle/resource descriptors and unit-icon
  `KNOWN` wiring remain separate registries.
- **F4 — `tools/sprites/` holds 34 files**, 25 of them one-off FLUX scripts
  (`flux-farm-variant2..5`, `flux-market-variant2..5`, …) with prompts embedded
  in code and each carrying its own copy of the downscale/outline HTML.
- **F5 — `design/arena-unit-sprites/` holds 29 helper scripts (27 top-level + 2
  under `pose-fix/`) and 5 prompt dirs** with inconsistent naming (`icon-`,
  `idle-`, `pose-`, `styleA/B-`, `wave3-`, `.regen`, `.retry`, `-v3`). The 1024
  masters are gitignored, so reproducibility depends on that scattered prompt
  set being complete.
- **F6 — Documentation drift. RESOLVED 2026-10-11.** The render technical spec,
  paint2d boundary README, this pipeline map, and the docs catalog now describe
  the current scene/painter and generated-key/anchor paths; obsolete render paths
  are explicitly labeled as historical.
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

- **F9 — Asset checks are split across generators and tests. PARTIALLY RESOLVED.**
  `validate-assets` now checks the legacy manifest, generated building-key drift,
  generated anchor drift, and horse-frame alignment. Separate unit tests guard
  building completeness and arena/icon/banner parity; there is not yet one
  registry-to-disk walk covering every asset family.
- **F10 — No exhaustiveness constraint for buildings. RESOLVED 2026-10-11.**
  `packages/engine/src/buildingSpriteCoverage.ts` is an exhaustive per-kind,
  levels 1–3 `Record`; intentional gaps require a reason. Its unit test checks
  the declared keys against generated keys, closing the blank-tile bug class.
- **F11 — Icon wiring is hand-maintained** (`unitImages.ts`, 37 imports) even
  though `icons/` follows the same `<id>.png` convention the arena glob uses.
- **F12 — Per-asset provenance is incomplete. PARTIALLY ADDRESSED.**
  [`asset-provenance.md`](./asset-provenance.md) indexes the committed workflows
  and records the metadata future assets should carry. Existing files still lack
  a complete committed asset → prompt → model/request/seed record; no missing
  historical metadata is inferred.
- **F13 — The alpha/run-frame gates aren't in the standard gate.**
  `repair-alpha.mjs --check` and `tune-run-frames.mjs --check` are powerful
  CI-able gates, but only the latter runs (inside `validate-assets`), and
  `validate-assets` itself is not part of `test:all` / the precommit-checker
  flow.

### Suggested upgrade directions (not implemented)

1. ~~**Single source of truth for building sprites**: make `BUILDING_SPRITES`
   glob-driven and derive the engine's `BUILDING_SPRITE_KEYS` from it, with a
   parity test (F1, F3).~~ **DONE 2026-10-10** — codegen landed; see §4.8.
2. ~~**Computed anchors**: generate the anchor map from image alpha bounds and
   document the 2×2 farmField convention (F2).~~ **DONE 2026-10-11** — see §4.9.
3. **One post-process module**: factor the shared strip/repair/specks/outline
   passes into a single shared post-process helper used by the skill, the
   FLUX scripts, and the wave downscalers (F4, F5).
4. **One prompt registry**: consolidate `design/**/prompts` + `local/*prompts*`
   into `design/sprites/prompts/<family>/<asset>.txt` with a naming convention
   and an index (F12).
5. **One shared registry↔disk gate** remains a follow-up: the building family
   has generated key/anchor checks, while arena/icons/banners use focused tests;
   `repair-alpha --check` is still outside the standard gate (F9, F13).
6. ~~**Compile-enforced building completeness** (F10).~~ **DONE 2026-10-11** —
   `buildingSpriteCoverage.ts` plus `test/engine/buildingSpriteCoverage.test.ts`.
7. **Delete the dead path**: retire `sprites.ts`'s draw helpers to one
   `drawWithDescriptor` implementation (F7), and drop `ApiSpriteSource` /
   `VariantAwareSource` or give them real callers (F8).
8. ~~**Doc refresh** for current codegen and painter paths (F6).~~ **DONE 2026-10-11** —
   see the render spec, paint2d README, and this page.

---

## 7. Appendix — file quick reference

| Path | Role |
|---|---|
| `src/render/assetDescriptors.ts` | keys, descriptors, asset globs, generated building key/anchor imports |
| `src/render/assets.ts`, `assetSource.ts` | `SpriteProvider` + source chain |
| `src/render/paint2dDefaults.ts` | the only legal bridge to the Vite-`?url` layer; run-frame + arena resolvers |
| `src/render/scene/paint2d/{index,deps,colors,geometry}.ts` | painter (single-file dispatcher) |
| `src/render/scene/sceneBuilder/{adventure,city,battle}Scene.ts` | scene decisions |
| `src/render/generated/buildingAnchorOverrides.ts` | generated 114-key alpha-bound building anchor map |
| `src/render/renderer.ts`, `cityRenderer.ts`, `src/screens/combat/arena/paint.ts` | entry points |
| `src/state/settings.ts` | user-facing sprite/style settings |
| `src/data/unitImages.ts` | unit icon wiring (hand-maintained) |
| `packages/engine/src/generated/buildingSpriteKeys.ts` | **generated** building-sprite keys (`BUILDING_SPRITE_FILES` / `_ALIASES` / `BUILDING_SPRITE_KEYS`) |
| `tools/sprites/gen-building-sprite-keys.mjs` | the codegen: `npm run gen:sprite-keys` / `:check` |
| `tools/sprites/gen-building-anchors.mjs` | generated alpha-bound offsets: `npm run gen:building-anchors` / `:check` |
| `packages/engine/src/styleResolver.ts` | consumes the generated list; `pickStyleForBuilding` (order-independent fall-through), `farmFieldStyleAt` |
| `packages/engine/src/buildingSpriteCoverage.ts` | exhaustive manual per-kind/level key declaration; separate unit-test coverage gate |
| `.kilo/skills/building-sprite-gen/` | skill + 4 Gemini/alpha scripts (auto-regenerates keys) |
| `tools/sprites/` | procedural/FLUX helpers, the Gemini hero-variant generator (`gemini-hero-sprite.mjs`), building key and anchor generators, validation, run-frame tuning |
| `design/hero-variants/<id>/` | committed prompt files, reference hashes and per-file alpha bounds for a generated hero variant (1024² masters gitignored) |
| `design/arena-unit-sprites/`, `design/building-pixel-wave/` | wave masters/prompts/helpers, wiring recipe |
| `local/` (gitignored) | historical measurement/probe tools, prompt caches, and logs; not required by current anchor codegen |
| `dependency-cruiser.cjs`, `test/render/paint2d.*.test.ts` | structural constraints |
| `test/data/unitIcons.coverage.test.ts`, `unitCatalogParity.test.ts`, `test/helpers/unitIds.ts` | coverage guards |
| `test/render/buildingSpriteKeys.test.ts` | generated-keys ↔ disk ↔ engine parity + no-hand-wired-imports scan |
| `test/visualRegression.test.ts`, `test/visual-baselines/` | pixel gate |
| `docs/art-style.md` | canonical art direction + procedural extend recipe |
| `src/render/docs/technical-spec.md` | maintained render-module specification |
