# Battle arena unit sprites — integration plan

**Status:** Executed 2026-09-29/30 (commits `c0778d2`, `640a13a`, `38449a1`). Descriptors + `resolveSpriteForUnit` + scene-node fields + attacker-window tracking + sprite-first painter with byte-identical circle fallback are live; the arena render path defaults to the scenebuilder painter (`?paint=legacy` escape hatch); 3 arena visual baselines added; all 12 units have idle + attack + move art (pose wave generated on `google/gemini-3-pro-image` with per-unit idle refs). Summary entry in `docs/architecture.md` ("Unit battle art"); this plan and `.kilo/plan/2026-09-29-unit-army-icons.md` remain the authoritative details.

## Problem

Battle-arena combatants are drawn as little colored circles (attacker blue `#3070c0`/selected `#5fb0ff`, defender red `#c04040`/selected `#ff7a7a`), with a white unit-count number and an HP bar. The user wants real per-unit-type art (idle / attacking / moving) for every unit type that can fight in the arena, integrated without rewriting the arena's rendering.

## Current state (verified 2026-09-29)

**Two draw paths, one look — circles:**

| Path | Where | Default |
|---|---|---|
| Legacy | `drawLegacy()` in `src/screens/combat/arena/openManualBattleArena.ts` (~lines 1339–1367) | **Yes** — runs unless the flag is set |
| Scene | `paintSceneForArena()` in `src/screens/combat/arena/paint.ts` → `buildBattleScene()` → `paintBattleCombatant()` in `src/render/scene/paint2d/index.ts` (~lines 1016–1039) | No — opt-in via `?paint=scenebuilder` (`readUseSceneBuilder`) |

