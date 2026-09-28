# Unit animation plan — walk + shoot in the battle arena

**Status:** planning. Nothing here is implemented.
**Depends on:** the model pipeline and arena sprite wiring described in [`docs/unit-models.md`](../docs/unit-models.md).

## Goal

1. A platoon that moves **walks across the hexes it travels**, instead of teleporting or sliding in its rest pose.
2. An archer that attacks **plays a draw → loose shot**, instead of the target simply flashing an impact ring.

## What exists today

| Piece | State |
|---|---|
| `idle` / `draw` / `loose` strips | Generated into `src/resources/units/archer/anim/`, **never loaded** — `assetDescriptors.ts` globs `still/` only |
| `manifest.json` (frame counts, loop flags) | Written by the build, **never read at runtime** |
| `drawWithDescriptor()` | Blits a **whole image**; no sub-rect / sprite-sheet support |
| `moveAnim` | Exists, but **only the AI ever sets it** |
| `impact` fx | Exists, but **only the AI ever sets it** |
| Facing | `e` / `w` only, recomputed per frame from live positions |
| `walk` animation | **Does not exist** in the archer model |

### Three findings that shape the work

**1. The human player's move is not animated at all.** `openManualBattleArena.ts` handles a move click by calling `moveSelectedTo()` then `refreshAfterMove()` — the platoon jumps to its destination. Only `ai.ts` builds a `moveAnim`. So "archers walking over each tile" is **not** just an art task: half of it is adding movement animation to the human path that has never existed. The good news is `getMovementPath(state, combatant, destination)` is already exported from the engine and already used by the AI, so the per-hex path is available to the human path for free.

