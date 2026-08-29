# Archer unit models — status and next steps

**Branch:** `claude/archer-unit-models-807294`
**Date:** 2026-08-29

This is the top-level summary for this branch. Full detail lives in [`docs/unit-models.md`](../docs/unit-models.md) (pipeline + wiring reference, with a change log) and [`plan/2026-08-29-unit-animation-plan.md`](2026-08-29-unit-animation-plan.md) (the animation work ahead).

## What's done

Built a 3D→sprite pipeline and used it to give the archer a real battlefield sprite, wired into both of the arena's paint paths.

**Pipeline** (`tools/models/`) — procedural 3D models authored in TypeScript, rendered offline by a small software rasterizer into the 8-direction PNG sets the existing 2D canvas already knows how to draw. No runtime 3D dependency; the game stays a `getContext("2d")` app. The iso camera is derived from `src/core/cityGrid.ts`'s actual 2:1 projection, not guessed.

```
tools/models/units/archer.ts   -->  npm run models:build  -->  src/resources/units/archer/{still,anim}/*.png + manifest.json
```

**Archer model** — hooded ranger with a nocked-and-ready rest pose, plus `idle`/`draw`/`loose` animations (generated, not yet played — see below).

**Arena wiring** — `src/render/unitSprites.ts` resolves a unit type + facing to a sprite; both `drawLegacy()` and the `?paint=scenebuilder` path draw it, falling back to the old colored disc for any unit without a model (i.e. everything except the archer today). Facing is computed from live positions (which side is left/right), not from `side`, so it's correct regardless of which side deployed where.

**Verified live:** ran the dev environment (client + API + shared Postgres) and exercised the actual Test Battle arena against the real 12-unit catalog — archer platoons render as sprites, every other unit type correctly falls back to a disc, no console errors. Build, `models:check`, and `lint:deps` all clean; 134 unit tests pass, including 3 new tests locking down facing/unit-type selection (including the swapped-deployment-column case). Dev server has been stopped again.

**Bugs caught by actually looking at rendered output**, not by tests:
1. Sprite-strip frames bled across cell boundaries (arrow flying off `loose` smeared into the next frame) — rasterizer now clips per-cell.
2. The draw-pose arm pointed into empty space instead of holding the string — rest pose now nocks the arrow properly.
3. Units hovered above their hex — the sprite fit was center-aligned, leaving inconsistent dead space under the feet; changed to bottom-aligned.

## What's next: walk + shoot animations

Full plan in [`plan/2026-08-29-unit-animation-plan.md`](2026-08-29-unit-animation-plan.md). Two findings shape the approach:

- **The human player's moves and attacks aren't animated at all today** — only the AI side ever sets `moveAnim`/`impact`. Adding visible walk/shoot animation means bringing the human action path up to the parity the AI already has, not just adding art.
- **The 8 rendered compass facings collapse to only 4 usable directions on the hex battle grid**, and the 4 diagonal hex directions currently fall back to front/back-facing poses that hide the bow. Exact model yaws for the 6 hex directions have already been solved (documented in the animation plan) — only the 4 diagonals need new renders; `e`/`w` are already correct.

Planned phases: (1) runtime sprite-sheet support — read `manifest.json`, teach the painter to draw a sub-rect frame instead of a whole image; (2) animation state on the scene node, kept pure/testable; (3) walk cycle + animating the human move path; (4) draw/loose shoot sequence + animating the human attack path; (5) polish (projectile arrow, flinch, death). One open question is called out for confirmation before phase 3: smooth slide-with-walk-cycle vs. discrete hex-to-hex hop.
