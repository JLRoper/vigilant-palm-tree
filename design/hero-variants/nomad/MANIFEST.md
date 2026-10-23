# Hero variant wave — `nomad` ("Desert Nomad Rider")

Per-file provenance for the `nomad` mounted-hero variant, following the
"Metadata for Future Art" fields in [`docs/asset-provenance.md`](../../../docs/asset-provenance.md).

| Field | Value |
|---|---|
| Variant id / label / commander dir | `nomad` / `Desert Nomad Rider` / `commander-18` |
| Base character | a repaint of the existing `ranger` (`commander-5/ranger-{n,e,s,w}.png`), keeping its horse build, mane, gait, saddle and rider seat while re-gearing the rider from forest leathers into desert robes |
| Generation date | 2026-10-23 |
| Provider / model | OpenRouter `google/gemini-3-pro-image`, endpoint pinned `google-vertex/global` (`provider.only`, no fallbacks) |
| Generator | `tools/sprites/gemini-hero-sprite.mjs` (default `--subject horse` wording) |
| Sprite prompt | [`prompt.txt`](./prompt.txt), sha256 `aca788a3fdba64f4648c8e77028594fc384e502773c7ded3ce1c700345a16577` |
| Front-diagonal prompt | [`prompt-front-diagonal.txt`](./prompt-front-diagonal.txt) — `prompt.txt` plus the explicit three-quarter composition rule, sha256 `8f785bfa5c2c4d9f36008eb1686bb87e3f4295968b7e2ddd5e6a5ef448c2631d` |
| Banner prompt | [`banner-prompt.txt`](./banner-prompt.txt), sha256 `edaf247765dfff8d7056b9f846924f7e26dc2ba94c3c0b9e2f445843390db69e` |
| Masters (1024²+) | `design/hero-variants/nomad/masters/*-master.png` — **gitignored**, reproducible from the prompts above |
| Outputs | `src/resources/units/horse/commander-18/nomad-{n,ne,e,se,s,sw,w,nw}.png` (512×512 RGBA), `src/resources/hero-banner-nomad.png` (320×100) |

## Model choice

Both candidate Gemini image models were run on the same prompt and the `e`
heading before the full set was generated. `google/gemini-3-pro-image` was
picked: it keeps the reference's pixel scale and outline weight while resolving
more of the new detail (the layered robe folds, the indigo head wrap and the sand-gold coat), where `google/gemini-3.1-flash-image`
flattened those areas at the same framing. The production pipeline has to hand
the model the reference's own alpha bounding box either way, so the model swap
changed no post-processing.

## Reference images handed to the model

One image-in edit per heading: the cardinal headings repaint the base's own
cardinal, the rear diagonals (`ne`/`nw`) repaint its `n`, the front diagonals
(`se`/`sw`) its `s`.

| Output | Reference | Reference sha256 |
|---|---|---|
| `nomad-n.png` | `commander-5/ranger-n.png` | `02d892d94063fdf2baf71cafdd8f04347296eb8b474cc577b2ccc54e06b29e57` |
| `nomad-ne.png` | `commander-5/ranger-n.png (pose-ref n, regenerated with prompt-rear-diagonal.txt)` | `02d892d94063fdf2baf71cafdd8f04347296eb8b474cc577b2ccc54e06b29e57` |
| `nomad-e.png` | `commander-5/ranger-e.png` | `1d361cfb5ca4697f533b6bba8cea67ffcd13ff31bf6bcaf3cbb19e019ea8a6d3` |
| `nomad-se.png` | `commander-5/ranger-s.png (pose-ref s)` | `f96872043ec9ef056dca6ee655db11de5f25e4aafb75816f4a419cdf73413700` |
| `nomad-s.png` | `commander-5/ranger-s.png` | `f96872043ec9ef056dca6ee655db11de5f25e4aafb75816f4a419cdf73413700` |
| `nomad-sw.png` | `commander-5/ranger-s.png (pose-ref s)` | `f96872043ec9ef056dca6ee655db11de5f25e4aafb75816f4a419cdf73413700` |
| `nomad-w.png` | `commander-5/ranger-w.png` | `97e60c225f6e5a1a2d5ac9cf706f15edceb4d66ac9a20c4e969f3e182cab26a7` |
| `nomad-nw.png` | `commander-5/ranger-n.png (pose-ref n, first pass)` | `02d892d94063fdf2baf71cafdd8f04347296eb8b474cc577b2ccc54e06b29e57` |
| `hero-banner-nomad.png` | `src/resources/hero-banner-ranger.png` | `8abc7c04a0f40a228e0d72a90a92c791fb22046c88f28f713ea887839dda27e1` |

**`ne` correction.** The first `ne` came back as the `nw` pose — a head-left
rear three-quarter, i.e. the mirrored side (the same failure the
frostwarden/gravewarden/stormrider wave hit). It was regenerated from
`commander-5/ranger-n.png` with [`prompt-rear-diagonal.txt`](./prompt-rear-diagonal.txt),
which pins the composition explicitly: the horse's head on the RIGHT of the
image, hindquarters nearest the camera, rider still seen from behind. The
committed `ne` is head-right and `nw` is head-left.

## Post-processing

`gemini-hero-sprite.mjs` on every sprite: border-connected flood fill of the
flat grey model background (RGB distance tolerance 26), soft 2px boundary
matte, then a trim and Lanczos3 resize copying the *reference* sprite's alpha
bounding box — same content height, same bottom edge, same centre x on a
512×512 canvas. This variant ships base frames only (no `-2` gallop files, like
lionheart/paladin2/frostwarden/blackdragon); both run frames resolve to the base
sprite.

| Output | Alpha bbox (x,y,w×h) | sha256 |
|---|---|---|
| `nomad-n.png` | 118,33 315×457 | `85fde37e484abee0a6ead74e83b6091d0b25ef2d14011269202ab3e28a752b19` |
| `nomad-ne.png` | 110,33 332×457 | `42525d4156a2006f3edff0d9fc8ab79643171a9076bda72b1a3fb4bdd5c826a9` |
| `nomad-e.png` | 39,43 432×451 | `b7bf6befc1125ef715d2d7857d63ffcbe31a2a716e1d7393ed704245bd0cbc69` |
| `nomad-se.png` | 72,23 368×470 | `c2048a02e28d7ee88aa8ba0ad964c44187e0c3b0c0b5e1d16e99dceff891e988` |
| `nomad-s.png` | 103,23 306×470 | `41120138f9b08f40ce8c7966f9d91e8d33ec977fe9006e198fe03742108cfc52` |
| `nomad-sw.png` | 72,23 368×470 | `27ba5740588b2d74f9ab48b8a34324d72ca68170aa64f3fc2f07c3931997bc7b` |
| `nomad-w.png` | 40,29 458×446 | `1d257de1d1283c543dabec78ebf97a2253ee09d95afec681f41b12c74debfef2` |
| `nomad-nw.png` | 100,33 351×457 | `29b48c7341e8db40c372440328850a9e74fd0d310d9a6905b683bfafc40d4181` |

The banner is a full painted scene (no alpha): the model output is
cover-cropped to the roster banner's 320×100.

## Validation

- `npm run validate-assets` — legacy manifest/buildings and the horse
  run-frame gate (this variant has none).
- `npm run build` + `npm run test:unit` — registry, contracts, descriptors,
  and `test/render/griffinNomadArt.test.ts` (eight distinct 512px files plus the
  banner).
- `npm run test:heroVariants` — recruits the variant in a real game, resolves
  all eight descriptors plus the banner, and A/B diffs the same map tile against
  the `ranger` (cooled palette signal).
