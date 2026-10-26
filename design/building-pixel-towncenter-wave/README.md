# Town-centre sprite wave — 2026-10-25 (replaces `building-pixel-townHall-1.png`)

Replacement for the settlers town centre's sprite. The shipped asset was reported
as see-through in game; measuring it shows three defects at once, all of them
reproducible from the PNG alone:

| Defect | Measurement on the shipped file | Its in-game consequence |
|---|---|---|
| The lot is drawn at 30°, the grid is 2:1 | lower-edge slope dx/dy **1.748 (29.78°)** vs the grid's **2.0 (26.57°)** | the sand diamond is 13% too tall for the cell it stands on |
| A soil slab under the front edges | a **48-row** dark band = **4.05 px** at the drawn size | a 4px pedestal, and the sand plane floats ~4px above the cell's south vertex |
| Alpha cracked into slits | **49 opaque fragments**, 2 208 interior transparent pixels, biggest fragment 87% of the ink | grey map shows through the walls and roof at game size |
| The lot does not fill its canvas | ground diamond **84.7%** of the canvas, bottom pad **110 rows** | the footprint the sprite *covers* is far smaller than the 2x2 block it occupies |

The standard the replacement is authored to is the repo's own grid-exact family
(the five `building-pixel-farm<Style>-1.png` plots) as encoded in
`test/townCenterSprite.e2e.ts` (the audit card's suite): edge slope 0.5 ±0.06,
bottom pad ≤2 rows, ground diamond ≥95% of the canvas, ≤16 rows of silhouette
below the ground plane, anchor offset consistent with the sprite's own pad.

## Prompts

Four prompts, four models, seven generations (two rounds). Round 1 asked for the
lot at 2:1 with a magenta guide diamond stroked over the exact footprint in the
input image; round 2 additionally said the lot is *half as tall as it is wide*
and that no vertical face may be drawn under the sand.

| Prompt | Model | Round | Candidate |
|---|---|---|---|
| `towncenter-A-timberHall-pro.txt` | `google/gemini-3-pro-image` | 1 + 2 | A, A2 |
| (same prompt) | `google/gemini-3.1-flash-image` | 1 + 2 | B, B2 |
| `towncenter-C-towerHall-gpt.txt` | `openai/gpt-5.4-image-2` | 1 | C |
| (A2 prompt) | `openai/gpt-5.4-image-2` | 2 | C2 |
| `towncenter-D-thatchHall-flash.txt` | `google/gemini-2.5-flash-image` | 1 | D |

Reference images: the asset to redraw (`building-pixel-townHall-1.png` with the
magenta guide stroked on it) first, `building-pixel-house-1.png` as the style
anchor second.

**The model does not obey the geometry, in either round.** All seven generations
came back at **29.1–30.7°**, and six of the seven added a 40–56 row soil slab
anyway (the "half as tall as it is wide" wording moved it by ~0.4°). Two
conclusions for the sprite skill: the lot's angle is a post-pass, never a prompt;
and "flat lot" has to be enforced by clearing the mask below the sand's edges,
not by asking.

Backgrounds came back as a solid light gray (194–225), never a checkerboard, so
`strip-checker-any.mjs` (border-tone clustering, one tone) cleaned all seven to a
single opaque component with 0 enclosed holes and 0 partial-alpha pixels.

## Pipeline

```
gen (openrouter-image.mjs) -> raw-*.png            1024x1024, solid gray bg
  strip-checker-any.mjs    -> alpha-*.png            real alpha, 1 component, 0 holes
  repair-alpha.mjs         -> (no-op: already clean)
  tools/sprites/fit-lot-to-grid.mjs   -> fit-*.png   sand edge -> exactly 2:1, slab cleared
  tools/sprites/grid-exact-lot.mjs    -> gx-*.png    farm-family convention: diamond spans
                                                     the canvas, south vertex on the last row
```

`fit-lot-to-grid.mjs` measures the **sand's** lower edges (not the alpha
silhouette, which the slab contaminates), scales the image vertically by
`0.5 / measured` about the sand's south vertex, then clears the mask below the
fitted edges. The vertical-only scale keeps the drawn width and the sprite's
horizontal placement, so the result is still a drop-in for the asset it replaces.
Direction matters: `sy = target / measured` (0.88 here); the inverse stretches the
sprite and reports 33° instead of 27°.

