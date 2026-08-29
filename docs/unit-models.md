# Unit Models (3D → sprite pipeline)

Units are authored as **procedural 3D models in TypeScript** and rendered **offline** into the 8-direction PNG sprite sets the existing 2D canvas renderer already understands. There is no 3D dependency and no WebGL at runtime — the game stays a `getContext("2d")` canvas app.

```
tools/models/units/archer.ts     3D geometry + animations (source of truth)
        │  npm run models:build
        ▼
src/resources/units/archer/      still/archer-<dir>.png, anim/…, manifest.json
        │  globbed by assetDescriptors.ts
        ▼
the battle arena                 (both paint paths — see "How it reaches the screen")
```

## Commands

```bash
npm run models:build
```

| Script | What it does |
|---|---|
| `npm run models:build` | Renders every direction + animation to `src/resources/units/<id>/` |
| `npm run models:preview` | Writes a contact sheet to `tools/models/previews/<id>-preview.png` (git-ignored) for eyeballing all output at once |
| `npm run models:check` | Typechecks `tools/models` (it is outside the app `tsconfig.json`, like `scripts/`) |

Build flags: `--model <id>` (default `archer`), `--size <px>` (default 128), `--ss <n>` supersample factor (default 4), `--padding <px>` (default 6), `--out <dir>`.

Render a big version somewhere scratch when you are tuning a pose:

```bash
npx tsx tools/models/build.ts --size 320 --out /tmp/archer-hi
```

## The camera matches the game's grid

The projection is derived from `src/core/cityGrid.ts`, not guessed. That file maps a cell to screen as `x = (gx - gy) * TILE_W/2`, `y = (gx + gy) * TILE_D/2` with `TILE_D = TILE_W * 0.5` — a 2:1 isometric, i.e. **45° yaw, 30° elevation**. `tools/models/render.ts` uses exactly that, so a model rendered here drops onto the existing iso grid without a fudge factor.

Model space is **+x forward (facing), +y to the model's left, +z up**, origin at the feet. Direction sprites are produced by yawing the model about z; `se` is yaw 0 because grid `+x` projects to screen down-right.

## Authoring a model

A model is a tree of boxes. Each part is a joint:

- `pivot` — joint position in the **parent's** frame
- `rotation` — euler XYZ (radians) about that pivot; order is Z·Y·X
- `offset` — box centre relative to the joint
- `size` — box dimensions
- `children` — nested parts, which inherit the joint frame

A part with `size: [0, 0, 0]` is a **pure joint** and draws nothing — `bowGrip` on the archer uses this to cancel the arm's rotation so the bow's local frame is upright and independent of how the arm swings.

Animations are **additive deltas** on the rest pose, keyed by part name:

```ts
{
  name: "draw",
  frames: 8,
  loop: false,
  tracks: {
    stringUpper: [{ t: 0, rotation: [0, 0, 0] }, { t: 1, rotation: [0, 0.726, 0] }],
    arrow:       [{ t: 0, offset:   [0, 0, 0] }, { t: 1, offset:   [-0.32, 0, 0] }],
  },
}
```

`t` runs 0→1. Looping animations wrap the last keyframe back to the first, so don't duplicate a frame at `t: 1`. Because tracks are deltas, changing a rest pose does not invalidate the animations built on it — but it does move where they end up, so re-check the contact sheet after editing rest rotations.

## Output

Per model, in `src/resources/units/<id>/`:

| File | Contents |
|---|---|
| `still/<id>-<dir>.png` | Single still, rest pose, one per direction (8) |
| `anim/<id>-<anim>-<dir>.png` | Horizontal strip, one cell per frame |
| `manifest.json` | Frame size, direction list, and per-animation frame count / loop flag |
| `tools/models/previews/<id>-preview.png` | Contact sheet — git-ignored, regenerate with `models:preview` |

`still/` and `anim/` are separate directories on purpose: `assetDescriptors.ts`
globs `units/*/still/*.png`, and a glob wide enough to catch the strips would
bundle all 24 of them (plus the preview sheet) into the build for nothing.

All output shares **one fit transform** computed across every direction and every frame of the `idle` and `draw` animations, so the figure never jitters or rescales between frames or facings. That transform is horizontally centred but **vertically bottom-aligned**: the lowest drawn pixel lands at a fixed inset from the frame bottom in every direction. Centring instead leaves a per-direction amount of dead space under the feet (13–17px at 128px for the archer), which reads as the unit hovering above its hex once the painter bottom-anchors it. `loose` is deliberately excluded from that fit — the arrow flies out of frame, and letting it drive the fit would shrink every other sprite. Each frame is clipped to its own strip cell, so a departing arrow leaves the cell instead of bleeding into the neighbouring frame.

## Archer

`tools/models/units/archer.ts` — hooded ranger, nocked-and-ready rest pose, with `idle` (8f, loops), `draw` (8f), and `loose` (5f). The right hand sits on the string in the rest pose; the draw pose rotations were solved so the draw hand tracks the nock as the string pulls back 0.32 units into a V.

## How it reaches the screen

The manual battle arena has **two paint paths**, and both draw unit sprites — they have to stay in step, because `?paint=scenebuilder` swaps between them:

| | Path | Combatant drawing |
|---|---|---|
| default | `drawLegacy()` in `openManualBattleArena.ts` | inline |
| `?paint=scenebuilder` | `buildBattleScene()` → `paintScene()` | `paintBattleCombatant()` in `paint2d/index.ts` |