- The scene path is the designated successor (8 battle-kind painters landed in PR #136; the legacy `draw()` body is a faithful decomposition source, not the future).
- `buildArenaPaint2dDeps()` (`paint.ts` lines 97–104) stubs **all** sprite resolvers to `undefined` — the arena paints no sprites today. This stub is the exact seam the art plugs into.
- The `battleCombatant` scene node (`src/render/scene/sceneBuilder/battleScene.ts` lines 217–227) carries `side, slotIndex, world, radius, selected, unitCount, hpRatio` — **no unit-type identity**, so the painter cannot pick a sprite yet.

**Unit data:**

- Catalog: 12 unit types in `server/migrations/002_unit_types.sql`, served via `GET /api/units`: `peasant, archer, crossbowman, swordsman, pikeman, cavalry, monk, crusader, griffin, hydra, wisp, black_dragon` across 4 advantage classes (`infantry, ranged, cavalry, monster`).
- A combatant (platoon) can mix up to **3** unit types (`MAX_PLATOON_ENTRIES = 3`, `packages/engine/src/units.ts`). The circle shows only the summed count.
- In practice platoons seen in the arena are single-type (demo armies `demoPlatoonsForPlayer`, Test Battle preset `src/combat/testArmies.ts`, AI `randomAiPlatoons`) — but players can merge mixed entries via settlement transfer/recruit, so mixed platoons are reachable and need a rule (see "Mixed platoons").

**Existing image conventions to respect:**

- `src/data/unitImages.ts` maps unit ids → bundled PNG URLs (`src/resources/units/{swordsman,archer,cavalry}.png` + `placeholder.png`) for DOM panels (army section, settlement menu, building menu). Those PNGs are literal placeholders (dark squares with googly eyes) — there is **no established unit-art style to match; the new art defines one**. The chosen style can later replace that placeholder set too (out of scope here).
- Canvas sprites all run through the descriptor/SpriteProvider pipeline (`assetDescriptors.ts` → `CompositeSpriteSource`: PNG first, procedural fallback). Horse-variant descriptors are **registry-driven** via `import.meta.glob` (`assetDescriptors.ts` lines ~420/440) — adding art is "drop PNG in a folder", no per-file code.
- Seam rules (`paint2d/` README + dependency-cruiser): `paint2d/` never imports `assetDescriptors.ts`; only `src/render/paint2dDefaults.ts` (and `skybox.ts`) may.
- Repo lesson (issue #148, `architecture.md`): *an unwired parallel implementation is not a safe intermediate state* — two draw paths must not visibly diverge for long.

**Geometry:** arena hex size clamped 14–44 (`arena/constants.ts`); combatant circle radius = `0.55 × hexSize` → sprite draw height ≈ 1.1–1.3 × hexSize ≈ **≤ ~57 px** at max zoom. Art is generated large and downscaled like the rest of the pipeline (buildings ship 128 px natural; horses 512 px).

## Asset contract (proposal)

- **Key scheme** (matches the `SpriteKey` template style): `` `unit.${unitTypeId}.${pose}` `` where `pose ∈ {"idle" | "attack" | "move"}` — e.g. `unit.swordsman.idle`.
- **Files:** `src/resources/units/arena/<unitTypeId>-<pose>.png` (new folder; does not collide with the DOM-panel icons in `src/resources/units/`).
- **Descriptors:** registry-driven like the horse variants — an `import.meta.glob` over `resources/units/arena/*.png` builds `UNIT_ARENA_DESCRIPTORS` (filename convention `<id>-<pose>.png`), so adding a unit = drop PNG + catalog row, zero descriptor code. `Sizing: { kind: "fitHeight", hexSizeMul ≈ 1.3 }`, `anchor: "bottom"` (feet on the hex), transparent background.
- **Fallback = today's circle.** The painter draws the sprite only when the resolver returns a ready sprite; otherwise it draws the circle+count+HP exactly as now. Missing art degrades to the current look — never a blank hex.

## Integration design — additive only, rides existing seams

1. **Descriptors + files** (new module content in `assetDescriptors.ts` + a key-union extension `unit.${string}.${pose}`): pure addition, no behavior change (nothing resolves `unit.*` keys yet).
2. **Scene node extension:** `BattleCombatantNode` gains optional `unitTypeId?: string`, `pose?: "idle" | "attack" | "move"`, and the painter-facing `mirror?: boolean` (defender). Optional fields = backward compatible; existing tests keep passing.
3. **Builder derivation** (`battleScene.ts`):
   - `unitTypeId` = **dominant entry**: highest `count` in `c.entries` (tie: first stored entry). `unitTypes` is already on `ManualBattleState` for name lookups.
   - `pose`:
     - `"move"` when this combatant matches `activeMoveAnim.side/slotIndex` (the mover is already interpolated by `resolvePosition`);
     - `"attack"` for the attacking platoon during the impact window — **the one small functional addition**: the arena records `attacker: { side, slotIndex, startedAt }` when it dispatches an attack (human and AI paths both funnel through the same resolve step) alongside the existing `impact: { hex, startedAt }`, and clears it with the same `pruneExpiredEffects` beat. Without it, the impact ring names the *victim* only.
     - `"idle"` otherwise. Note: a "moving" pose can also be faked painter-side with the hero bob/squash pattern (proven on the adventure map); shipping `move` art is optional phasing, not a blocker.
4. **Painter change** (`paintBattleCombatant`): resolve `unit.<id>.<pose>` first (same sprite-first pattern as `paintCastle`/`paintHero`); on hit, draw the sprite bottom-anchored at the combatant's world point (defender mirrored via `ctx.scale(-1, 1)` — art is authored facing right once), then overlay the **existing** count text (with a strokeText shadow for legibility over art, same pattern as battle floats) and **existing** HP bar and selection ring. On miss, fall through to the circle code unchanged. Byte-identical fallback.
5. **Deps wiring:** `buildArenaPaint2dDeps()` stops stubbing sprite resolution **for unit keys only** — a tiny `createUnitSpriteResolver()` built in `src/render/paint2dDefaults.ts` (the only file allowed to import `assetDescriptors.ts`) over the new `UNIT_ARENA_DESCRIPTORS`. Other resolvers stay inert; no skybox machinery pulled in.
6. **Side/team identification:** defender = mirrored sprite + keep the selection ring + add the adventure-map-style small owner dot at the figure's base (heroes already do this). Alternative (separate tinted art per side) rejected — doubles the asset count for no readability gain.

## The two-path question (must be decided with the sprites)

Wiring sprites only into `paintBattleCombatant` while the default stays legacy means the flag flips the arena's look — exactly the divergence issue #148 warns about. Recommended resolution:

- **Flip the arena default to the scene path** when sprites land: `readUseSceneBuilder` default true, `?paint=legacy` as the escape hatch. The legacy circle body stays untouched as the fallback path.
- Add an **arena scene to the visual-baseline replay set** (`test:visual` currently covers adventure/charter/city only) and regenerate it once for the sprite look, so the flip is gated rather than eyeballed.
- Alternative (lower risk, more debt): wire the sprite branch into `drawLegacy()` too (~10 lines, marked transitional with a cutover deadline). Presented for completeness; not recommended.

## Mixed platoons (needs a user decision)

| Option | Behavior | Notes |
|---|---|---|
| **A — dominant unit (recommended v1)** | Sprite = highest-count entry; count badge unchanged | Matches observed data (near-all single-type platoons); zero extra art |
| B — composite strip | Up to 3 small sprites side-by-side with per-type counts | Legible only at high zoom; 3× draw complexity |
| C — per-entry sprites stacked | Overlapping sprites per entry | Cluttered at ≤57 px; not recommended |

## Production plan

- **Scope:** 12 unit types. Phase 1: `idle` for all 12. Phase 2: `attack` for all 12. Phase 3 (optional): `move` art — or painter-side bob for v1.
- **Generation:** the `building-sprite-gen` skill scripts (`gemini-buildings.mjs` + auto strip/repair-alpha + `remove-specks`) with a **side-view unit prompt template** (the building template's isometric plot paragraphs don't apply). Style-match against the chosen sample direction; one style reference for the whole set so 12 units read as one army.
- **Sizing pipeline:** generate large (1024) → downscale to ~128 px natural height → commit to `src/resources/units/arena/` → registry descriptors pick them up.
- **Budget note:** each Gemini generation is a small billed OpenRouter call; ~12–36 images total across phases.
- **Validation:** `repair-alpha.mjs --check` as a CI-able gate on the folder; a light unit test pinning descriptor coverage — every id in the unit catalog resolves `unit.<id>.idle` (or asserts the fallback explicitly) so a new catalog row can't ship art-less unnoticed.

## Implementation order (each step compiles green)

1. Art lands in `src/resources/units/arena/` + descriptors/key-union (no consumer yet).
2. `createUnitSpriteResolver()` in `paint2dDefaults.ts`.
3. Node fields + builder derivation + arena `attacker` tracking (the only legacy-layer logic touch).
4. Painter sprite-first branch + fallback.
5. Default flip to scene path + arena visual baseline + unit tests (pose derivation incl. mixed platoons, descriptor coverage, painter fallback byte-parity).

## Test images delivered with this plan (styling decision input)

`design/arena-unit-sprites/` — 11 samples, nothing overwritten:

- **Style A "Commander-match"** (style-matched to `src/resources/units/horse/commander-1/hero-player-e.png`, the game's hero art): swordsman / archer / cavalry / griffin / black_dragon, idle — plus a swordsman **idle→attack→move trio** to judge whether 3 poses earn their keep.
- **Style B "Battle miniature"** (no reference; richer shading, higher contrast): swordsman / archer / cavalry / griffin, idle.
- Prompts are preserved beside the images in `design/arena-unit-sprites/prompts/` so the chosen direction can be replayed for the full set.

Review guide: pick A or B (globally, or per-unit mix), whether the count number + HP bar stay overlaid on art (recommended), and whether the move pose is needed or a painter-side bob suffices.

## Decisions (2026-09-29, user-confirmed via Q&A)

1. **Style:** B — dramatic miniature (richer shading, high contrast). Not per-unit-class mixed.
2. **Mixed platoons:** dominant-unit sprite (highest count; first stored entry on ties).
3. **Poses:** idle art first for all 12; attack art as wave 2; `move` faked painter-side with the hero-style bob (no move art).
4. **Two-path resolution:** flip the arena default to the scene path when art lands (`?paint=legacy` escape hatch; add an arena visual baseline to `test:visual`).
5. **Team distinction:** defender = mirrored sprite (`ctx.scale(-1, 1)`) + owner-color base dot; selection ring and HP bar unchanged.
6. **Asset home confirmed:** `src/resources/units/arena/<unitTypeId>-idle.png`, registry-driven descriptors (filename convention `<id>-<pose>.png`).
7. **Execution now:** full 12-unit idle set (8 new Gemini calls; the 4 existing styleB samples reused as masters), downscaled to 128 px, into `src/resources/units/arena/`. Art only in this pass — descriptor/resolver wiring is deferred while another agent shares the workspace; steps 3–5 of the implementation order remain queued.

## Explicitly out of scope (this plan)

- Engine/combat logic, `ManualBattleState` shape beyond the additive attacker-tracking field.
- Adventure-map rendering, spells, floats/impact styling.
- Replacing the DOM panels' placeholder unit icons (`unitImages.ts`) — natural follow-up once the style is chosen.
- Any change executed now — this pass creates only new files (plan + samples).