`grid-exact-lot.mjs` then does one uniform scale (`1024 / diamondWidth`, 1.11–1.19)
about the south vertex and centres it, which is what makes the engine's anchor
maths degenerate to 0.

## Candidates (all measured with the audit suite's own formulas)

| Candidate | Model | A1 slope (0.5±0.06) | A2 pad (≤2) | A3 diamond width (≥95%) | A4 below ground (≤16) | alpha |
|---|---|---|---|---|---|---|
| A | gemini-3-pro-image r1 | 0.529 ✓ | 0 ✓ | 100% ✓ | 15 ✓ | 1 comp, clean |
| A2 | gemini-3-pro-image r2 | 0.531 ✓ | 0 ✓ | 100% ✓ | **16 (at the limit)** | 1 comp, clean |
| B | gemini-3.1-flash r1 | 0.525 ✓ | 0 ✓ | 100% ✓ | 13 ✓ | 1 comp, clean |
| B2 | gemini-3.1-flash r2 | 0.533 ✓ | 0 ✓ | 100% ✓ | **17 ✗** | 1 comp, clean |
| **C** | **gpt-5.4-image-2 r1** | **0.520 ✓** | **0 ✓** | **100% ✓** | **10 ✓** | **1 comp, 0 holes** |
| C2 | gpt-5.4-image-2 r2 | 0.498 ✓ | 0 ✓ | 100% ✓ | -1 ✓ | 1 comp, clean |
| D | gemini-2.5-flash r1 | 0.529 ✓ | 0 ✓ | 100% ✓ | 15 ✓ | 1 comp, clean |

Picked: **C** (`openai/gpt-5.4-image-2`, prompt `towncenter-C-towerHall-gpt.txt`) —
a stone corner tower with a slate turret and banner, timber-framed jettied wing,
tiled roof, arched windows, walled yard with barrels, hay and a cart wheel.

Why: it is the only finalist whose silhouette reads unmistakably as the
settlement's civic landmark at the drawn 86 px (the tower + banner); its lot is
already 90% of the canvas before scaling, so the grid-exact pass resamples it by
only 1.11; it has the largest margin on A4 (10 vs A2's borderline 16 and B2's
failing 17); and it carries the richest material mix (stone/timber/slate/tile).
Its weakness is grain: the pixel blocks are finer than the Gemini-made set's, so
next to the neighbouring sprites it reads slightly higher-resolution.

Runner-up A2 keeps the shipped asset's silhouette family (timber cottage hall,
chunky pixels matching the set). Swap with:

```
cp .agentboard/settlers-reports/towncenter-wip/gx-A2.png src/resources/buildings/building-pixel-townHall-1.png
npm run gen:building-anchors && npm run validate-assets
```

## The 2x2 coverage finding (not fixable from the art)

`test/townCenterSprite.e2e.ts` check **B4** wants the rendered ground diamond to
cover ≥95% of the footprint: `>= 0.95 * 2 * TILE_W` = 182.4 px of the 192 px
block. The engine draws every pixel building with `sizing: { kind: "fitWidth",
hexSizeMul: 0.9 }` (`src/render/assetDescriptors.ts`), so the town hall's whole
canvas — and with it any ground diamond it can contain — renders **86.4 px**
wide: **45%** of its block. No 1024 px canvas can change that.

With a grid-exact asset the fix degenerates to one line in the descriptor
(`hexSizeMul: 0.9 -> 2.0` for the 2x2 town hall): drawn width becomes 192 px = the
block exactly, coverage 100%, and because the grid-exact art's ground diamond
spans the canvas with its base on the last row and the anchor offset is 0, the
base lands on the footprint's south vertex with no compensation at all (B3/B5
pass). Note the suite's own calibration reference does not meet B4 either — the
farm plots render at 96 px over a 192 px footprint, 50% — so B4's threshold and
its stated reference contradict each other.

Reproduce the numbers:

```
node tools/sprites/fit-lot-to-grid.mjs <alpha.png> <fit.png> [report.json]
node tools/sprites/grid-exact-lot.mjs <fit.png> <gx.png>      # prints the A1-A5 table
```
