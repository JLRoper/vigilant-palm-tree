# Hero variant wave — `unicorn` ("Dark Unicorn") diagonals

The dark unicorn shipped with only its four cardinals (`n/e/s/w`), so the
adventure map fell back `ne/nw→n` and `se/sw→s` and read as two poses. This
wave adds the four diagonals and their gallop frames; the existing cardinals
are untouched.

| Field | Value |
|---|---|
| Variant id / label / commander dir | `unicorn` / `Dark Unicorn` / `commander-7` |
| Base character | the existing dark unicorn cardinals — same near-black indigo/amethyst palette, riderless silhouette and framing |
| Generation date | 2026-10-19 (local; requests finished 2026-10-20T03:37Z) |
| Provider / model | OpenRouter `google/gemini-3.1-flash-image`, endpoint pinned `google-vertex/global` (`provider.only`, no fallbacks) |
| Generator | `tools/sprites/gemini-hero-sprite.mjs` with `--riderless`, `--pose-ref` and `--suffix -2` |
| Diagonal prompt | [`prompt-diagonal.txt`](./prompt-diagonal.txt), sha256 `c141428688af68da38a2321fc837b75e855c7f922437b40b2a4444098bd06d08` |
| Run-frame prompt | [`prompt-run-diagonal.txt`](./prompt-run-diagonal.txt), sha256 `dd55944199f764ffa852ca25cbad2cc458a493fc625420b67a1ae5590e535b4b` |
| Masters (1024²) | `design/hero-variants/unicorn/masters/*-master.png` — **gitignored**, reproducible from the prompts above |
| Outputs | `src/resources/units/horse/commander-7/unicorn-{ne,nw,se,sw}.png` + `-2` run frames (512×512 RGBA) |

## Reference images handed to the model

| Output | Reference | sha256 |
|---|---|---|
| `unicorn-ne.png` (committed) | `commander-7/unicorn-e.png` (pose-ref `e`) | `0ff85a1601e10f82cf48bb1a923aaea017f47df55a9af6af83e5576524ed793b` |
| `unicorn-nw.png` | `commander-7/unicorn-w.png` (pose-ref `w`) | `a8261eadbe76e508c9edc05a95d8ec17bc06868b527ee407421745044dbc6afb` |
| `unicorn-se.png` | `commander-7/unicorn-e.png` (pose-ref `e`) | `0ff85a1601e10f82cf48bb1a923aaea017f47df55a9af6af83e5576524ed793b` |
| `unicorn-sw.png` | `commander-7/unicorn-w.png` (pose-ref `w`) | `a8261eadbe76e508c9edc05a95d8ec17bc06868b527ee407421745044dbc6afb` |
| `unicorn-{ne,nw,se,sw}-2.png` | the matching `unicorn-<dir>.png` base | see the base-file rows |

**`ne` correction.** The first `ne`, re-posed from the rear view, stayed a
near-straight rear view (188px content width). It was regenerated from the
east profile with `--pose-ref e` as a three-quarter rear-right view (491px
content width, head on the right), so `ne` no longer duplicates `n` at map
scale. The committed head sides are: `e`/`ne`/`se` right, `w`/`nw`/`sw` left.

## Post-processing

`gemini-hero-sprite.mjs` on every sprite: border-connected flood fill of the
flat grey model background (RGB distance tolerance 26), soft 2px boundary
matte, then a trim and Lanczos3 resize copying the *reference* sprite's alpha
bounding box — same content height, same bottom edge, same centre x on a
512×512 canvas. Every run frame was then aligned to its base frame with
`node tools/sprites/tune-run-frames.mjs` (the four pairs pass `--check --tol 2`).

| Output | Alpha bbox (x,y,w,h) |
|---|---|
| `unicorn-ne.png` | 17,21 491×457 |
| `unicorn-ne-2.png` | 18,21 490×457 |
| `unicorn-nw.png` | 53,33 431×429 |
| `unicorn-nw-2.png` | 46,33 446×429 |
| `unicorn-se.png` | 25,21 475×457 |
| `unicorn-se-2.png` | 17,21 492×457 |
| `unicorn-sw.png` | 55,33 427×429 |
| `unicorn-sw-2.png` | 43,33 452×429 |

## Validation

- `npm run validate-assets` — run-frame alignment for the four new pairs.
- `npm run build` + `npm run test:unit` — `test/render/unicornArt.test.ts`
  asserts every map heading has a distinct 512px base and a gallop frame.
- `npm run test:visual` — the adventure scenes may shift only where this
  variant is staged; the existing four cardinals are byte-identical.
