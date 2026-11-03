# Town-hall levels 2 and 3 — the upgrade art, and the candidates behind it

Second town-centre wave (the first, `design/building-pixel-towncenter-wave/`,
re-arted **level 1** only). This one re-arts **levels 2 and 3** so the whole town
hall family sits on the iso grid, and turns
`test/townCenterSprite.e2e.ts` (`npm run test:towncenter`) green.

## The red, before any art moved

`npm run test:towncenter` on `github/main` @ `5ecbfe2` (0.38.2) reported
**15/25 checks passed**, with every failure in the two halves at levels 2 and 3:

```
>> FAIL A1@L2  edge slope 0.688 (grid 0.500, tolerance ±0.060)
>> FAIL A2@L2  107 transparent rows below the lowest opaque pixel of 1024 (max 2)
>> FAIL A3@L2  ground diamond 84.7% of the 1024px canvas (min 95%)
>> FAIL A4@L2  81.3px of silhouette below a 2:1 diamond of its own 867px width (max 16)
>> FAIL A5@L2  committed anchorOffsetY 9, required 18.06 for the 2x2 draw height 172.8
>> FAIL A1@L3  edge slope 0.669
>> FAIL A2@L3  70 transparent rows
>> FAIL A3@L3  ground diamond 85.5%
>> FAIL A4@L3  74.0px of silhouette below the ground plane
>> FAIL A5@L3  committed anchorOffsetY 6, required 11.81
== 15/25 checks passed ==
FAILED: A1@L2, A2@L2, A3@L2, A4@L2, A5@L2, A1@L3, A2@L3, A3@L3, A4@L3, A5@L3 failed
```

Levels 1 (all 15 of A0-A5@L1 and B0-B5) passed and is the calibration: it is
already grid-exact (`edge slope 0.520`, pad 0, diamond 100% of canvas, 10px below
the ground plane, anchor 0). Levels 2 and 3 still carried the old diorama art
(30°/plinth/large margin), exactly as the audit predicted.

## What "grid-exact" means here

