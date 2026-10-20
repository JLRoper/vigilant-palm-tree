# Hero variant wave — `blackdragon` ("Black Dragon Rider")

Per-file provenance for the `blackdragon` mounted-hero variant, following the
"Metadata for Future Art" fields in [`docs/asset-provenance.md`](../../../docs/asset-provenance.md).

| Field | Value |
|---|---|
| Variant id / label / commander dir | `blackdragon` / `Black Dragon Rider` / `commander-15` |
| Base character | a repaint of the existing `drake` (`commander-9/drake-{n,e,s,w}.png`) — same chunky pixel-art dragon and rider, same saddle, helmet and pose |
| Generation date | 2026-10-19–20 (local; requests finished 2026-10-20T05:05Z) |
| Provider / model | OpenRouter `google/gemini-3.1-flash-image`, endpoint pinned `google-vertex/global` (`provider.only`, no fallbacks) |
| Generator | `tools/sprites/gemini-hero-sprite.mjs` with `--subject dragon` (dragon-facing wording) and `--pose-ref` (side/front references for the diagonals) |
| Sprite prompt | [`prompt.txt`](./prompt.txt), sha256 `cd8dc76fb433be64d4b13d51b44cf04e008bae8d319fa9b54da80c62e20127e6` |
| Front-diagonal prompt | [`prompt-front-diagonal.txt`](./prompt-front-diagonal.txt) — `prompt.txt` plus the explicit three-quarter composition rule, sha256 `11ae68fbf4dc4b0747a2d985119375652dda47c85cef820872519555aed66736` |
| Banner prompt | [`banner-prompt.txt`](./banner-prompt.txt), sha256 `2ef6740815c417f9616b8fad0b08574633e6853a33a0af3eb2e082ad0106a034` |
| Masters (1024²) | `design/hero-variants/blackdragon/masters/*-master.png` — **gitignored**, reproducible from the prompts above |
| Outputs | `src/resources/units/horse/commander-15/blackdragon-{n,ne,e,se,s,sw,w,nw}.png` (512×512 RGBA), `src/resources/hero-banner-blackdragon.png` (320×100) |

## Reference images handed to the model

| Output | Reference | sha256 |
|---|---|---|
| `blackdragon-n.png` | `commander-9/drake-n.png` | `a4d40fa4cb1c830d01f1f41a786d9ee59f9c63238db933bfbd8ed0a664c20aee` |
| `blackdragon-e.png` | `commander-9/drake-e.png` | `94c4239232c7277b93fdd8ef7d278d6bca35f92956f1f6e9e7c0ec088a04caaf` |
| `blackdragon-s.png` | `commander-9/drake-s.png` | `c1bf0986add9873bfd7fe75dfaca924b2233852752c756d2b41c2febb5623344` |
| `blackdragon-w.png` | `commander-9/drake-w.png` | `711b4b5fa370bc930b30bb273f19679084d104d9789958e975d29bd2d09d376e` |
| `blackdragon-ne.png` | `commander-15/blackdragon-e.png` (pose-ref `e`) | `356ee0d809a2003cf2ae78b6c910ff2d618e8bb3c9fff91031597274c1c9287d` |
| `blackdragon-nw.png` | `commander-15/blackdragon-w.png` (pose-ref `w`) | `96931b154803be993af6fd071de1af6b05b7eb92fb87e918d43e8cf5321eef79` |
| `blackdragon-se.png` (committed) | `commander-15/blackdragon-s.png` (pose-ref `s`) | `ca4a177268b01f7b412b3c318089cce924f3ac1d425f3a1c4f9a26d351122375` |
| `blackdragon-sw.png` (committed) | `commander-15/blackdragon-s.png` (pose-ref `s`) | `ca4a177268b01f7b412b3c318089cce924f3ac1d425f3a1c4f9a26d351122375` |
| `hero-banner-blackdragon.png` | `src/resources/hero-banner-drake.png` | `291cb688909e78dfc072b02053815bb667d898b5c766d03d485ce32dd8553051` |

**`se`/`sw` correction.** The first diagonals were re-posed from the east and
west profiles, but at 64×64 their mean absolute error against `e`/`w` was only
~3.5–4.1 (the unicorn pairs sit around 15), i.e. they read as the same side
pose at map size. Both were regenerated from the front (`s`) reference with
the explicit three-quarter composition rule; the committed `se` is head-right
and `sw` is head-left, and the closest remaining pair (`w`/`nw`, 12.5) is the
expected rear-quarter overlap, not a duplicate.

## Post-processing

`gemini-hero-sprite.mjs` on every sprite: border-connected flood fill of the
flat grey model background (RGB distance tolerance 26), soft 2px boundary
matte, then a trim and Lanczos3 resize copying the *reference* sprite's alpha
bounding box — same content height, same bottom edge, same centre x on a
512×512 canvas. This variant ships base frames only (no `-2` gallop files, like
lionheart/paladin2/frostwarden); both run frames resolve to the base sprite.

| Output | Alpha bbox (x,y,w,h) |
|---|---|
| `blackdragon-n.png` | 105,67 306×399 |
| `blackdragon-ne.png` | 29,56 412×402 |
| `blackdragon-e.png` | 20,57 430×402 |
| `blackdragon-se.png` | 44,46 422×415 |
| `blackdragon-s.png` | 28,47 455×415 |
| `blackdragon-sw.png` | 40,46 430×415 |
| `blackdragon-w.png` | 67,85 414×376 |
| `blackdragon-nw.png` | 75,84 398×376 |

The banner is a full painted scene (no alpha): the model output is
cover-cropped to the roster banner's 320×100.

## Validation

- `npm run validate-assets` — legacy manifest/buildings and the horse
  run-frame gate (this variant has none).
- `npm run build` + `npm run test:unit` — registry, contracts, descriptors,
  and `test/render/dragonRiderArt.test.ts` (eight distinct 512px files).
- `npm run test:heroVariants` — recruits the variant in a real game, resolves
  all eight descriptors plus the banner, and A/B diffs the same map tile
  against the drake (`darkened` palette signal).