Both consult `resolveUnitSprite(unitTypeId, facing)` and both **fall back to the old coloured disc** when it returns nothing — which is what every unit except the archer does today, and what the archer itself does for the frame or two before its PNG finishes decoding.

The chain:

1. `assetDescriptors.ts` globs `units/*/still/*.png` into `UNIT_DESCRIPTORS`, keyed `unit.<unitTypeId>.<dir>` via `unitKey()`.
2. `src/render/unitSprites.ts` owns a lazy `SpriteProvider` over just those descriptors and exposes `resolveUnitSprite()` plus `createArenaSpriteResolver()`.
3. `openManualBattleArena.ts` — the browser entry point — injects that resolver into `buildArenaPaint2dDeps({ sprite })` and uses it directly in `drawLegacy()`.

**The injection is not optional styling.** `src/screens/combat/arena/paint.ts` is imported by `test/screens/combat/arena.test.ts` under plain `node:test`, so it can never import the Vite-`?url`-coupled asset modules itself — Node has no loader for `.png` specifiers outside Vite. Its `sprite` option defaults to the old inert resolver so that test keeps passing; only the browser caller supplies a real one. The `paint2d-cannot-import-asset-descriptors` dependency-cruiser rule enforces the same boundary (`npm run lint:deps`).

### Facing

`BattleCombatantNode` carries `unitTypeId` (the platoon's majority entry) and `facing`. Facing is computed from **live positions** — each side looks at the opposing side's mean `q` — not from `side`. `deploymentPosition()` puts whichever side matches `sideChoice` on column 0 and the other on the last column, and the scene builder is never told what `sideChoice` was, so keying off `side` would point half the armies backwards. Combat runs left↔right, so only `e` and `w` are ever requested; the other six directions are generated and ready for a unit that needs them.

## Not done yet

The `anim/` strips are generated but nothing plays them. Wiring them needs two things that don't exist yet: sub-rect (sprite-sheet) drawing in `drawWithDescriptor()`, which currently blits a whole image, and a hook from the arena's attack/move events to an animation clock. `idle` is the cheap first one — it is purely time-based and needs no game events.

The original `src/resources/units/archer.png` is untouched, and `src/data/unitImages.ts` still uses it for the 64×64 roster icons — the generated set is battlefield art and lives alongside it in `src/resources/units/archer/`.

## Change log

### 2026-08-29 — pipeline + archer + arena wiring

Built the 3D→sprite pipeline, the archer model, and the render wiring, on branch `claude/archer-unit-models-807294`.

**New — the pipeline** (`tools/models/`, run under `tsx`, outside the app tsconfig like `scripts/`):

| File | Role |
|---|---|
| `math.ts` | mat4 / vec3 helpers |
| `types.ts` | `ModelDef`, `BoxPart`, `Animation`, direction table |
| `pose.ts` | evaluates the rig + animation deltas into world-space quads |
| `render.ts` | iso projection, fit solver, z-buffered software rasteriser |
| `build.ts` | CLI → PNGs + `manifest.json` |
| `preview.ts` | contact sheet |
| `units/archer.ts` | the archer model |

No runtime 3D dependency was added. The rasteriser is plain TypeScript; `sharp` (already a devDependency) only writes the PNGs.

**New — the wiring:** `src/render/unitSprites.ts`, plus `UNIT_DESCRIPTORS` / `unitKey()` / `hasUnitSprite()` in `assetDescriptors.ts`.

**Changed:** `deps.ts` gained `resolveSpriteForUnit` + the `UnitFacing` type (and its three implementors — `paint2dDefaults.ts`, `arena/paint.ts`, `test/render/_helpers.ts`); `BattleCombatantNode` gained `unitTypeId` + `facing`; `battleScene.ts` populates them and exports `dominantUnitTypeId` / `facingFor` / `meanQ` so the legacy path can't drift; `paintBattleCombatant()` and `drawLegacy()` both draw the sprite with a disc fallback; `drawWithDescriptor()` is now exported so both paths share the anchor/sizing math.

**Also:** `tsconfig.tools.json` + `models:build` / `models:preview` / `models:check` scripts; `tools/models/previews/` git-ignored.

Three bugs found and fixed while building, all caught by looking at output rather than by tests:

1. **Frames bled across sprite-strip cells.** `rasterTriangle` clamped to the whole strip, so the arrow flying off on `loose` drew into the neighbouring frame. Now clipped per cell.
2. **The draw arm pointed at empty space.** The rest pose had the right arm forward of the bow rather than on the string, so it rendered as a floating skin-coloured plank. The rest pose now nocks the arrow, and the draw rotations were solved so the hand tracks the nock.
3. **Units hovered above their hexes.** The fit was centred, leaving 13–17px of dead space under the feet that varied per direction. Changed to bottom-aligned (see "Output" above).

Verified: `npm run build`, `npm run models:check`, `npm run lint:deps` clean; 134 unit tests pass, including three new `battleScene.test.ts` cases covering `unitTypeId` / `facing` (including the swapped-column case). Rendered live in the Test Battle arena against the real 12-unit catalog — the archer platoon draws as a sprite, every other unit type falls back to a disc.

**Known limits:** animations are generated but never played (see `plan/2026-08-29-unit-animation-plan.md`); only `e`/`w` facings are ever requested; the arena's human-side move is not animated at all, so platoons teleport.