The level-1 sprite's own convention, which every number below is measured against
(the suite's thresholds, `test/townCenterSprite.e2e.ts`):

| # | check | tolerance | L1 measured | farm reference |
|---|---|---|---|---|
| A1 | ground diamond edge slope | 0.5 ± 0.06 | 0.520 | 0.522 |
| A2 | transparent rows under the lowest opaque pixel | ≤ 2 | 0 | 0 |
| A3 | ground diamond width / canvas width | ≥ 95% | 100% | 98.4% |
| A4 | silhouette px below a 2:1 diamond of its own width | ≤ 16 | 10 | 11 |
| A5 | committed anchor offset vs the art's real (2x2) pad | ± 1 | 0 (pad 0) | — |

The lot spans the full canvas width with its south vertex on the last row, so the
engine's anchor compensation degenerates to **0**.

## Pipeline

```
generate  (openrouter-image.mjs)      -> raw-*.png    1024x1024, uniform light-gray field
  strip   (strip-solid-bg.mjs)        -> *.a2.png     real alpha
  repair  (repair-alpha.mjs)          -> (no-op: already clean)
  fit     (tools/sprites/fit-lot-to-grid.mjs)   -> *.f2.png   sand edge -> exactly 2:1, slab cleared
  grid    (tools/sprites/grid-exact-lot.mjs)    -> *.gx2.png  diamond spans the canvas,
                                                             south vertex on the last row
```

`fit-lot-to-grid` is a **vertical-only** scale about the sand's south vertex, so
the drawn width and the horizontal placement are untouched, and then clears the
mask below the fitted edges (the plinth). `grid-exact-lot` is one **uniform**
scale about the south vertex (never an axis-independent stretch), which is what
keeps the sprite's proportions.

**One pipeline correction this wave.** Both stock strippers were wrong for this
art, and the damage was invisible in the audit numbers:

- `strip-checker-any.mjs` clusters the **border** tones. The grid-exact lot runs
  to the canvas' bottom row, so the sprite's own dark outline (`44,19,12`) became
  a cluster — and its halo pass then deletes every dark pixel adjacent to
  transparency, cutting 1-2px **see-through seams under the roof eaves**. The
  first, discarded pass on candidate L2-A came out in **229 alpha components**
  (one 4069px roof region detached from the wall by a 1px slit).
- the repo's `strip-checkerboard.mjs` seeds the tone correctly but its halo pass
  removes any *grayish* pixel adjacent to background for up to 16 passes, which
  erodes a slate roof edge.

These outputs paint **one uniform light-gray field** (measured 189-226, ±1 noise
on every candidate), so the precise pass is a flood fill from the border over
**one** tone plus a tight halo:
`tools/sprites/strip-solid-bg.mjs <in> <out> [floodTol=16] [haloTol=30]`.
Every sprite below was re-cut with it, and the seam count went to 1 component.

## The prompts and the candidates

Two prompts, four models, eight generations (one per model per level). Each
prompt is passed with the **current grid-exact level-1 sprite as the FIRST
reference** (so the model inherits the family's silhouette, palette and — more
usefully than any prose — its flat lot) and `building-pixel-house-1.png` as the
second (the set's style anchor).

| Prompt | Model | Candidate |
|---|---|---|
| `prompts/towncenter-L2-upgrade.txt` | `google/gemini-3-pro-image` | L2-A |
| (same) | `openai/gpt-5.4-image-2` | L2-B |
| (same) | `google/gemini-2.5-flash-image` | L2-C |
| (same) | `google/gemini-3.1-flash-image` | L2-D |
| `prompts/towncenter-L3-upgrade.txt` | `google/gemini-3-pro-image` | L3-A |
| (same) | `openai/gpt-5.4-image-2` | L3-B |
| (same) | `google/gemini-2.5-flash-image` | L3-C |
| (same) | `google/gemini-3.1-flash-image` | L3-D |

**The lot's angle obeyed the reference this time.** The first wave measured
29.1-30.7° in 7 of 7 generations and concluded the angle is a post-pass. Handing
the model a level-1 sprite whose lot is *already* 2:1 is the difference: this
wave's raw lots measured **26.55-28.09°** (five of eight within 0.1° of the
grid's 26.57°). The plinth is still prompt-proof — L2-A's model drew a ~30-row
slab under the sand that `fit-lot-to-grid` had to clear (30 691 px).

### Measured, after the pipeline (the suite's own formulas)

| Cand. | Model | raw lot angle | fit vscale | grid-exact A1 / A2 / A3 / A4 | uniform scale | alpha comps |
|---|---|---|---|---|---|---|
| **L2-A** | **gemini-3-pro-image** | 26.55° | **1.0005** | 0.523 / 0 / 100% / 12 | 1.002 | **1** |
| L2-B | gpt-5.4-image-2 | 27.94° | 0.9428 | 0.502 / 0 / 100% / 1 | 1.0039 | 1 |
| L2-C | gemini-2.5-flash-image | 26.64° | 0.9967 | 0.521 / 0 / 100% / 11 | 1.002 | 1 |
| L2-D | gemini-3.1-flash-image | 26.57° | 0.9998 | 0.520 / 0 / 100% / 10 | 1.001 | 2 (1px) |
| **L3-A** | **gemini-3-pro-image** | 26.58° | **0.9994** | 0.521 / 0 / 100% / 11 | **1.000** | **1** |
| L3-B | gpt-5.4-image-2 | 28.09° | 0.9370 | 0.479 / 0 / 100% / -11 | 1.0291 | 2 (1px) |
| L3-C | gemini-2.5-flash-image | 27.06° | 0.9789 | 0.523 / 0 / 100% / 12 | 1.2278 | 1 |
| L3-D | gemini-3.1-flash-image | 26.57° | 0.9998 | 0.520 / 0 / 100% / 10 | 1.001 | 1 |

Every candidate passes A1-A5 (that is the point of the pipeline), so the pick is
decided on what the pipeline could not fix:

- **L2-A / L3-A (gemini-3-pro-image).** The model drew the lot at 26.55°/26.58°
  itself, so the vertical fit is **0.05% / 0.06%** — the pixel grid is not
  resampled at all — and the lot needed no enlargement (1.002 / **1.000**), so
  the art stays at the family's own pixel scale. One alpha component on both.
  Richest new architecture: the jettied storey, the individual roof tiles and the
  carved stonework are resolved where the flash models flatten them to slabs,
  which is exactly what an *upgrade* level has to add. Weakness: at native
  resolution a couple of 1px shadow lines under the eaves are thinner than the
  level-1 art's; invisible at the drawn 172.8px but not ideal at 400%.
- **L2-B / L3-B (gpt-5.4-image-2, the model that made level 1).** The only
  finalist with a real proportion defect: it drew its lot at 27.94°/28.09°, so
  the fit **compressed the whole image 5.7%/6.3% vertically** (vscale 0.9428 /
  0.9370) — rows resampled, the building squat. Level 3 additionally had to be
  enlarged 2.9% to span the canvas. Two components (a 1px speck each).
- **L2-C / L3-C (gemini-2.5-flash-image).** Level 2 is a legitimate finalist
  (1.0005-class distortion, 1 component) but resolves less detail. Level 3 is the
  weakest of the eight: the model drew the lot far inside the canvas (it needed a
  **1.2278× uniform enlargement** — the art ships 23% bigger than it was drawn,
  so its grain is visibly coarser than the family's) after a ~20 000px slab that
  the fit pass had to clear. Passes the numbers, reads off-family at size.
- **L2-D / L3-D (gemini-3.1-flash-image).** Clean and undistorted (0.9998 both),
  and level 3 is the grandest of the eight (three turrets, twin-colour roofs).
  Slightly flatter stonework than A and a more saturated/orange palette than
  level 1's; L2 carries a second small turret level 1 does not have.

### The pick

**L2-A and L3-A** (`google/gemini-3-pro-image`, `prompts/towncenter-L2-upgrade.txt`
/ `towncenter-L3-upgrade.txt`) — both shipped. One model for both levels keeps
the L2→L3 step continuous, and the rationale is the one the sprite skill states:
the pro model holds the reference's pixel scale and outline weight while
resolving more *new* detail, which is the whole job of an upgrade level. The
three rejected levels each fail on something the pipeline cannot repair: B's
proportions were vertically compressed, C's level 3 had to be blown up 23%, D is
clean but flatter and leaner in family match.

The result reads as one family: level 1 = timber hall behind a stone corner tower
with a slate turret; level 2 = the same hall grown, tower taller with a clock
face; level 3 = the full stone hall with a central bell tower and two round
turrets.

## The anchor override that moved

`src/render/generated/buildingAnchorOverrides.ts`, regenerated
(`npm run gen:building-anchors`, never hand-edited):

```
-  "pixel.townHall.2": 9,
-  "pixel.townHall.3": 6,
+  "pixel.townHall.2": 0,
+  "pixel.townHall.3": 0,
```

The old values compensated the old art's transparent bottom pad (107 and 70 rows)
at the 86.4 1x1 divisor. The new art is grid-exact — pad 0, south vertex on the
last row — so the required offset is 0 at any divisor, and `townHall.1` was
already 0 for the same reason. Nothing else in the table moved.

## Reproduction

```bash
export PGDATABASE=game_poc_fix_the_town_hall_sprite_ca288c   # per-worktree DB
node tools/sprites/strip-solid-bg.mjs <raw>.png <raw>.a2.png
node .kilo/skills/building-sprite-gen/scripts/repair-alpha.mjs <raw>.a2.png
node tools/sprites/fit-lot-to-grid.mjs <raw>.a2.png <fit>.png [report.json]
node tools/sprites/grid-exact-lot.mjs <fit>.png <gx>.png     # prints the A1-A5 table
npm run test:towncenter                                      # 25/25
```

The candidate PNGs, prompts and per-candidate reports are scratch
(`local/townhall-wave/`, gitignored) — regenerate any of them with the table
above; each is one billed generation.
