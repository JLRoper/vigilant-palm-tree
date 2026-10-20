# Hero variant wave — `bubbly` ("Light Unicorn")

Per-file provenance for the `bubbly` mounted-hero variant, repainted from the
dark unicorn as the Light Unicorn and recorded with the "Metadata for Future
Art" fields in [`docs/asset-provenance.md`](../../../docs/asset-provenance.md).

| Field | Value |
|---|---|
| Variant id / label / commander dir | `bubbly` / `Light Unicorn` / `commander-2` |
| Base character | a repaint of the existing dark unicorn (`commander-7/unicorn-{n,e,s,w}.png`) — same riderless silhouette and framing, inverted to a luminous white/silver coat with a gold horn |
| Generation date | 2026-10-19 (local; requests finished 2026-10-20T03:37Z) |
| Provider / model | OpenRouter `google/gemini-3.1-flash-image`, endpoint pinned `google-vertex/global` (`provider.only`, no fallbacks) |
| Generator | `tools/sprites/gemini-hero-sprite.mjs` with `--riderless` (mount-only facing wording), `--pose-ref` (side-profile references for the corrected diagonals) and `--suffix -2` (run frames) |
| Sprite prompt | [`prompt.txt`](./prompt.txt), sha256 `1031bed1394561042127f78a891b9e3a04b81250bf9b53add7acb1a92aa0bc73` |
| Run-frame prompt | [`prompt-run.txt`](./prompt-run.txt), sha256 `341218eaec24f2cb444e369c8cc211fe7b5591392942415db7792f5558975fe7` |
| Banner prompt | [`banner-prompt.txt`](./banner-prompt.txt), sha256 `3eba0aa1969cbb711df62cee8328c8591a51de15d2d75dc1fb7cb89fa5c32c9e` |
| Masters (1024²) | `design/hero-variants/bubbly/masters/*-master.png` — **gitignored**, reproducible from the prompts above |
| Outputs | `src/resources/units/horse/commander-2/bubbly-{e,ne,nw,se,sw,w}.png` + `-2` run frames (512×512 RGBA), `src/resources/hero-banner-bubbly.png` (320×100) |

## Reference images handed to the model

| Output | Reference | sha256 |
|---|---|---|
| `bubbly-e.png` | `commander-7/unicorn-e.png` | `0ff85a1601e10f82cf48bb1a923aaea017f47df55a9af6af83e5576524ed793b` |
| `bubbly-ne.png` | `commander-7/unicorn-n.png` | `b9cf482622d79393bb04cc534fc7393131fea7456a8aa7acdb19be265d080e37` |
| `bubbly-nw.png` (committed) | `commander-2/bubbly-w.png` (pose-ref `w`) | `3379d586ae4a6ff93dcbd14a731a2c9f73833fab58331a395d56029c1c2b1b8a` |
| `bubbly-se.png` (committed) | `commander-2/bubbly-e.png` (pose-ref `e`) | `100154c20ee784083d28d75c17cc2be635becf87937c827571dd0710c4dac95b` |
| `bubbly-sw.png` (committed) | `commander-2/bubbly-w.png` (pose-ref `w`) | `3379d586ae4a6ff93dcbd14a731a2c9f73833fab58331a395d56029c1c2b1b8a` |
| `bubbly-w.png` | `commander-7/unicorn-w.png` | `a8261eadbe76e508c9edc05a95d8ec17bc06868b527ee407421745044dbc6afb` |
| `bubbly-{e,ne,nw,se,sw,w}-2.png` | the matching `bubbly-<dir>.png` base | see the base-file rows |
| `hero-banner-bubbly.png` | `src/resources/hero-banner-unicorn.png` | `d49ee3468b8ca4f30c3ad708ae40536e70617c527d39b5fcfe8cc23535936b00` |

**Diagonal corrections.** The first `ne`/`nw` pass, re-posed from the dark
unicorn's rear view, put the head on the wrong side for `nw` (rear-right
instead of rear-left); the first `se`/`sw` pass, re-posed from the front view,
came out as straight-on front views. Both were regenerated from the light
unicorn's own side profiles with an explicit reference heading (`--pose-ref`),
which gives a distinct rear-left `nw`, front-right `se` and front-left `sw`.
The committed head sides are: `e`/`ne`/`se` right, `w`/`nw`/`sw` left.

## Post-processing

`gemini-hero-sprite.mjs` on every sprite: border-connected flood fill of the
flat grey model background (RGB distance tolerance 26), soft 2px boundary
matte, then a trim and Lanczos3 resize copying the *reference* sprite's alpha
bounding box — same content height, same bottom edge, same centre x on a
512×512 canvas. Every run frame was then aligned to its base frame with
`node tools/sprites/tune-run-frames.mjs` (content height, bottom edge and
centre x; the ten pairs pass `--check --tol 2`).

| Output | Alpha bbox (x,y,w,h) |
|---|---|
| `bubbly-e.png` | 25,21 475×457 |
| `bubbly-e-2.png` | 20,21 485×457 |
| `bubbly-ne.png` | 92,22 320×463 |
| `bubbly-ne-2.png` | 86,22 333×463 |
| `bubbly-nw.png` | 53,32 430×429 |
| `bubbly-nw-2.png` | 43,32 451×429 |
| `bubbly-se.png` | 25,20 474×457 |
| `bubbly-se-2.png` | 21,20 483×457 |
| `bubbly-sw.png` | 52,32 431×429 |
| `bubbly-sw-2.png` | 29,32 477×429 |
| `bubbly-w.png` | 53,33 430×429 |
| `bubbly-w-2.png` | 36,33 465×429 |

The banner is a full painted scene (no alpha): the model output is
cover-cropped to the roster banner's 320×100.

## Validation

- `npm run validate-assets` — run-frame alignment for all ten new pairs.
- `npm run build` + `npm run test:unit` — registry label, descriptors and the
  `test/render/unicornArt.test.ts` disk-coverage gate.
- `npm run test:visual` — the three adventure baselines shift because the
  starter hero's variant is `bubbly`; the churn is the hero sprite and its
  panel banner, not the map.