**2. The 8 compass facings collapse to 4 on the hex grid.** The sprites are rendered at 45° yaw increments (the city grid's isometric compass). The battle grid is a pointy-top hex board whose six neighbours sit at screen angles 0°, ±60°, ±120°, 180°. Matching each to the nearest existing sprite gives:

| Hex dir | Screen angle | Nearest sprite | Error |
|---|---|---|---|
| E | 0° | `e` | 0° |
| W | 180° | `w` | 0° |
| NE | −60° | `n` | **30°** |
| NW | −120° | `n` | **30°** |
| SE | 60° | `s` | **30°** |
| SW | 120° | `s` | **30°** |

Only four distinct sprites get used, and every diagonal falls back to `n`/`s` — the facing-toward/away-from-camera poses, which hide the bow and read badly in a side-on fight. Walking diagonally would look like the unit turning to face the viewer.

The fix is to render battle facings at the **hex** angles rather than compass angles. Solving the iso projection for each target screen angle gives the model yaws:

| Hex dir | Screen angle | Model yaw |
|---|---|---|
| E | 0° | **−45.00°** |
| SE | 60° | **28.90°** |
| SW | 120° | **61.10°** |
| W | 180° | **135.00°** |
| NW | −120° | **−151.10°** |
| NE | −60° | **−118.90°** |

E and W are exactly the yaws the existing `e` and `w` sprites already use, so those two are already correct and the current arena rendering does not regress. Only the four diagonals are new.

**3. `animationsActive()` gates the requestAnimationFrame loop.** A permanently-looping `idle` would keep a rAF running for the whole battle. That is a deliberate decision, not an accident to stumble into — see Decision C.

## Decisions to make before coding

**A. Facing set.** *Recommend:* add a `facings` option to `ModelDef` and give battle units the 6 hex yaws above, keyed `unit.<id>.<dir>` with `dir ∈ {e, se, sw, w, nw, ne}`. Keeps the key shape, retires nothing, and `e`/`w` are unchanged. The 8-compass set stays available for any future adventure-map use.

**B. Walk pacing.** The AI currently caps a whole move at `AI_MOVE_MS_MAX = 620ms` regardless of distance (`AI_MOVE_MS_PER_HEX = 90`). If the walk cycle is driven off normalised path progress, a long move plays the cycle faster and the feet skate. *Recommend:* drive the walk cycle off **distance travelled** (one full cycle per N hexes) rather than off elapsed fraction, so cadence stays constant however the duration is clamped. Revisit whether the 620ms cap should rise for long moves — that is a feel change, worth trying both.

**C. Idle looping.** *Recommend:* start with **no idle in the arena** — units hold the rest pose. It is the cheapest correct thing, avoids a battle-long rAF, and the rest pose already reads as "ready". Revisit after walk and shoot land; if wanted, restrict it to the selected platoon so at most one unit animates.

**D. Melee units.** Every non-archer still falls back to a coloured disc. Walk/shoot must degrade cleanly: no sprite → current behaviour, unchanged. No melee unit gets an attack animation until it gets a model.

## Phases

Each phase should build, pass `npm run lint:deps`, and keep **both** paint paths in step — `drawLegacy()` and `paintBattleCombatant()` both draw combatants, and `?paint=scenebuilder` swaps between them.

### Phase 1 — sprite-sheet plumbing

- Load `manifest.json` at runtime (`import.meta.glob` with `eager`, `resolveJsonModule` is already on) so frame counts and loop flags come from the build, not from constants duplicated in the renderer.
- Glob `anim/` alongside `still/`; key them `unit.<id>.<anim>.<dir>`. Note this adds ~24 PNGs per unit to the bundle — check the size delta and consider `OnDemandSpriteSource` rather than eager preload.
- Extend `ResolvedSpriteDescriptor` with optional frame geometry (`frameCount`, `frameWidth`) and teach `drawWithDescriptor()` the 9-argument `drawImage` sub-rect form. Existing callers pass no frame info and must be byte-identical afterwards.
- Add `resolveUnitAnimation(unitTypeId, anim, facing)` to `unitSprites.ts`.

*Verify:* a scratch harness drawing frame N of a strip, before any game state is involved.

### Phase 2 — animation state on the node

- Add `anim: { name: string; frame: number } | null` to `BattleCombatantNode`.
- The scene builder is **pure and takes `nowMs` explicitly** — keep it that way. It should derive the frame from inputs it is given (path progress, an attack fx with `startedAt`), never read a clock itself.
- Both painters: if `anim` resolves to a strip, draw that frame; else the still; else the disc.

*Verify:* extend `test/render/battleScene.test.ts` — it already covers `unitTypeId`/`facing` and drives `nowMs` directly, which makes frame selection cheap to assert.

### Phase 3 — walk

- Author a `walk` cycle in `tools/models/units/archer.ts` (leg swing, opposite arm counter-swing, slight body bob). 8 frames, looping. Re-check the contact sheet: tracks are additive deltas on the rest pose, and the rest pose has the bow arm extended.
- Add the 6 hex facings (Decision A) and regenerate.
- **Animate the human move.** Build a `moveAnim` from `getMovementPath()` in the move-click handler, mirroring what `ai.ts` already does, and let `refreshAfterMove()` run after the slide rather than instantly. Input must stay locked while it plays — `animationsActive()` already exists for this.
- Facing follows the **current path segment**, not the enemy centroid, while a move is playing.

*Verify:* walk a platoon several hexes in each of the 6 directions in the Test Battle and watch feet vs. ground speed.

### Phase 4 — shoot

- Sequence on attack: `draw` (8f) → `loose` (5f), with the existing `impact` ring and damage floats timed to land on the loose frame, not on the click.
- **The human attack path has no fx at all today** — no `impact`, no animation. It needs the same treatment as the AI path, or shots will animate only when the AI takes them.
- The engine resolves damage synchronously; the visuals lag it. That is fine, but the UI must not accept a second action mid-shot.
- Gate on `isRangedPlatoon(combatant, state.unitTypes)` (already exported) so melee platoons don't play a bow animation.

*Verify:* human archer shot, AI archer shot, and a melee platoon attacking (should be unchanged).

### Phase 5 — polish

Arrow as a real projectile between shooter and target; recoil/flinch on the struck platoon; death animation. All optional and independent.

## Risks

- **Path divergence between the two painters.** Already mitigated by `battleScene.ts` exporting `dominantUnitTypeId`/`facingFor`/`meanQ`; do the same for any frame-selection helper rather than writing it twice.
- **Bundle growth.** 24 extra PNGs per animated unit. Measure before committing to eager loading.
- **AI timing coupling.** `ai.ts` `await`s fixed durations (`AI_MOVE_MS_PER_HEX`, `AI_IMPACT_HOLD_MS`, …). A shot animation longer than `AI_IMPACT_HOLD_MS` will be cut off; these constants and the animation lengths have to be reconciled, not tuned independently.
- **`arena/paint.ts` must stay node-importable.** `test/screens/combat/arena.test.ts` imports it under plain `node:test`. Anything Vite-`?url`-coupled has to keep arriving by injection, and `npm run lint:deps` enforces it.
- **Scope creep into the adventure map.** Hero sprites there are a separate system (`heroSprites.ts`, `horseVariants.ts`) and are explicitly out of scope.

## Open question

Should walking be a smooth slide with a walk cycle playing over it (recommended — standard, and it is what `moveAnim`'s interpolation already does), or a discrete hop from hex centre to hex centre? The phrasing "walking over each tile" fits the former; worth confirming before Phase 3.
